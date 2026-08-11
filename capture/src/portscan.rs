use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::time::{Duration, Instant};

const PORT_SCAN_THRESHOLD: usize = 8;
const PORT_SCAN_WINDOW: Duration = Duration::from_secs(3);
const PORT_SCAN_COOLDOWN: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct PortScanAlert {
    pub src_ip: IpAddr,
    pub distinct_ports: usize,
    pub window_secs: u64,
}

pub struct PortScanDetector {
    windows: HashMap<IpAddr, VecDeque<(u16, Instant)>>,
    cooldowns: HashMap<IpAddr, Instant>,
}

impl PortScanDetector {
    pub fn new() -> Self {
        Self {
            windows: HashMap::new(),
            cooldowns: HashMap::new(),
        }
    }

    pub fn observe(
        &mut self,
        src_ip: IpAddr,
        dst_port: u16,
        now: Instant,
    ) -> Option<PortScanAlert> {
        let window = self.windows.entry(src_ip).or_default();

        while let Some((_, seen_at)) = window.front() {
            if now.duration_since(*seen_at) > PORT_SCAN_WINDOW {
                window.pop_front();
            } else {
                break;
            }
        }

        if !window.iter().any(|(port, _)| *port == dst_port) {
            window.push_back((dst_port, now));
        }

        if let Some(cooldown_until) = self.cooldowns.get(&src_ip) {
            if now < *cooldown_until {
                return None;
            }
        }

        let distinct: HashSet<u16> = window.iter().map(|(port, _)| *port).collect();
        if distinct.len() > PORT_SCAN_THRESHOLD {
            self.cooldowns.insert(src_ip, now + PORT_SCAN_COOLDOWN);
            return Some(PortScanAlert {
                src_ip,
                distinct_ports: distinct.len(),
                window_secs: PORT_SCAN_WINDOW.as_secs(),
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nine_distinct_ports_in_window_fires_alert() {
        let mut detector = PortScanDetector::new();
        let base = Instant::now();
        let src: IpAddr = "10.0.0.9".parse().unwrap();

        let mut alert = None;
        for i in 0..9 {
            alert = detector.observe(src, 1000 + i, base + Duration::from_millis(u64::from(i) * 50));
        }

        let alert = alert.expect("alert should fire");
        assert_eq!(alert.src_ip, src);
        assert_eq!(alert.distinct_ports, 9);
        assert_eq!(alert.window_secs, 3);
    }

    #[test]
    fn ports_spread_across_six_seconds_do_not_fire() {
        let mut detector = PortScanDetector::new();
        let base = Instant::now();
        let src: IpAddr = "10.0.0.10".parse().unwrap();

        for i in 0..9 {
            let observed =
                detector.observe(src, 2000 + i, base + Duration::from_millis(u64::from(i) * 750));
            assert!(observed.is_none(), "no alert expected for spread-out ports");
        }
    }

    #[test]
    fn interleaved_ports_from_two_sources_are_isolated() {
        let mut detector = PortScanDetector::new();
        let base = Instant::now();
        let src_a: IpAddr = "10.0.0.11".parse().unwrap();
        let src_b: IpAddr = "10.0.0.12".parse().unwrap();

        for i in 0..4 {
            assert!(detector
                .observe(src_a, 3000 + i, base + Duration::from_millis(u64::from(i) * 100))
                .is_none());
            assert!(detector
                .observe(src_b, 4000 + i, base + Duration::from_millis(u64::from(i) * 100))
                .is_none());
        }
    }

    #[test]
    fn cooldown_blocks_repeat_alerts_until_expired() {
        let mut detector = PortScanDetector::new();
        let base = Instant::now();
        let src: IpAddr = "10.0.0.13".parse().unwrap();

        for i in 0..9 {
            detector.observe(src, 5000 + i, base + Duration::from_millis(u64::from(i) * 50));
        }
        assert!(detector
            .observe(src, 5099, base + Duration::from_secs(1))
            .is_none(), "alert during cooldown must be suppressed");

        assert!(detector
            .observe(src, 5098, base + Duration::from_secs(1))
            .is_none(), "alert during cooldown must be suppressed");

        for i in 0..8 {
            detector.observe(src, 6000 + i, base + Duration::from_secs(6));
        }
        assert!(detector
            .observe(src, 6008, base + Duration::from_secs(6) + Duration::from_millis(50))
            .is_some(), "alert should fire again after cooldown expires");
    }
}
