# WireSong — Design Notes

A Rust backend turns packets into musical note events; a browser synthesizes them.
This document captures the architecture and the *why* behind the interesting choices.

## Goals

- Sonify live network traffic at real time with a musical (not noise-like) result.
- Make anomalies audible: a port scan should *sound* like something is wrong.
- Zero-friction demos: replay a bundled fixture, replay a real pcap, or generate
  synthetic traffic — no capture privileges required for any of the three.
- Strong verification story: unit tests on both sides, E2E tests against the real UI.

## System overview

```
        live NIC │ --pcap file │ --synthetic
                 ▼
        ┌─────────────────────┐     capture/src/capture.rs
        │ capture_loop        │   shared pipeline, generic over pcap::Activated
        │  next_packet()      │   (live Device and Offline file are both Activated)
        └───────┬─────────────┘
                ▼
        classify (Ethernet/DLT_NULL frames → ClassifiedEvent)
                │ TCP SYN? ──► PortScanDetector ──► PortScanAlert
                ▼
        Mapper::map / map_alert  (ambient.toml → NoteEvent: pitch·velocity·duration·pan)
                ▼
        broadcast::channel(512) ──► axum WebSocket (ws://…/ws)
                ▼
        browser: Tone.js synth per event → master bus → speakers
                                          └→ Tone.Recorder (webm)
        React: piano roll · network graph · packet feed · analytics
               · share export (standalone HTML with embedded audio)
```

### Capture loop is shared

`capture_loop<T: pcap::Activated>` is one function over live captures *and* offline
replays (`--pcap`). The only differences are the source (device vs file) and a flag:
the note rate-limiter (one note / 20 ms) is enabled in live/replay modes so bursts
don't flood the socket, and disabled under `--bench` to measure raw throughput.

### Rate limiting vs alert priority

Normal notes are throttled; `port_scan_alert` notes bypass the gate entirely.
Rationale: the sonification is a *display* — dropping a few normal notes under a
burst is fine — but an alert must never be lost, or the ears learn to ignore it.

## Sonification design

- **Pentatonic only.** `scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81]` (C major
  pentatonic, two octaves). Any subset of these pitches is consonant, so arbitrary
  concurrent traffic always sounds intentional. Port numbers quantize onto it as
  `scale[port % 10]` — cheap, deterministic, musical.
- **Direction in the stereo field.** Outbound (local source) pans +0.6, inbound −0.6,
  center otherwise. Your ears can tell who is talking to whom.
- **Alert ≠ louder note, alert = different *pattern*.** The scan alert is the loudest
  single note, always on the inbound side, and the browser renders it as a
  four-note rising arpeggio [+0, +3, +6, +7]. A fixed musical motif, not just a
  big blip — memorable, and distinct from any traffic-derived pitch.
- **The mapping lives in one file.** `capture/instruments/ambient.toml` is the single
  source of truth (pitch/velocity/duration rules). The browser's "instrument packs"
  change only timbre (which voice plays which event type), never the mapping — so
  switching packs mid-stream never breaks the harmony.

## Frontend architecture

- **Single event path.** Every incoming `NoteEvent` flows through one handler in
  `App.tsx`: synth playback, the 8 s piano-roll buffer, per-second counter,
  analytics store, and the share-capture buffer. Visualizers read from a shared
  `useRef` buffer and redraw on rAF — no per-event React state churn.
- **Module-level stores** (`analytics.ts`, `share.ts`) rather than context or a state
  library: they are append-only counters/buffers with tiny surface areas, tested
  as pure functions.
- **Redaction is a display concern.** IPs arrive in the browser because the network
  graph needs endpoints, but the UI redacts them for display, and the share export
  (`share.ts`) strips them from the data entirely — the exported HTML contains
  only musical metadata.

## Deployment

- **Frontend**: static build → GitHub Pages (`deploy-demo.yml`).
- **Backend**: `render.yaml` (Render blueprint) — Rust runtime, `cargo build --release`,
  started with `--synthetic --rate 20` so the hosted instance is legal to run for
  anyone and deterministic enough to demo. `PORT` is honored (binds `0.0.0.0:$PORT`
  when present, `127.0.0.1:3000` locally). Because Pages is HTTPS, clients must
  connect with `wss://` — the WS handler is transport-agnostic, so nothing else changes.

## Verification

- Rust: `cargo test` — classify (v4/v6, DLT_NULL), port-scan window/cooldown,
  mapper pitch/pan/duration rules, WS message shapes (31 tests).
- Player: `npm test` (Vitest, 48 tests) + `npm run e2e` (Playwright, 4 tests:
  shell render, live-demo streaming, IP-visibility toggle, share-page export
  round-trip).
- CI runs all three (`.github/workflows/ci.yml`), plus `npm run lint` (oxlint) and
  `npm run build` (tsc + Vite) locally.
- `--bench` gives a throughput number that can be checked in the README (order of
  magnitude ~16k packets/s decode, ~11k notes/s on release builds).

## Known limitations (and why)

- **Capture needs privileges** — inherent to raw packet capture; that is exactly why
  replay and synthetic modes exist.
- **Redaction is cosmetic.** Plaintext IPs cross the WebSocket; worth saying out
  loud before pointing the player at sensitive traffic.
- **Port-scan detector is demo-grade** — 9+ distinct ports from one source in 3 s,
  5 s cooldown. Deliberately simple constants; tune in `portscan.rs`.
- **WebM-only recordings** — whatever `Tone.Recorder` gives Chromium; the share-page
  export is the presentation-friendly path.
- **macOS untested**, NAT64 IPv6 inbound quirks on Npcap observed.
