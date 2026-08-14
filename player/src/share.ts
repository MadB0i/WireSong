import type { NoteEvent } from "./ws";

export interface ShareNoteEvent {
  t: number;
  type: string;
  pitch: number;
  velocity: number;
  duration_ms: number;
  pan: number;
}

export interface ShareRecording {
  events: ShareNoteEvent[];
  started_at: number;
  ended_at: number;
}

const MAX_EVENTS = 5000;

let active = false;
let startedAtMs = 0;
const events: ShareNoteEvent[] = [];

export function beginShareCapture(): void {
  events.length = 0;
  active = true;
  startedAtMs = Date.now();
}

export function captureShareEvent(event: NoteEvent): void {
  if (!active || events.length >= MAX_EVENTS) {
    return;
  }
  events.push({
    t: Math.max(0, Date.now() - startedAtMs),
    type: event.event_type,
    pitch: event.pitch,
    velocity: event.velocity,
    duration_ms: event.duration_ms,
    pan: event.pan,
  });
}

export function endShareCapture(): ShareRecording | null {
  active = false;
  if (events.length === 0) {
    return null;
  }
  const recording: ShareRecording = {
    events: [...events],
    started_at: startedAtMs,
    ended_at: Date.now(),
  };
  events.length = 0;
  return recording;
}

function buildSharePage(recording: ShareRecording, audioDataUrl: string | null): string {
  const durationMs = Math.max(1, recording.ended_at - recording.started_at);
  const eventCount = recording.events.length;
  const startedIso = new Date(recording.started_at).toISOString();
  const payload = JSON.stringify(recording.events);

  const audioHtml =
    audioDataUrl === null
      ? ""
      : `
        <audio id="ws-audio" controls preload="auto" src="${audioDataUrl}"></audio>
        <button id="ws-play">▶ Play soundscape</button>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WireSong — Network Soundscape</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(1100px 600px at 80% -10%, rgba(124,58,237,.28), transparent 60%),
      radial-gradient(900px 520px at -10% 110%, rgba(34,211,238,.18), transparent 55%),
      radial-gradient(700px 400px at 50% 50%, rgba(52,211,153,.06), transparent 60%),
      #07090f;
    color: #e4e4e7;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    width: min(880px, 100%);
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.09);
    border-radius: 20px;
    padding: 28px;
    backdrop-filter: blur(14px);
    box-shadow: 0 30px 80px rgba(0,0,0,.5);
  }
  h1 {
    font-size: 26px;
    margin: 0;
    letter-spacing: -.02em;
  }
  h1 em { font-style: normal; background: linear-gradient(90deg,#34d399,#a78bfa,#22d3ee); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { color: #71717a; font-size: 13px; margin: 6px 0 20px; }
  .stats { display: flex; gap: 18px; flex-wrap: wrap; margin: 18px 0; font-size: 12px; color: #a1a1aa; }
  .stats b { display: block; font-size: 20px; color: #fafafa; font-variant-numeric: tabular-nums; }
  canvas { width: 100%; height: 220px; border-radius: 12px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.06); }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #71717a; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .controls { display: flex; gap: 10px; margin: 18px 0 4px; align-items: center; }
  button {
    background: linear-gradient(90deg,#059669,#7c3aed);
    color: #fff; border: 0; border-radius: 999px;
    padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  button:hover { filter: brightness(1.1); }
  audio { width: min(420px, 100%); }
  .footer { margin-top: 18px; font-size: 11px; color: #52525b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .bar { fill: #34d399; }
</style>
</head>
<body>
  <div class="card">
    <h1>Wire<em>Song</em> — Network Soundscape</h1>
    <p class="sub">your network traffic, as a generative soundscape · captured ${startedIso.slice(0, 19).replace("T", " ")} UTC</p>
    <div class="stats">
      <div><b>${eventCount}</b>events sonified</div>
      <div><b>${(durationMs / 1000).toFixed(1)}s</b>recording</div>
      <div><b>${(eventCount / Math.max(1, durationMs / 1000)).toFixed(1)}</b>notes / second</div>
    </div>
    <div class="controls">${audioHtml}</div>
    <canvas id="ws-canvas"></canvas>
    <div class="legend">
      <span><i style="background:#60a5fa"></i>tcp_syn</span>
      <span><i style="background:#818cf8"></i>tcp_synack</span>
      <span><i style="background:#64748b"></i>tcp_rst</span>
      <span><i style="background:#a78bfa"></i>dns_query</span>
      <span><i style="background:#22d3ee"></i>http_data</span>
      <span><i style="background:#2dd4bf"></i>udp</span>
      <span><i style="background:#e879f9"></i>icmp</span>
      <span><i style="background:#ef4444"></i>port_scan_alert</span>
    </div>
    <p class="footer">generated with <a href="https://github.com/anomalyco/WireSong" style="color:#34d399">WireSong</a> · musical metadata only, no raw IPs exported</p>
  </div>
<script>
(function () {
  const EVENTS = ${payload};
  const COLORS = {
    tcp_syn: "#60a5fa", tcp_synack: "#818cf8", tcp_rst: "#64748b",
    dns_query: "#a78bfa", http_data: "#22d3ee", udp: "#2dd4bf",
    icmp: "#e879f9", port_scan_alert: "#ef4444",
  };
  const WINDOW_MS = 8000;
  const PITCH_MIN = 60, PITCH_MAX = 84;
  const BAR_H = 7, MIN_W = 2;
  const audio = document.getElementById("ws-audio");
  const playBtn = document.getElementById("ws-play");
  if (playBtn && audio) {
    playBtn.addEventListener("click", function () { audio.currentTime = 0; void audio.play(); });
  }
  const canvas = document.getElementById("ws-canvas");
  const ctx = canvas.getContext("2d");
  let dpr = 1;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();
  const durationMs = Math.max(1, ${durationMs});
  let startOffset = performance.now();
  function frame(nowMs) {
    const t = audio && !audio.paused ? audio.currentTime * 1000 : (nowMs - startOffset) * 0.4;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const xTo = function (t0) { return (t0 / durationMs) * w; };
    ctx.strokeStyle = "rgba(251,191,36,.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xTo(t), 0);
    ctx.lineTo(xTo(t), h);
    ctx.stroke();
    for (let i = 0; i < EVENTS.length; i++) {
      const e = EVENTS[i];
      if (e.t > t + 200 || e.t < t - WINDOW_MS) continue;
      const age = (t - e.t) / WINDOW_MS;
      const alpha = Math.max(0.08, 1 - age);
      const clamped = Math.min(PITCH_MAX, Math.max(PITCH_MIN, e.pitch));
      const y = ((PITCH_MAX - clamped) / (PITCH_MAX - PITCH_MIN)) * (h - BAR_H);
      const bw = Math.max(MIN_W, (e.duration_ms / durationMs) * w * 1.6);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS[e.type] || "#94a3b8";
      ctx.beginPath();
      ctx.roundRect(xTo(e.t), y, Math.max(bw, MIN_W), BAR_H + (e.velocity / 127) * 5, 3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
}

function download(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportSharePage(
  recording: ShareRecording,
  audioBlob: Blob | null,
): Promise<string> {
  let audioDataUrl: string | null = null;
  if (audioBlob !== null && audioBlob.size > 0) {
    audioDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(audioBlob);
    });
  }
  const html = buildSharePage(recording, audioDataUrl);
  download(html, `wiresong-soundscape-${recording.started_at}.html`);
  return html;
}