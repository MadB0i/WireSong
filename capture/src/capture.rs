use crate::classify::{classify, classify_ip, ClassifiedEvent, EventType};
use crate::config::load_instrument_pack;
use crate::mapper::{Mapper, NoteEvent};
use crate::portscan::{PortScanAlert, PortScanDetector};
use pcap::{Activated, Capture, Device};
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::time::Instant;

const RATE_LIMIT_MIN_INTERVAL_MS: u64 = 20;

const SYNTHETIC_SLEEP_MS: u64 = 5;

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

// Shared pipeline: capture -> classify -> port-scan detection -> sonification
// mapping -> broadcast. Used by both live capture and offline pcap replay.
// `rate_limit` throttles note emission to keep the soundscape musical
// (disabled in --bench mode). Returns (packets processed, notes emitted).
fn capture_loop<T: Activated>(
    mut capture: Capture<T>,
    local: IpAddr,
    max_packets: u64,
    rate_limit: bool,
    tx: tokio::sync::broadcast::Sender<NoteEvent>,
) -> Result<(u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let pack = load_instrument_pack(Path::new("instruments/ambient.toml"))?;
    let mapper = Mapper::new(pack, local);

    let mut packets = 0u64;
    let mut notes = 0u64;
    let linktype = capture.get_datalink();
    println!("linktype: {linktype:?}");
    let mut detector = PortScanDetector::new();
    let start = Instant::now();
    let mut last_send: Option<Instant> = None;
    loop {
        if max_packets > 0 && packets >= max_packets {
            break;
        }
        match capture.next_packet() {
            Ok(packet) => {
                packets += 1;
                let now = Instant::now();
                let now_ms = start.elapsed().as_millis() as u64;
                let event = match linktype {
                    pcap::Linktype::ETHERNET => classify(packet.data),
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
                    let due = if !rate_limit {
                        true
                    } else {
                        match last_send {
                            None => true,
                            Some(previous) => {
                                previous.elapsed().as_millis() as u64
                                    >= RATE_LIMIT_MIN_INTERVAL_MS
                            }
                        }
                    };
                    if due {
                        notes += 1;
                        let _ = tx.send(note);
                        last_send = Some(Instant::now());
                    }
                }
            }
            Err(pcap::Error::TimeoutExpired) => continue,
            Err(pcap::Error::NoMorePackets) => break,
            Err(err) => return Err(err.into()),
        }
    }
    Ok((packets, notes))
}

pub fn run(
    interface: &str,
    max_packets: u64,
    tx: tokio::sync::broadcast::Sender<NoteEvent>,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let capture = match Capture::from_device(interface)?.promisc(true).timeout(250).open() {
        Ok(capture) => capture,
        Err(err) => {
            println!("promiscuous mode unavailable ({err}); retrying without it");
            Capture::from_device(interface)?.timeout(250).open()?
        }
    };

    let local = local_ip(interface)?;
    println!("local_ip: {local}");
    let (packets, _) = capture_loop(capture, local, max_packets, true, tx)?;
    Ok(packets)
}

pub fn run_offline(
    path: &str,
    max_packets: u64,
    rate_limit: bool,
    tx: tokio::sync::broadcast::Sender<NoteEvent>,
) -> Result<(u64, u64), Box<dyn std::error::Error + Send + Sync>> {
    let capture = Capture::from_file(path)?;
    let local = IpAddr::V4(Ipv4Addr::LOCALHOST);
    println!("offline replay: {path}");
    println!("local_ip: {local} (replay)");
    capture_loop(capture, local, max_packets, rate_limit, tx)
}

// Deterministic pseudo-random generator (no external deps).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 32) as u32
    }

    fn below(&mut self, max: u32) -> u32 {
        self.next() % max
    }

    fn chance(&mut self, percent: u32) -> bool {
        self.below(100) < percent
    }
}

fn synthetic_event(rng: &mut Lcg, now_ms: u64, mapper: &Mapper, tx: &tokio::sync::broadcast::Sender<NoteEvent>) -> bool {
    let src = Ipv4Addr::new(192, 168, 1, 2 + rng.below(8) as u8);
    let dst = Ipv4Addr::new(
        10 + rng.below(220) as u8,
        rng.below(255) as u8,
        rng.below(255) as u8,
        1 + rng.below(253) as u8,
    );
    let src_ip = IpAddr::V4(src);
    let dst_ip = IpAddr::V4(dst);
    let src_port = (1024 + rng.below(60_000)) as u16;
    let dst_port = match rng.below(10) {
        0..=2 => 443,
        3 => 80,
        4 => 53,
        5 => 8080,
        _ => 1024 + rng.below(20_000) as u16,
    };

    let (event_type, size_bytes) = match rng.below(100) {
        0..=24 => (EventType::TcpSyn, 40 + rng.below(40) as usize),
        25..=39 => (EventType::TcpSynAck, 40 + rng.below(40) as usize),
        40..=49 => (EventType::TcpRst, 40),
        50..=59 => (EventType::DnsQuery, 50 + rng.below(200) as usize),
        60..=79 => (EventType::HttpData, 300 + rng.below(2000) as usize),
        80..=94 => (EventType::Udp, 60 + rng.below(400) as usize),
        _ => (EventType::Icmp, 56 + rng.below(40) as usize),
    };

    let event = ClassifiedEvent {
        event_type,
        src_ip: Some(src_ip),
        dst_ip: Some(dst_ip),
        src_port: Some(src_port),
        dst_port: Some(dst_port),
        size_bytes,
    };

    if matches!(event.event_type, EventType::TcpSyn) && rng.chance(4) {
        let alert = PortScanAlert {
            src_ip,
            distinct_ports: 9 + rng.below(20) as usize,
            window_secs: 3,
        };
        println!("[ALERT] PortScan src={src_ip} ports={} window=3s", alert.distinct_ports);
        let note = mapper.map_alert(&alert, now_ms);
        println!("{}", serde_json::to_string_pretty(&note).unwrap_or_default());
        let _ = tx.send(note);
        return true;
    }

    if let Some(note) = mapper.map(&event, now_ms) {
        println!("{}", serde_json::to_string_pretty(&note).unwrap_or_default());
        let _ = tx.send(note);
        return true;
    }
    false
}

pub fn run_synthetic(
    rate: u64,
    max_notes: u64,
    tx: tokio::sync::broadcast::Sender<NoteEvent>,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    let local = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let pack = load_instrument_pack(Path::new("instruments/ambient.toml"))?;
    let mapper = Mapper::new(pack, local);
    let mut rng = Lcg(0x9E3779B97F4A7C15);
    let interval_ms = if rate == 0 { 0 } else { 1000u64 / rate.max(1) };

    let start = Instant::now();
    let mut notes = 0u64;
    loop {
        if max_notes > 0 && notes >= max_notes {
            break;
        }
        let now_ms = start.elapsed().as_millis() as u64;
        if synthetic_event(&mut rng, now_ms, &mapper, &tx) {
            notes += 1;
        }
        if interval_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(interval_ms.max(SYNTHETIC_SLEEP_MS)));
        }
    }
    println!("synthetic source finished: {notes} notes emitted");
    Ok(notes)
}