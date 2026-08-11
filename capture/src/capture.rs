use pcap::Device;

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
    loop {
        if max_packets > 0 && count >= max_packets {
            break;
        }
        match capture.next_packet() {
            Ok(packet) => {
                count += 1;
                println!("[{count:>6}] packet: {} bytes", packet.header.len);
            }
            Err(pcap::Error::TimeoutExpired) => continue,
            Err(err) => return Err(err),
        }
    }
    Ok(count)
}
