use pnet_packet::ethernet::{EtherTypes, EthernetPacket};
use pnet_packet::icmp::IcmpPacket;
use pnet_packet::icmpv6::Icmpv6Packet;
use pnet_packet::ip::{IpNextHeaderProtocol, IpNextHeaderProtocols};
use pnet_packet::ipv4::Ipv4Packet;
use pnet_packet::ipv6::Ipv6Packet;
use pnet_packet::tcp::TcpPacket;
use pnet_packet::udp::UdpPacket;
use pnet_packet::Packet;
use std::net::IpAddr;

#[derive(Debug, Clone)]
pub enum EventType {
    TcpSyn,
    TcpSynAck,
    TcpRst,
    DnsQuery,
    HttpData,
    Udp,
    Icmp,
    #[allow(dead_code)]
    PortScanAlert,
    Other,
}

#[derive(Debug, Clone)]
pub struct ClassifiedEvent {
    pub event_type: EventType,
    pub src_ip: Option<IpAddr>,
    pub dst_ip: Option<IpAddr>,
    pub src_port: Option<u16>,
    pub dst_port: Option<u16>,
    pub size_bytes: usize,
}

impl std::fmt::Display for ClassifiedEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let event = match self.event_type {
            EventType::TcpSyn => "TcpSyn",
            EventType::TcpSynAck => "TcpSynAck",
            EventType::TcpRst => "TcpRst",
            EventType::DnsQuery => "DnsQuery",
            EventType::HttpData => "HttpData",
            EventType::Udp => "Udp",
            EventType::Icmp => "Icmp",
            EventType::PortScanAlert => "PortScan",
            EventType::Other => "Other",
        };
        let endpoint = |ip: Option<IpAddr>, port: Option<u16>| match (ip, port) {
            (Some(IpAddr::V6(ip)), Some(port)) => format!("[{ip}]:{port}"),
            (Some(ip), Some(port)) => format!("{ip}:{port}"),
            (Some(ip), None) => ip.to_string(),
            (None, _) => String::from("-"),
        };
        write!(
            f,
            "{event:<10} {} -> {} ({:>6} bytes)",
            endpoint(self.src_ip, self.src_port),
            endpoint(self.dst_ip, self.dst_port),
            self.size_bytes
        )
    }
}

pub fn classify(raw_packet: &[u8]) -> ClassifiedEvent {
    let mut event = base_event(raw_packet.len());

    let Some(ethernet) = EthernetPacket::new(raw_packet) else {
        return event;
    };

    match ethernet.get_ethertype() {
        EtherTypes::Ipv4 | EtherTypes::Ipv6 => classify_ip_inner(&mut event, ethernet.payload()),
        _ => {}
    }

    event
}

pub fn classify_ip(raw_packet: &[u8]) -> ClassifiedEvent {
    let mut event = base_event(raw_packet.len());
    classify_ip_inner(&mut event, raw_packet);
    event
}

fn base_event(size_bytes: usize) -> ClassifiedEvent {
    ClassifiedEvent {
        event_type: EventType::Other,
        src_ip: None,
        dst_ip: None,
        src_port: None,
        dst_port: None,
        size_bytes,
    }
}

fn classify_ip_inner(event: &mut ClassifiedEvent, raw: &[u8]) {
    match raw.first().map(|byte| byte >> 4) {
        Some(4) => {
            let Some(ipv4) = Ipv4Packet::new(raw) else {
                return;
            };
            event.src_ip = Some(IpAddr::V4(ipv4.get_source()));
            event.dst_ip = Some(IpAddr::V4(ipv4.get_destination()));
            let protocol = ipv4.get_next_level_protocol();
            let payload = ipv4.payload();
            classify_transport(event, protocol, payload);
        }
        Some(6) => {
            let Some(ipv6) = Ipv6Packet::new(raw) else {
                return;
            };
            event.src_ip = Some(IpAddr::V6(ipv6.get_source()));
            event.dst_ip = Some(IpAddr::V6(ipv6.get_destination()));
            let protocol = ipv6.get_next_header();
            let payload = ipv6.payload();
            classify_transport(event, protocol, payload);
        }
        _ => {}
    }
}

fn classify_transport(event: &mut ClassifiedEvent, protocol: IpNextHeaderProtocol, payload: &[u8]) {
    match protocol {
        IpNextHeaderProtocols::Tcp => {
            let Some(tcp) = TcpPacket::new(payload) else {
                return;
            };
            event.src_port = Some(tcp.get_source());
            event.dst_port = Some(tcp.get_destination());

            let flags = tcp.get_flags();
            let syn = flags & 0x02 != 0;
            let ack = flags & 0x10 != 0;
            let rst = flags & 0x04 != 0;

            if syn && !ack {
                event.event_type = EventType::TcpSyn;
            } else if syn && ack {
                event.event_type = EventType::TcpSynAck;
            } else if rst {
                event.event_type = EventType::TcpRst;
            } else if tcp.payload().is_empty() {
                event.event_type = EventType::Other;
            } else if tcp.get_source() == 80 || tcp.get_destination() == 80
                || tcp.get_source() == 443 || tcp.get_destination() == 443
            {
                event.event_type = EventType::HttpData;
            } else {
                event.event_type = EventType::Other;
            }
        }
        IpNextHeaderProtocols::Udp => {
            let Some(udp) = UdpPacket::new(payload) else {
                return;
            };
            event.src_port = Some(udp.get_source());
            event.dst_port = Some(udp.get_destination());
            event.event_type = if udp.get_source() == 53 || udp.get_destination() == 53 {
                EventType::DnsQuery
            } else {
                EventType::Udp
            };
        }
        IpNextHeaderProtocols::Icmp => {
            if IcmpPacket::new(payload).is_some() {
                event.event_type = EventType::Icmp;
            }
        }
        IpNextHeaderProtocols::Icmpv6 if Icmpv6Packet::new(payload).is_some() => {
            event.event_type = EventType::Icmp;
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pnet_packet::ethernet::{EtherTypes, MutableEthernetPacket};
    use pnet_packet::icmp::{IcmpTypes, MutableIcmpPacket};
    use pnet_packet::ipv4::{Ipv4Flags, MutableIpv4Packet};
    use pnet_packet::ipv6::MutableIpv6Packet;
    use pnet_packet::tcp::{MutableTcpPacket, TcpFlags};
    use pnet_packet::udp::MutableUdpPacket;
    use std::net::{Ipv4Addr, Ipv6Addr};

    fn ethernet(ethertype: pnet_packet::ethernet::EtherType, payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 14 + payload.len()];
        let mut eth = MutableEthernetPacket::new(&mut buf).unwrap();
        eth.set_ethertype(ethertype);
        eth.set_payload(payload);
        buf
    }

    fn ipv4(protocol: IpNextHeaderProtocol, payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 20 + payload.len()];
        let mut ip = MutableIpv4Packet::new(&mut buf).unwrap();
        ip.set_version(4);
        ip.set_header_length(5);
        ip.set_total_length((20 + payload.len()) as u16);
        ip.set_flags(Ipv4Flags::DontFragment);
        ip.set_next_level_protocol(protocol);
        ip.set_source(Ipv4Addr::new(10, 0, 0, 5));
        ip.set_destination(Ipv4Addr::new(93, 184, 216, 34));
        ip.set_payload(payload);
        buf
    }

    fn ipv6(protocol: IpNextHeaderProtocol, payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 40 + payload.len()];
        let mut ip = MutableIpv6Packet::new(&mut buf).unwrap();
        ip.set_version(6);
        ip.set_next_header(protocol);
        ip.set_payload_length(payload.len() as u16);
        ip.set_source(Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0x42));
        ip.set_destination(Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0x24));
        ip.set_payload(payload);
        buf
    }

    fn tcp(src: u16, dst: u16, flags: u8, payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 20 + payload.len()];
        let mut tcp = MutableTcpPacket::new(&mut buf).unwrap();
        tcp.set_source(src);
        tcp.set_destination(dst);
        tcp.set_data_offset(5);
        tcp.set_flags(flags);
        tcp.set_payload(payload);
        buf
    }

    fn udp(src: u16, dst: u16, payload: &[u8]) -> Vec<u8> {
        let mut buf = vec![0u8; 8 + payload.len()];
        let mut udp = MutableUdpPacket::new(&mut buf).unwrap();
        udp.set_source(src);
        udp.set_destination(dst);
        udp.set_length((8 + payload.len()) as u16);
        udp.set_payload(payload);
        buf
    }

    fn icmp_echo() -> Vec<u8> {
        let mut buf = vec![0u8; 8];
        let mut icmp = MutableIcmpPacket::new(&mut buf).unwrap();
        icmp.set_icmp_type(IcmpTypes::EchoRequest);
        buf
    }

    fn tcp_frame_v4(flags: u8, payload: &[u8]) -> Vec<u8> {
        ethernet(
            EtherTypes::Ipv4,
            &ipv4(IpNextHeaderProtocols::Tcp, &tcp(52341, 443, flags, payload)),
        )
    }

    fn tcp_frame_v6(flags: u8, payload: &[u8]) -> Vec<u8> {
        ethernet(
            EtherTypes::Ipv6,
            &ipv6(IpNextHeaderProtocols::Tcp, &tcp(52341, 443, flags, payload)),
        )
    }

    #[test]
    fn classifies_tcp_syn_v4() {
        let event = classify(&tcp_frame_v4(TcpFlags::SYN, &[]));
        assert!(matches!(event.event_type, EventType::TcpSyn));
        assert_eq!(event.src_port, Some(52341));
        assert_eq!(event.dst_port, Some(443));
        assert_eq!(event.src_ip, Some(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))));
    }

    #[test]
    fn classifies_tcp_syn_ack_v4() {
        let event = classify(&tcp_frame_v4(TcpFlags::SYN | TcpFlags::ACK, &[]));
        assert!(matches!(event.event_type, EventType::TcpSynAck));
    }

    #[test]
    fn classifies_tcp_syn_ack_v6() {
        let event = classify(&tcp_frame_v6(TcpFlags::SYN | TcpFlags::ACK, &[]));
        assert!(matches!(event.event_type, EventType::TcpSynAck));
        assert!(matches!(event.src_ip, Some(IpAddr::V6(_))));
    }

    #[test]
    fn classifies_tcp_rst() {
        let event = classify(&tcp_frame_v4(TcpFlags::RST | TcpFlags::ACK, &[]));
        assert!(matches!(event.event_type, EventType::TcpRst));
    }

    #[test]
    fn classifies_http_data_on_443_with_payload() {
        let event = classify(&tcp_frame_v4(TcpFlags::PSH | TcpFlags::ACK, b"GET / HTTP/1.1"));
        assert!(matches!(event.event_type, EventType::HttpData));
    }

    #[test]
    fn bare_ack_without_payload_is_other() {
        let event = classify(&tcp_frame_v4(TcpFlags::ACK, &[]));
        assert!(matches!(event.event_type, EventType::Other));
    }

    #[test]
    fn classifies_dns_query() {
        let frame = ethernet(
            EtherTypes::Ipv4,
            &ipv4(IpNextHeaderProtocols::Udp, &udp(64375, 53, &[0u8; 12])),
        );
        let event = classify(&frame);
        assert!(matches!(event.event_type, EventType::DnsQuery));
    }

    #[test]
    fn classifies_plain_udp() {
        let frame = ethernet(
            EtherTypes::Ipv4,
            &ipv4(IpNextHeaderProtocols::Udp, &udp(5353, 5353, &[0u8; 4])),
        );
        let event = classify(&frame);
        assert!(matches!(event.event_type, EventType::Udp));
    }

    #[test]
    fn classifies_icmp() {
        let frame = ethernet(
            EtherTypes::Ipv4,
            &ipv4(IpNextHeaderProtocols::Icmp, &icmp_echo()),
        );
        let event = classify(&frame);
        assert!(matches!(event.event_type, EventType::Icmp));
    }

    #[test]
    fn garbage_falls_back_to_other_with_size() {
        let event = classify(&[0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
        assert!(matches!(event.event_type, EventType::Other));
        assert_eq!(event.size_bytes, 6);
        assert_eq!(event.src_ip, None);
    }

    #[test]
    fn non_ip_ethertype_is_other() {
        let event = classify(&ethernet(EtherTypes::Arp, &[0u8; 28]));
        assert!(matches!(event.event_type, EventType::Other));
    }

    #[test]
    fn null_framed_syn_is_tcp_syn() {
        let mut frame = vec![2, 0, 0, 0];
        frame.extend(ipv4(
            IpNextHeaderProtocols::Tcp,
            &tcp(52341, 443, TcpFlags::SYN, &[]),
        ));
        let event = classify_ip(&frame[4..]);
        assert!(matches!(event.event_type, EventType::TcpSyn));
    }

    #[test]
    fn null_framed_syn_ack_v6_is_tcp_syn_ack() {
        let mut frame = vec![23, 0, 0, 0];
        frame.extend(ipv6(
            IpNextHeaderProtocols::Tcp,
            &tcp(52341, 443, TcpFlags::SYN | TcpFlags::ACK, &[]),
        ));
        let event = classify_ip(&frame[4..]);
        assert!(matches!(event.event_type, EventType::TcpSynAck));
    }
}
