# WireSong

[![CI](https://github.com/MadB0i/WireSong/actions/workflows/ci.yml/badge.svg)](https://github.com/MadB0i/WireSong/actions/workflows/ci.yml)

WireSong turns live network traffic into a real-time generative soundscape. Packets are captured and classified in Rust, quantized onto a pentatonic scale so that even heavy traffic sounds harmonious, and streamed to a browser that synthesizes each packet as an instrument voice — so a busy network literally hums along as it works. Anomalies are surfaced the same way your ears would want them: when a port scan is detected, a distinct four-note alarm cuts through the mix, plus a red band on a scrolling piano-roll visualization. It is sonification as an alerting mechanism, not just another dashboard. And it isn't audio-only anymore: a live packet feed, a real FFT spectrum, and a background layer that reacts to the mix give the same traffic a picture as well as a voice.

## Demo

![WireSong demo](docs/demo.gif)

*Illustrative mockup of the piano-roll view — mixed traffic scrolls by as colored bars, then a burst of SYNs triggers the port-scan alert: a red "SCAN" band sweeps across the display while a four-note rising arpeggio cuts into the mix.* This GIF is a stylized stand-in (built to match the real component's palette and layout), not a screen capture — swap it for a real recording whenever you get the chance:

<!-- TODO: replace docs/demo.gif with a real screen + audio recording. Quick recipe:
     1. Run the live pipeline (or the no-backend replay demo below) with sound on.
     2. Screen-record ~45–60s with OBS/ShareX, including a port-scan trigger.
     3. ffmpeg -i demo.mp4 -vf "fps=12,scale=760:-1:flags=lanczos" -loop 0 docs/demo.gif
     4. For a version with audio, keep an .mp4 too and link it here alongside the GIF. -->

Try it right now without any setup: `cd player && npm run build && npm run preview`, open the browser, and click **▶ Try Live Demo (no backend needed)** — a bundled 60-second replay of realistic traffic, no capture permissions or root required. A hosted copy is deployed to GitHub Pages at <https://MadB0i.github.io/WireSong/> (deployed via `.github/workflows/deploy-demo.yml`).

## How it works

```
packets ──► pcap capture ──► classify ──► port-scan detector
                                            │
                                  mapper (ambient.toml)
                                            │
                                    WebSocket (ws://127.0.0.1:3000/ws)
                                            │
                                 browser: NoteEvent stream
                                 │               │
                    Tone.js synth per event   PianoRoll + PacketFeed
                                 │             (canvas + event log)
                    Instrument Packs (timbre only)
                                 │
                             shared master bus
                                │         │
                                │         ├─► speakers
                                │         └─► Tone.Recorder (.webm download)
                                └─► analyser tap (128-bin FFT)
                                            │
                                SpectrumAnalyzer · AmbientBackground
```

The pipeline: a Rust backend captures raw packets with the `pcap` crate, classifies them into event types (TCP SYN/SYN-ACK/RST, DNS, HTTP, UDP, ICMP), feeds SYN packets into a port-scan detector, and maps every event to a musical `NoteEvent` (pitch, velocity, duration, pan). NoteEvents are broadcast over a WebSocket (channel capacity 512; a slow client gets a "you are lagging behind" control message rather than a silent stall). The browser synthesizes each event as a voice, draws it on a canvas piano roll, logs it in a packet feed, and sends everything through a shared master bus — which is also what the recorder taps for the WebM download and the analyser taps for the live spectrum and the ambient background.

Every NoteEvent also carries optional packet metadata — `src_ip`, `dst_ip`, `src_port`, `dst_port` — so the UI can show real addresses instead of just the musical mapping. The fields are defaulted to absent on the wire, so older fixtures (including the bundled `replay-demo.json`) still parse unchanged; the packet feed simply renders an em-dash (—) where an address is missing, by deliberate design rather than by accident.

**`capture/instruments/ambient.toml` is the single source of truth for the sonification mapping** (pitch, duration, velocity). The frontend "instrument packs" change only the timbre — which voice plays which event type — never the mapping. (Honest footnote: the `waveform` field in `ambient.toml` documents each event's intended character; the actual sound is chosen by the browser's pack table, since the backend emits note data, not audio.)

## The sonification mapping

All pitches are drawn from a **C major pentatonic scale across two octaves** — `[60, 62, 64, 67, 69, 72, 74, 76, 79, 81]` — chosen so any combination of simultaneous notes is consonant. Arbitrary port numbers are quantized onto it as `scale[port % 10]`, which is what makes random traffic sound musical instead of random.

| Event | duration (ms) | velocity base | pitch | pan | Notes |
|---|---|---|---|---|---|
| `tcp_syn` | 180 | 0.6 | `scale[port % 10]` | ±0.6 by direction | pluck-like voice in browser |
| `tcp_synack` | 180 | 0.7 | SYN's pitch **+ 2 scale degrees** (clamped to top) | ±0.6 by direction | answers the SYN two scale-degrees above — not raw semitones, so it always lands on the scale |
| `tcp_rst` | 80 | 0.25 | `scale[port % 10]` | ±0.6 by direction | short and quiet — resets barely register |
| `dns_query` | 300 | 0.5 | `scale[port % 10]` | ±0.6 by direction | bell-like |
| `http_data` | 300–900 | 0.5 | `scale[port % 10]` | ±0.6 by direction | duration interpolates with payload size (up to ~8 KB) — big transfers ring longer |
| `udp` | 100 | 0.4 | `scale[port % 10]` | ±0.6 by direction | pizzicato |
| `icmp` | 250 | 0.3 | `scale[port % 10]` | ±0.6 by direction | soft sine |
| `port_scan_alert` | 1200 | 1.0 | **fixed** `scale[5]` = MIDI 72 (C5, 523 Hz) | **always −0.6** (inbound side) | loudest note in the piece; browser plays it as a 4-note rising arpeggio [+0, +3, +6, +7] semitones from C5 |

Shared rules implemented in `capture/src/mapper.rs`:

- **Pitch** — `scale[port % scale.len()]`; the source port wins if no destination port, and non-port events still map through port 0.
- **Velocity** — `velocity_base + ln(size_bytes) / 100`, clamped to `[0, 1]`; zero-size events (pure SYN, alerts) use exactly the base.
- **Pan** — `+0.6` when the packet source is the local machine (outbound), `−0.6` when the destination is local (inbound), `0.0` (center) otherwise.

## Quickstart — Live mode

Prerequisites, by OS:

- **Linux**: install libpcap development headers — `sudo apt install libpcap-dev` (Debian/Ubuntu; equivalent package on other distros). Then either:
  - `sudo cargo run` for a quick one-off test — simple, works immediately; or
  - `sudo setcap cap_net_raw,cap_net_admin=eip ./target/debug/wiresong` for running **without sudo every time**. Tradeoff: setcap grants the binary raw-packet capabilities permanently (no password prompts on each run, better for repeated use) but needs re-applying after every rebuild, while sudo is fine if you only try this once.
- **Windows**: install the [Npcap](https://npcap.com/) SDK, and make sure `<Npcap SDK>\Lib\x64` (or `Lib` for a 32-bit toolchain) is on the **`LIB` environment variable** *before* `cargo build` — the `pcap` crate links against it and the build fails otherwise (exactly the issue hit during this project's first verification).

Then:

```bash
cd capture
cargo run -- --list            # find your interface name
cargo run -- --interface <name>   # start capturing (Ctrl+C to stop)
# optional: cargo run -- --interface <name> --max-packets 500   # bounded run
```

In a second terminal:

```bash
cd player
npm install
npm run dev
```

Open the shown URL, click **Connect** (the URL field already defaults to `ws://localhost:3000/ws`), then click **🔊 Enable Audio** — it must be a real click, because browser autoplay policies block audio otherwise. You should start hearing your own traffic immediately.

One design note: normal events are rate-limited to one per 20 ms at the capture side (`capture/src/capture.rs`) so bursts of traffic don't flood the socket — but `port_scan_alert` notes are sent **outside** that gate, so alerts are never dropped even under heavy traffic.

## Quickstart — Replay demo (no backend, no root needed)

```bash
cd player
npm run build && npm run preview
```

Open the preview URL and click **▶ Try Live Demo (no backend needed)**. A bundled 60-second replay of realistic traffic plays through the exact same pipeline — sounds, piano roll, pack switching, and the port-scan alarm at ~31 s all included. This is the easiest way to evaluate the project before bothering with capture privileges.

## Instrument packs

Four timbres, switchable at any time — even mid-note (a sustained pad keeps ringing when you switch packs mid-stream; verified by tests):

- **Ambient** — plucks, bells, soft pads and a sine drone; the default.
- **Chiptune** — square and triangle waves, stabby and retro.
- **Orchestral** — strings, brass stabs, celesta, pizzicato and flute.
- **Ensemble** — a guitar-led rhythm section: SYNs and SYN-ACKs are picked guitar, RSTs are muted, lowpassed thumps, UDP is staccato guitar, and HTTP data drops an octave as a triangle bass. DNS keeps the bell and ICMP the soft pad from Ambient, so the mix stays familiar.

One deliberate exception lives in Ensemble: its `port_scan_alert` layers **two voices per arpeggio note** — a plucked guitar plus a triangle bass an octave below — where every other pack plays a single voice. The rationale is contrast over complexity: an alarm should feel fuller and heavier than anything normal traffic can produce, and because both voices stay inside the pentatonic scale, the extra body reads as "louder and deeper", not as muddiness.

Pack selection changes only timbre; the pentatonic mapping above stays the same, so packs can be swapped instantly without the mix ever sounding wrong.

## Visual layers

The sound was the original point, but the same NoteEvent stream now also feeds a full visual layer. Everything below consumes real data — there are no decorative animations:

- **Packet feed** — a scrolling log of the most recent 40 events: an event token colored by type (e.g. `TCP_SYN`), a clock timestamp, and `src:port → dst:port` with byte size, rendered every 250 ms from the live event buffer. Alert rows render as `src → ??? ALERT`. IPs are redacted by default — the "Redact IPs" toggle starts checked: IPv4 addresses keep only their first two octets (`10.0.x.x`), IPv6 keeps all but the last four groups (`2001:db8::x:x:x:x`). Missing address fields (old fixtures) render as an em-dash (—). Note the redaction is a readability mask, not an anonymity guarantee (see limitations).
- **Live spectrum** — a real 128-bin FFT of the master bus drawn as bars, not a fake equalizer: the single analyser (a module-level singleton in `analyser.ts`) is tapped into the master bus, and every spectrum consumer reads the same instance — so what you see is exactly what the mixer hears. Before audio is started it shows a quiet idle placeholder instead.
- **Piano roll** — the scrolling note view gained three refinements: each note is vertically jittered by up to ±6 px (a deterministic hash of the event type plus arrival time — purely display-side, the underlying pitch data is untouched); gridlines for the ten scale notes are labeled with note names (e.g. `C5`); and bar height now follows velocity (4–10 px), so a 0.9-velocity SYN visibly outweighs a quiet RST.
- **Ambient background** — a full-viewport canvas behind all UI (z-index 0, `pointer-events: none`) showing a fixed node mesh: 42 nodes at deterministic seeded positions (a hard-coded `0x5eed13` seed, so the identical mesh appears on every load), linked whenever two nodes sit closer than 16% of the shorter viewport dimension. Nodes and links have a faint base opacity (0.2 / 0.055); once audio is playing, each node's glow is boosted by the same analyser's spectrum through `clamp01((db + 60) / 52)` — so the mesh quietly breathes as the mix changes and settles back to a static, barely-there wireframe when audio is off. It is reactive, not animated: no idle motion, no loops, just data.

## Port-scan detection

The detector in `capture/src/portscan.rs` watches TCP SYN packets per source IP: when a single source hits **more than 8 distinct destination ports within a 3-second window** (>8, so 9+), an alert fires, followed by a **5-second cooldown** for that source before it can fire again. Only SYN packets count.

Honest note: this is a demo-grade heuristic, not production IDS-grade — a bursty but legitimate client hammering many ports quickly (e.g., some peers or health-checkers) could theoretically look like a scan. The threshold/cooldown are cheap to tune in one constant each, but don't rely on it as a security control.

## Scope and honest limitations

- **Capture requires elevated privileges**: raw packet capture needs `CAP_NET_RAW`/`CAP_NET_ADMIN` (Linux) or Administrator (Windows/Npcap). That's inherent to sniffing packets, and the reason the replay demo exists as a zero-privilege alternative.
- **Windows loopback capture uses a different frame format**: loopback traffic arrives as `DLT_NULL` (a 4-byte link-layer header) rather than Ethernet, and the classifier handles both (`classify` vs `classify_ip` in `capture.rs`/`classify.rs`). Works, but it's a special case worth knowing about if you poke at the classifier.
- **Inbound IPv6 behind NAT64 was occasionally missed by Npcap** during testing (observed in Step 2's verification). If you test on a network with IPv6-only inbound connections, expect some events to vanish; this is a real, disclosed limitation of the capture layer.
- **No macOS testing has been done anywhere in this project.** It likely builds (the `pcap` crate supports macOS), but nothing has been verified on it — file an issue if you hit something.
- **Recording exports `.webm`** (Opus audio in a WebM container) — that's what `Tone.Recorder` actually produces in Chromium. The download is named `wiresong-<timestamp>.webm`; it opens in any modern browser or player. It is *not* a WAV file.
- **The ambient background is tuned for cost, not maximum fidelity**: its effective pixel density is capped at 1.5× device-pixel-ratio, so on high-DPI screens the full-viewport canvas is slightly less crisp than the rest of the UI. When audio is off it redraws at most every 250 ms — a static faint wireframe, never a looping animation. This is a deliberate performance/polish tradeoff, not an unfinished state.
- **Packet-feed IP redaction is a display mask, not anonymization**: it blanks the last two IPv4 octets and the last four IPv6 groups (the default view), but the full addresses still travel over the WebSocket and remain visible in captured logs or browser devtools. Don't treat the feed as a privacy control.

## Project structure

```
WireSong/
├── capture/          Rust backend: pcap capture, classification, port-scan detection,
│   │                 note mapping, WebSocket server (ws://127.0.0.1:3000/ws)
│   ├── src/          main.rs · capture.rs · classify.rs · portscan.rs · mapper.rs · ws.rs · config.rs
│   └── instruments/  ambient.toml — the sonification mapping (single source of truth)
├── player/           React 19 + TypeScript + Vite + Tone.js frontend
│   ├── src/audio/    synth.ts (voices, packs, master bus) · analyser.ts (shared FFT tap) · recorder.ts (WebM export)
│   ├── src/components/  AmbientBackground · InstrumentPicker · PacketFeed · PianoRoll · RecordControls · SpectrumAnalyzer · packetFeedFormat.ts
│   └── src/          App.tsx · ws.ts (WebSocket client) · replay.ts (demo replay)
├── examples/         replay-demo.json (bundled 60s demo fixture) + its generator
├── docs/             demo.gif
├── .github/          CI workflow (cargo test + npm test + build) + Pages deploy workflow
├── README.md
└── LICENSE
```

## License

[MIT](LICENSE)

## Contributing

Issues and pull requests are welcome — this is a small, friendly codebase, and the unit tests plus the E2E harnesses make it easy to change things without breaking them. There are known gaps documented above (macOS untested, NAT64 IPv6 quirks, demo-grade scan detection) if you want somewhere to start. If you open a PR, run `cargo test` in `capture/` and `npm test` in `player/` first.
