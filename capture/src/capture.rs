use crate::classify::{classify, classify_ip};
use crate::portscan::PortScanDetector;
use pcap::Device;
use std::time::Instant;

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

pub fn run(interface: &str, max_packets: u64) -> Result<u64, pcap::Error> {
    let mut capture = match pcap::Capture::from_device(interface)?.promisc(true).timeout(250).open() {
        Ok(capture) => capture,
        Err(err) => {
            println!("promiscuous mode unavailable ({err}); retrying without it");
            pcap::Capture::from_device(interface)?.timeout(250).open()?
        }
    };

    let mut count = 0u64;
    let linktype = capture.get_datalink();
    println!("linktype: {linktype:?}");
    let mut detector = PortScanDetector::new();
    loop {
        if max_packets > 0 && count >= max_packets {
            break;
        }
        match capture.next_packet() {
            Ok(packet) => {
                count += 1;
                let now = Instant::now();
                let event = match linktype {
                    pcap::Linktype::ETHERNET => classify(&packet.data),
                    pcap::Linktype::NULL => classify_ip(packet.data.get(4..).unwrap_or_default()),
                    other => {
                        eprintln!("unsupported linktype {other:?}; skipping packet");
                        continue;
                    }
                };
                println!("[{count:>6}] {event}");

                if let (Some(src_ip), Some(dst_port)) = (event.src_ip, event.dst_port) {
                    if let Some(alert) = detector.observe(src_ip, dst_port, now) {
                        println!(
                            "[ALERT] PortScan src={} ports={} window={}s",
                            alert.src_ip, alert.distinct_ports, alert.window_secs
                        );
                    }
                }
            }
            Err(pcap::Error::TimeoutExpired) => continue,
            Err(err) => return Err(err),
        }
    }
    Ok(count)
}
