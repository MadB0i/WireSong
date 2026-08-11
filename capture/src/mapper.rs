use crate::classify::{ClassifiedEvent, EventType};
use crate::config::InstrumentPack;
use crate::portscan::PortScanAlert;
use serde::Serialize;
use std::net::IpAddr;

const HTTP_TYPICAL_MAX_BYTES: f32 = 8000.0;
const PAN_OUTBOUND: f32 = 0.6;
const PAN_INBOUND: f32 = -0.6;

#[derive(Serialize, Clone, Debug)]
pub struct NoteEvent {
    pub timestamp_ms: u64,
    pub event_type: String,
    pub pitch: u8,
    pub velocity: f32,
    pub duration_ms: u32,
    pub pan: f32,
    pub size_bytes: usize,
}

pub struct Mapper {
    pack: InstrumentPack,
    local_ip: IpAddr,
}

impl Mapper {
    pub fn new(pack: InstrumentPack, local_ip: IpAddr) -> Self {
        Self { pack, local_ip }
    }

    pub fn map(&self, event: &ClassifiedEvent, now_ms: u64) -> Option<NoteEvent> {
        let event_type = match event.event_type {
            EventType::TcpSyn => "tcp_syn",
            EventType::TcpSynAck => "tcp_synack",
            EventType::TcpRst => "tcp_rst",
            EventType::DnsQuery => "dns_query",
            EventType::HttpData => "http_data",
            EventType::Udp => "udp",
            EventType::Icmp => "icmp",
            EventType::PortScanAlert => "port_scan_alert",
            EventType::Other => return None,
        };
        let config = self.pack.events.get(event_type)?;

        let scale = &self.pack.scale.notes;
        let port = event.dst_port.or(event.src_port).unwrap_or(0);
        let base_index = port as usize % scale.len();
        let pitch_index = match event.event_type {
            EventType::TcpSynAck => {
                let offset = config.scale_degree_offset.unwrap_or(0) as usize;
                (base_index + offset).min(scale.len() - 1)
            }
            _ => base_index,
        };
        let pitch = scale[pitch_index];

        let velocity = if event.size_bytes == 0 {
            config.velocity_base
        } else {
            (config.velocity_base + (event.size_bytes as f32).ln() / 100.0)
                .clamp(0.0, 1.0)
        };

        let duration_ms = match event.event_type {
            EventType::HttpData => {
                let min = config.duration_ms_min.unwrap_or(300);
                let max = config.duration_ms_max.unwrap_or(900);
                let fraction = (event.size_bytes as f32 / HTTP_TYPICAL_MAX_BYTES).clamp(0.0, 1.0);
                min + ((max.saturating_sub(min) as f32 * fraction) as u32)
            }
            _ => config.duration_ms.unwrap_or(200),
        };

        let pan = if event.src_ip == Some(self.local_ip) {
            PAN_OUTBOUND
        } else if event.dst_ip == Some(self.local_ip) {
            PAN_INBOUND
        } else {
            0.0
        };

        Some(NoteEvent {
            timestamp_ms: now_ms,
            event_type: event_type.to_string(),
            pitch,
            velocity,
            duration_ms,
            pan,
            size_bytes: event.size_bytes,
        })
    }

    pub fn map_alert(&self, _alert: &PortScanAlert, now_ms: u64) -> NoteEvent {
        let config = self.pack.events.get("port_scan_alert");
        let (velocity_base, duration_ms) = match config {
            Some(config) => (config.velocity_base, config.duration_ms.unwrap_or(1200)),
            None => (1.0, 1200),
        };
        let scale = &self.pack.scale.notes;
        let pitch = scale[scale.len() / 2];

        NoteEvent {
            timestamp_ms: now_ms,
            event_type: "port_scan_alert".to_string(),
            pitch,
            velocity: velocity_base,
            duration_ms,
            pan: PAN_INBOUND,
            size_bytes: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classify::{ClassifiedEvent, EventType};
    use crate::config::load_instrument_pack;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use std::path::Path;

    const LOCAL: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5));
    const REMOTE: IpAddr = IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34));

    fn pack() -> InstrumentPack {
        load_instrument_pack(Path::new("instruments/ambient.toml")).expect("ambient.toml loads")
    }

    fn event(event_type: EventType, src: IpAddr, dst: IpAddr, dst_port: u16, size: usize) -> ClassifiedEvent {
        ClassifiedEvent {
            event_type,
            src_ip: Some(src),
            dst_ip: Some(dst),
            src_port: Some(52341),
            dst_port: Some(dst_port),
            size_bytes: size,
        }
    }

    #[test]
    fn outbound_syn_has_positive_pan_and_scale_pitch() {
        let mapper = Mapper::new(pack(), LOCAL);
        let note = mapper
            .map(&event(EventType::TcpSyn, LOCAL, REMOTE, 443, 66), 1000)
            .expect("TcpSyn should map");
        assert!(note.pan > 0.0);
        assert_eq!(note.pan, PAN_OUTBOUND);
        assert!(pack().scale.notes.contains(&note.pitch));
    }

    #[test]
    fn inbound_syn_has_negative_pan() {
        let mapper = Mapper::new(pack(), REMOTE);
        let note = mapper
            .map(&event(EventType::TcpSyn, LOCAL, REMOTE, 443, 66), 1000)
            .expect("TcpSyn should map");
        assert_eq!(note.pan, PAN_INBOUND);
        assert!(note.pan < 0.0);
    }

    #[test]
    fn synack_pitch_offsets_by_scale_degrees_not_semitones() {
        let mapper = Mapper::new(pack(), LOCAL);
        let syn = mapper
            .map(&event(EventType::TcpSyn, LOCAL, REMOTE, 443, 66), 1000)
            .expect("TcpSyn should map");
        let synack = mapper
            .map(&event(EventType::TcpSynAck, REMOTE, LOCAL, 443, 66), 1000)
            .expect("TcpSynAck should map");

        let scale = pack().scale.notes;
        let base_index = 443 % scale.len();
        assert_eq!(syn.pitch, scale[base_index]);
        assert_eq!(synack.pitch, scale[(base_index + 2).min(scale.len() - 1)]);
        assert_ne!(synack.pitch, syn.pitch + 2, "offset must be scale-degrees, not semitones");
    }

    #[test]
    fn http_data_duration_scales_with_size() {
        let mapper = Mapper::new(pack(), LOCAL);
        let small = mapper
            .map(&event(EventType::HttpData, LOCAL, REMOTE, 443, 400), 1000)
            .expect("HttpData should map");
        let large = mapper
            .map(&event(EventType::HttpData, LOCAL, REMOTE, 443, 8000), 1000)
            .expect("HttpData should map");

        assert!(small.duration_ms < large.duration_ms);
        assert_eq!(large.duration_ms, 900);
        assert!(small.duration_ms >= 300);
    }

    #[test]
    fn other_events_map_to_none() {
        let mapper = Mapper::new(pack(), LOCAL);
        let note = mapper.map(&event(EventType::Other, LOCAL, REMOTE, 0, 100), 1000);
        assert!(note.is_none());
    }

    #[test]
    fn alert_maps_with_fixed_inbound_pan() {
        let mapper = Mapper::new(pack(), LOCAL);
        let alert = PortScanAlert {
            src_ip: IpAddr::V6(Ipv6Addr::LOCALHOST),
            distinct_ports: 9,
            window_secs: 3,
        };
        let note = mapper.map_alert(&alert, 2000);
        assert_eq!(note.pan, -0.6);
        assert_eq!(note.size_bytes, 0);
        assert_eq!(note.event_type, "port_scan_alert");
        assert_eq!(note.pitch, pack().scale.notes[pack().scale.notes.len() / 2]);
        assert_eq!(note.duration_ms, 1200);
    }
}
