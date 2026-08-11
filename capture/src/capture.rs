use crate::classify::{classify, classify_ip, EventType};
use crate::config::load_instrument_pack;
use crate::mapper::{Mapper, NoteEvent};
use crate::portscan::PortScanDetector;
use pcap::Device;
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::time::Instant;

const RATE_LIMIT_MIN_INTERVAL_MS: u64 = 20;

pub fn list_devices() -> Result<Vec<String>, pcap::Error> {
    let devices = Device::list()?;
    Ok(devices
        .into_iter()
        .map(|device| match device.desc {
            Some(desc) => format!("{} ({desc})", device.name),
            None => device.name,
        })
        .collect())
}

pub fn default_device() -> Result<String, pcap::Error> {
    Device::lookup()?
        .map(|device| device.name)
        .ok_or(pcap::Error::IoError(std::io::ErrorKind::NotFound))
}

pub fn local_ip(interface: &str) -> Result<IpAddr, pcap::Error> {
    for device in Device::list()? {
        if device.name == interface {
            for address in &device.addresses {
                if address.addr.is_ipv4() && !address.addr.is_loopback() {
                    return Ok(address.addr);
                }
            }
        }
    }
    if let Some(device) = Device::lookup()? {
        for address in &device.addresses {
            if address.addr.is_ipv4() && !address.addr.is_loopback() {
                return Ok(address.addr);
            }
        }
    }
    Ok(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

pub fn run(
    interface: &str,
    max_packets: u64,
    tx: tokio::sync::broadcast::Sender<NoteEvent>,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let mut capture = match pcap::Capture::from_device(interface)?.promisc(true).timeout(250).open() {
        Ok(capture) => capture,
        Err(err) => {
            println!("promiscuous mode unavailable ({err}); retrying without it");
            pcap::Capture::from_device(interface)?.timeout(250).open()?
        }
    };

    let local = local_ip(interface)?;
    println!("local_ip: {local}");
    let pack = load_instrument_pack(Path::new("instruments/ambient.toml"))?;
    let mapper = Mapper::new(pack, local);

    let mut count = 0u64;
    let linktype = capture.get_datalink();
    println!("linktype: {linktype:?}");
    let mut detector = PortScanDetector::new();
    let start = Instant::now();
    let mut last_send: Option<Instant> = None;
    loop {
        if max_packets > 0 && count >= max_packets {
            break;
        }
        match capture.next_packet() {
            Ok(packet) => {
                count += 1;
                let now = Instant::now();
                let now_ms = start.elapsed().as_millis() as u64;
                let event = match linktype {
                    pcap::Linktype::ETHERNET => classify(&packet.data),
                    pcap::Linktype::NULL => classify_ip(packet.data.get(4..).unwrap_or_default()),
                    other => {
                        eprintln!("unsupported linktype {other:?}; skipping packet");
                        continue;
                    }
                };

                if matches!(event.event_type, EventType::TcpSyn) {
                    if let (Some(src_ip), Some(dst_port)) = (event.src_ip, event.dst_port) {
                        if let Some(alert) = detector.observe(src_ip, dst_port, now) {
                            println!(
                                "[ALERT] PortScan src={} ports={} window={}s",
                                alert.src_ip, alert.distinct_ports, alert.window_secs
                            );
                            let note = mapper.map_alert(&alert, now_ms);
                            println!("{}", serde_json::to_string_pretty(&note)?);
                            let _ = tx.send(note);
                        }
                    }
                }

                if let Some(note) = mapper.map(&event, now_ms) {
                    println!("{}", serde_json::to_string_pretty(&note)?);
                    let due = match last_send {
                        None => true,
                        Some(previous) => {
                            previous.elapsed().as_millis() as u64 >= RATE_LIMIT_MIN_INTERVAL_MS
                        }
                    };
                    if due {
                        let _ = tx.send(note);
                        last_send = Some(Instant::now());
                    }
                }
            }
            Err(pcap::Error::TimeoutExpired) => continue,
            Err(err) => return Err(err.into()),
        }
    }
    Ok(count)
}
