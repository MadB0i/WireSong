# WireSong

[![CI](https://github.com/MadB0i/WireSong/actions/workflows/ci.yml/badge.svg)](https://github.com/MadB0i/WireSong/actions/workflows/ci.yml)
[![GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-2ea44f)](https://MadB0i.github.io/WireSong/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

WireSong turns live network traffic into a real-time generative soundscape. Packets are captured and classified in Rust, quantized onto a pentatonic scale so that even heavy traffic sounds harmonious, and streamed to a browser that synthesizes each packet as an instrument voice — so a busy network literally hums along as it works. Anomalies are surfaced the same way your ears would want them: when a port scan is detected, a distinct four-note alarm cuts through the mix, plus a red band on a scrolling piano-roll visualization. It is sonification as an alerting mechanism, not just another dashboard.

## Features

- **Real-time sonification** — every classified packet becomes a musical note (pitch, velocity, duration, pan) on a pentatonic scale, so a busy network sounds like a generative soundtrack instead of noise
- **Anomalies you can hear** — a port-scan detector fires a distinct four-note alarm that cuts through the mix, with a red band on the piano roll
- **Four capture modes** — live NIC (libpcap/Npcap), offline `.pcap` replay, deterministic synthetic traffic, and a bundled in-browser demo replay (no privileges needed)
- **Live analytics** — event mix, top talkers, traffic sparkline, and scan alerts in the UI
- **Privacy-first by default** — IPs are masked in the UI and stripped from every export; an opt-in "Full IP view" reveals them on screen only (the WebSocket itself carries unredacted IPs — see limitations)
- **Shareable recordings** — export a standalone HTML page with embedded audio and synchronized piano-roll playback, zero external dependencies
- **Cultural packs** — folk/festival timbre packs (Assamese Bihu, Bodo folk skeletons and more) with raga scales, season calendars, and a drum layer; folk/festival/secular material only
- **Shipped for demo** — frontend live on GitHub Pages; backend ships with a ready-to-deploy Render blueprint (free tier, **not yet deployed** — see `DEPLOY.md`); CI runs Rust + TypeScript unit tests and Playwright E2E

## Demo

![WireSong demo](docs/demo.gif)

*A ~35-second screen capture of the live app: synthetic traffic streams in from the backend, the piano roll scrolls in pentatonic bars, the network graph draws live connections, the packet feed streams every event — and the occasional port-scan alarm cuts through with a red flash.*

To make your own: run `cargo run -- --synthetic --rate 20` in `capture/`, open the player and Connect, enable sound, and screen-record ~30 s (Win+G / OBS). Or skip video editing entirely and hit **● Record → ⬆ Share Page** in the app — you get a standalone HTML with the audio and visuals in one file, ready to send anywhere.

Try it right now without any setup: `cd player && npm run build && npm run preview`, open the browser, and click **▶ Try Live Demo** — a bundled 60-second replay of realistic traffic, no capture permissions or root required. A hosted copy is deployed to GitHub Pages at <https://MadB0i.github.io/WireSong/> (deployed via `.github/workflows/deploy-demo.yml`).

## How it works

```
packets ──► pcap capture ──► classify ──► port-scan detector
                                            │
                                  mapper (ambient.toml)
                                            │
                                    WebSocket (ws://127.0.0.1:3000/ws)
                                            │
                              browser: Tone.js synth per event
                                        │            │
                             Instrument Packs     shared master bus
                             (timbre only)        └─► speakers
                                                      └─► Tone.Recorder
                                                          (.webm download)
```

The pipeline: a Rust backend captures raw packets with the `pcap` crate, classifies them into event types (TCP SYN/SYN-ACK/RST, DNS, HTTP, UDP, ICMP), feeds SYN packets into a port-scan detector, and maps every event to a musical `NoteEvent` (pitch, velocity, duration, pan). NoteEvents are broadcast over a WebSocket (channel capacity 512; a slow client gets a "you are lagging behind" control message rather than a silent stall). The browser synthesizes each event as a voice, draws it on a canvas piano roll, and sends everything through a shared master bus — which is also what the recorder taps for the WebM download.

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

## Quickstart — Offline replay of real packets (no privileges)

The backend can replay a `.pcap` file through the exact same pipeline as live capture — useful for demos, deterministic testing, and benchmarks:

```bash
cd capture
cargo run -- --pcap samples/dns-mdns.pcap --max-packets 587
```

Sample captures are checked in under `capture/samples/` (from the Wireshark test suite): `dns-mdns.pcap`, `http2-data-reassembly.pcap`, `dis_voice_sample.pcap`, `http.pcap`. In replay mode the frontend connects exactly like live mode (`ws://127.0.0.1:3000/ws`).

## Quickstart — Synthetic traffic (zero privileges, hosted-demo mode)

`--synthetic` generates a realistic event mix (SYN/SYN-ACK/RST, DNS, HTTP, UDP, ICMP, with an occasional port-scan burst) at a configurable rate — no NIC, no admin, no pcap file:

```bash
cd capture
cargo run -- --synthetic --rate 20     # 20 notes/sec, runs until Ctrl+C
cargo run -- --synthetic --rate 20 --max-packets 100   # bounded run
```

This is the mode the deployed backend runs in (see below), so anyone can hear the app without touching a packet capture.

## Benchmark mode

`--bench` disables the note rate-limiter so capture+classify+map throughput can be measured. Replaying `dns-mdns.pcap` (587 packets, 414 notes) on a mid-range Windows dev machine:

| build | packets/s | notes/s |
|---|---|---|
| debug | ~12,300 | ~8,700 |
| release | ~16,000 | ~11,400 |

Throughput is decode-bound and scales with packet complexity; these are best-of-3 runs over a small capture, so treat them as order-of-magnitude. Benchmark a bigger capture the same way: `cargo run --release -- --pcap <file> --bench`.

## Hosted backend (Render)

> **Status: not deployed.** This is a ready-to-run blueprint; no Render instance exists yet. Exact click-through: [`DEPLOY.md`](DEPLOY.md) (~2 minutes).

`render.yaml` deploys the backend as a free Render web service running `--synthetic --rate 20`:

1. Push this repo to GitHub, then in Render: **New + → Blueprint** → select the repo.
2. Render builds with `cargo build --release` and starts with `./target/release/wiresong --synthetic --rate 20`. The `PORT` env var is honored (binds `0.0.0.0:$PORT`); locally it binds `127.0.0.1:3000`.
3. In the player, paste `wss://<your-service>.onrender.com/ws` into the URL field and Connect. (The Pages-hosted frontend is HTTPS, so the backend URL must be `wss://`, not `ws://`.)

Free instances sleep after ~15 min of inactivity and cold-start in a few seconds on the next visit — fine for a demo, worth knowing before a screen recording.

## Share a recording as a standalone page

After stopping a recording, the player offers **⬆ Share Page**: it exports a single self-contained HTML file with the audio embedded (base64) plus a canvas piano-roll that replays every note in sync — no external dependencies, works from `file://`, easy to attach to an email or a repo. Only musical metadata (pitch, timing, velocity, pan) is exported, never raw IPs: *IPs never leave the browser*.

## Instrument packs

Six timbres under the umbrella name **Cultural packs**, switchable at any time — even mid-note (a sustained pad keeps ringing when you switch packs mid-stream; verified by tests):

- **Ambient** — plucks, bells, soft pads and a sine drone; the default.
- **Chiptune** — square and triangle waves, stabby and retro.
- **Orchestral** — strings, brass stabs, celesta, pizzicato and flute.
- **Ensemble** — guitar, bass, bells and pads.
- **Axom (Bihu)** — অসম (বিহু) — Assamese Bihu folk (see mapping below). Status: placeholder, awaiting community review.
- **Bodo folk** — Bwisagu dance-season folk skeleton (kham, siphung, serja, jotha). Status: placeholder, instrument list unverified — review by Bodo musicians welcome.

Pack selection changes only timbre; the pentatonic mapping above stays the same, so packs can be swapped instantly without the mix ever sounding wrong. Culture packs add three optional layers, all driven by their own `pack.json` (never shared code): a **raga scale** reinterpretation of scale degrees (Bhupali default = today's pitches exactly; Yaman, Bhairav, Malkauns, Todi; optional Raga Clock by time of day; optional meend glide), a **festival calendar** (tempo range, density, drone weight, default raga, with auto-by-season), and a **step-grid drum layer** (tempo follows traffic, 80–160 BPM). See `docs/CULTURAL_PACKS.md` for the manifest schema and authoring guide.

### The Axom (Bihu) mapping

| Event | Voice | Character |
|---|---|---|
| `tcp_syn` | dotora (plucked 2-string lute) | plucked call |
| `tcp_synack` | dotora, answering an octave higher | plucked answer |
| `tcp_rst` | toka (bamboo clapper) | short and quiet |
| `dns_query` | taal (small cymbals) | bright tick |
| `http_data` | baanhi (bamboo flute) | sustain grows with payload size |
| `udp` | gogona (bamboo jaw-harp reed) | twangy |
| `icmp` | xutuli (small clay whistle) | soft |
| `port_scan_alert` | pepa (reed pipe) phrase + dhol roll | loudest in the mix |

Plus a sustained Sa-Pa drone bed under baseline traffic and a 16-step dhol grid (currently a placeholder marked `TODO: verify with a Bihu dhol player`). Recorded samples are lazy-loaded per voice with synthesized fallbacks, so the pack works with zero recordings; only self-recorded or CC0 samples are accepted (`player/src/packs/axom/samples/README.md`).

### Cultural notes

This pack is inspired by Assamese Bihu folk music — spring/harvest festival music and dance-season folk, with classical-scale ragas for pitch color. It contains no ritual or devotional material by design, and ships no recordings yet. If you are an Assamese or Bodo folk musician: the mappings, drum patterns, tunings, calendars, and local-script labels are all open for correction — feedback is welcome, and the "placeholder" badges clear only after community review.

### How to add a new culture pack

Packs are data (`player/src/packs/<id>/pack.json` + `samples/`), validated by a loader with clear errors. The engine is culture-agnostic, so a new pack rarely touches shared code: map the 8 events to existing or new fallback voices, add an optional rhythm grid, festival calendar, and drone, write the sample docs, and open a PR. Ideas: Baul folk, Manipuri pung folk, Carnatic scale pack. Full schema and checklist: `docs/CULTURAL_PACKS.md`.

## Port-scan detection

The detector in `capture/src/portscan.rs` watches TCP SYN packets per source IP: when a single source hits **more than 8 distinct destination ports within a 3-second window** (>8, so 9+), an alert fires, followed by a **5-second cooldown** for that source before it can fire again. Only SYN packets count.

Honest note: this is a demo-grade heuristic, not production IDS-grade — a bursty but legitimate client hammering many ports quickly (e.g., some peers or health-checkers) could theoretically look like a scan. The threshold/cooldown are cheap to tune in one constant each, but don't rely on it as a security control.

## Scope and honest limitations

- **Capture requires elevated privileges**: raw packet capture needs `CAP_NET_RAW`/`CAP_NET_ADMIN` (Linux) or Administrator (Windows/Npcap). That's inherent to sniffing packets, and the reason the replay demo exists as a zero-privilege alternative.
- **Windows loopback capture uses a different frame format**: loopback traffic arrives as `DLT_NULL` (a 4-byte link-layer header) rather than Ethernet, and the classifier handles both (`classify` vs `classify_ip` in `capture.rs`/`classify.rs`). Works, but it's a special case worth knowing about if you poke at the classifier.
- **Inbound IPv6 behind NAT64 was occasionally missed by Npcap** during testing (observed in Step 2's verification). If you test on a network with IPv6-only inbound connections, expect some events to vanish; this is a real, disclosed limitation of the capture layer.
- **No macOS testing has been done anywhere in this project.** It likely builds (the `pcap` crate supports macOS), but nothing has been verified on it — file an issue if you hit something.
- **Recording exports `.webm`** (Opus audio in a WebM container) — that's what `Tone.Recorder` actually produces in Chromium. The download is named `wiresong-<timestamp>.webm`; it opens in any modern browser or player. It is *not* a WAV file. For something more presentable, the **⬆ Share Page** export bundles the same audio into a standalone HTML page.
- **The backend redacts nothing** — IPs travel to the browser in plaintext over the WebSocket. The frontend redacts them for display, and share exports strip them entirely, but if you point the player at a hostile network, treat the stream as sensitive.

## Project structure

```
WireSong/
├── capture/          Rust backend: pcap capture, classification, port-scan detection,
│   │                 note mapping, WebSocket server (ws://127.0.0.1:3000/ws)
│   ├── src/          main.rs · capture.rs (live/offline/synthetic/bench) · classify.rs
│   │                 · portscan.rs · mapper.rs · ws.rs · config.rs
│   ├── instruments/  ambient.toml — the sonification mapping (single source of truth)
│   └── samples/      small .pcap fixtures from the Wireshark test suite (replay/bench)
├── player/           React 19 + TypeScript + Vite + Tone.js frontend
│   ├── src/audio/    synth.ts (voices, packs, master bus) · packs.ts (manifest loader/registry)
│   │                 · ragas.ts (raga engine + clock) · rhythm.ts (drum layer) · festivals.ts
│   │                 · samples.ts (lazy recordings + fallback) · drone.ts (Sa-Pa bed) · recorder.ts
│   ├── src/packs/    canonical pack.json manifests + sample docs (mirrored to public/packs/)
│   ├── scripts/      sync-packs.mjs (mirrors src/packs/ → public/packs/ on predev/prebuild)
│   ├── src/components/  InstrumentPicker · FestivalPicker · RagaPicker · PianoRoll · NetworkGraph
│   │                    · PacketFeed · SpectrumAnalyzer · RecordControls · AnalyticsPanel
│   ├── e2e/          Playwright end-to-end tests
│   └── src/          App.tsx · ws.ts (WebSocket client) · replay.ts (demo replay)
│                     · analytics.ts (live stats store) · share.ts (standalone HTML export)
├── examples/         replay-demo.json (bundled 60s demo fixture) + its generator
├── docs/             demo.gif (real screen capture) · DESIGN.md · CULTURAL_PACKS.md
├── DEPLOY.md         exact Render + Pages deploy steps
├── render.yaml       Render blueprint: deploys the backend in synthetic mode
├── .github/          CI workflow (cargo test + npm test + build + Playwright E2E)
│                     + Pages deploy workflow
├── README.md
└── LICENSE
```

## License

[MIT](LICENSE)

## Contributing

Issues and pull requests are welcome — this is a small, friendly codebase, and the unit tests plus the E2E harnesses make it easy to change things without breaking them. There are known gaps documented above (macOS untested, NAT64 IPv6 quirks, demo-grade scan detection) if you want somewhere to start. If you open a PR, run `cargo test` in `capture/` and `npm test` in `player/` first.
