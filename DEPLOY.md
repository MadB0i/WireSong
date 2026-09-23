# Deploy guide

Two deploys, both free: the player (static) on GitHub Pages and the capture
backend on Render. CI (`.github/workflows/ci.yml`) runs Rust tests, player
unit tests + build, and Playwright E2E on every push/PR; Pages deploys from
`main` via `.github/workflows/deploy-demo.yml`.

## Frontend — GitHub Pages (already live)

Automatic: pushing to `main` builds `player/` with
`npm run build -- --base=/WireSong/` and publishes `player/dist`.
Verify at <https://MadB0i.github.io/WireSong/> — the demo replay, pack
manifests (`/WireSong/packs/<id>/pack.json`), and share export should all
work with no backend.

## Backend — Render (blueprint ready, one manual click left)

> **Status: not deployed.** Everything below is ready; a human with Render
> access still needs to click through once (~2 minutes).

`render.yaml` at the repo root is a complete Render Blueprint:

```yaml
services:
  - type: web
    name: wiresong-capture
    runtime: rust
    plan: free
    region: oregon
    buildCommand: cargo build --release
    startCommand: ./target/release/wiresong --synthetic --rate 20
    healthCheckPath: /
```

Exact steps:

1. Push this repo to GitHub (public or private — Render reads either).
2. In Render: **New + → Blueprint** → connect/select the repo.
   Render detects `render.yaml` and shows one service,
   `wiresong-capture`.
3. Confirm the plan is **Free**, region **Oregon** (or your pick), then
   **Apply**. Render runs `cargo build --release` (first build takes
   several minutes — Rust compiles `pcap` and friends from scratch) and
   starts `./target/release/wiresong --synthetic --rate 20`.
   - Synthetic mode needs no capture privileges and no NIC: it generates
     a realistic event mix at 20 notes/sec. This is deliberate — a hosted
     capture box cannot sniff its neighbors' traffic anyway.
   - The server honors the `PORT` env var (binds `0.0.0.0:$PORT` when set,
     `127.0.0.1:3000` locally). Render injects `PORT` automatically.
4. Wait for **Live** (health check `GET /` returns
   `WireSong capture server is running`), then copy the service URL:
   `https://wiresong-capture.onrender.com` (or your custom name).
5. In the player (local or Pages), paste
   `wss://<your-service>.onrender.com/ws` into the URL field and Connect.
   - The Pages frontend is HTTPS, so the backend URL **must** be `wss://`,
     not `ws://`. The WS handler is transport-agnostic; nothing else changes.
6. Update this file and the README status line to **deployed** with the URL.

Free-tier notes: instances sleep after ~15 min of inactivity and cold-start
in a few seconds on the next visit — fine for a demo, worth knowing before
a screen recording. If the socket drops overnight, just Connect again
(the player reconnects with backoff automatically).

## After deploying

- [ ] Flip the README "Hosted backend" status to deployed with the live URL.
- [ ] Smoke-test: Connect from the Pages frontend, hear ~20 notes/sec,
      trigger a share export, confirm no IPs in the HTML.
- [ ] Optional: raise `--rate` (restarts the service) or set a custom domain.
