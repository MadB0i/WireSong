// One-off generator for examples/replay-demo.json.
// Produces ~200 NoteEvent objects spanning 60s of simulated activity.
// Run: node examples/generate-replay-demo.mjs > examples/replay-demo.json
// The fixture intentionally mirrors what live capture (Step 6-7) observed:
// tcp_syn/http_data most common, dns_query/icmp less frequent, one
// port-scan cluster (~10 tcp_syn in a 2s span) right before the alert
// around the 30s mark. The NoteEvent schema has no IP fields, so the
// "scan source" is only reflected in event density/timing (a comment
// here documents the conceptual 192.168.1.42 -> 192.168.1.1 scanner).

const SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function between(min, max) {
  return min + Math.random() * (max - min);
}
function intBetween(min, max) {
  return Math.round(between(min, max));
}

const PLANS = [
  { type: "tcp_syn", weight: 30, dur: [120, 250], size: [40, 60] },
  { type: "http_data", weight: 25, dur: [300, 900], size: [200, 2000] },
  { type: "tcp_synack", weight: 15, dur: [120, 250], size: [50, 70] },
  { type: "udp", weight: 12, dur: [100, 250], size: [80, 400] },
  { type: "dns_query", weight: 10, dur: [150, 300], size: [60, 200] },
  { type: "icmp", weight: 8, dur: [150, 400], size: [60, 100] },
];

const events = [];
let t = 0;

function pushEvent(type, whenMs, durMs, sizeBytes, pitch, pan) {
  events.push({
    timestamp_ms: Math.round(whenMs),
    event_type: type,
    pitch,
    velocity: Math.round(between(0.5, 0.95) * 100) / 100,
    duration_ms: durMs,
    pan: Math.round(pan * 100) / 100,
    size_bytes: sizeBytes,
  });
}

while (t < 60000) {
  const totalWeight = PLANS.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * totalWeight;
  let plan = PLANS[0];
  for (const p of PLANS) {
    roll -= p.weight;
    if (roll <= 0) {
      plan = p;
      break;
    }
  }
  t += between(120, 500);
  if (t >= 60000) break;
  pushEvent(plan.type, t, intBetween(...plan.dur), intBetween(...plan.size), pick(SCALE), between(-0.6, 0.6));
}

// Port-scan cluster: ~10 tcp_syn from the conceptual scanner
// (192.168.1.42 -> 192.168.1.1) within a 2s span, then the alert.
const scanStart = 29000;
for (let i = 0; i < 10; i++) {
  pushEvent("tcp_syn", scanStart + Math.random() * 2000, intBetween(120, 200), intBetween(40, 60), pick(SCALE), between(-0.6, 0.6));
}
pushEvent("port_scan_alert", 31150, 1200, 0, pick(SCALE), between(-0.4, 0.4));

events.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

// Ensure strictly monotonically increasing timestamps (defensive).
for (let i = 1; i < events.length; i++) {
  if (events[i].timestamp_ms <= events[i - 1].timestamp_ms) {
    events[i].timestamp_ms = events[i - 1].timestamp_ms + 1;
  }
}

// Timestamps start at 0 and span ~60s of simulated activity.
const minTs = events[0].timestamp_ms;
for (const event of events) {
  event.timestamp_ms -= minTs;
}

process.stdout.write(JSON.stringify(events, null, 2) + "\n");
