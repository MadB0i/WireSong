import { useEffect, useRef, type JSX, type RefObject } from "react";
import type { NoteEvent } from "../ws";

export const VISIBLE_WINDOW_MS = 8000;
export const PITCH_MIN = 60;
export const PITCH_MAX = 84;
const BAR_HEIGHT = 6;
const CANVAS_HEIGHT = 200;
const MIN_BAR_WIDTH = 2;
// Mirrors capture/instruments/ambient.toml's [scale] notes — keep in sync.
const SCALE_NOTES = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

export type TimestampedNoteEvent = NoteEvent & { received_at_ms: number };

const COLORS_BY_EVENT: Record<string, string> = {
  tcp_syn: "#38bdf8",
  tcp_synack: "#818cf8",
  tcp_rst: "#64748b",
  dns_query: "#a78bfa",
  http_data: "#34d399",
  udp: "#22d3ee",
  icmp: "#2dd4bf",
  port_scan_alert: "#ef4444",
};
const FALLBACK_COLOR = "#94a3b8";
const ALARM_BAND_RGBA = "rgba(239, 68, 68, 0.25)";
const NOW_LINE_RGBA = "rgba(251, 191, 36, 0.9)";

export function pitchToY(pitch: number, canvasHeight: number): number {
  const clamped = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
  const ratio = (PITCH_MAX - clamped) / (PITCH_MAX - PITCH_MIN);
  return ratio * (canvasHeight - BAR_HEIGHT);
}

export function timeToX(ageMs: number, canvasWidth: number): number {
  const clamped = Math.min(VISIBLE_WINDOW_MS, Math.max(0, ageMs));
  return canvasWidth * (1 - clamped / VISIBLE_WINDOW_MS);
}

export function colorForEventType(eventType: string): string {
  return COLORS_BY_EVENT[eventType] ?? FALLBACK_COLOR;
}

export function pruneExpired(
  events: TimestampedNoteEvent[],
  nowMs: number,
): TimestampedNoteEvent[] {
  return events.filter(
    (event) => nowMs - event.received_at_ms <= VISIBLE_WINDOW_MS,
  );
}

interface PianoRollProps {
  eventBufferRef: RefObject<TimestampedNoteEvent[]>;
}

export function PianoRoll({ eventBufferRef }: PianoRollProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container === null || canvas === null) {
      return;
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(CANVAS_HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let rafId = 0;
    let lastLogAt = 0;

    const draw = (events: TimestampedNoteEvent[], nowMs: number) => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = canvas.clientWidth;
      const height = CANVAS_HEIGHT;

      ctx.clearRect(0, 0, width, height);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      for (const note of SCALE_NOTES) {
        const y = pitchToY(note, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.strokeStyle = NOW_LINE_RGBA;
      ctx.beginPath();
      ctx.moveTo(width - 1, 0);
      ctx.lineTo(width - 1, height);
      ctx.stroke();

      for (const event of events) {
        const ageMs = nowMs - event.received_at_ms;
        const x = timeToX(ageMs, width);
        if (event.event_type === "port_scan_alert") {
          ctx.fillStyle = ALARM_BAND_RGBA;
          ctx.fillRect(x - 2, 0, 4, height);
          ctx.fillStyle = COLORS_BY_EVENT.port_scan_alert;
          ctx.font = "bold 11px monospace";
          ctx.fillText("SCAN", x + 4, 14);
          continue;
        }
        const y = pitchToY(event.pitch, height);
        const barWidth = Math.max(
          MIN_BAR_WIDTH,
          (event.duration_ms / VISIBLE_WINDOW_MS) * width,
        );
        ctx.fillStyle = colorForEventType(event.event_type);
        roundRect(ctx, x - barWidth / 2, y - BAR_HEIGHT / 2, barWidth, BAR_HEIGHT, 2);
        ctx.fill();
      }
    };

    const loop = () => {
      const nowMs = performance.now();
      eventBufferRef.current = pruneExpired(eventBufferRef.current, nowMs);
      draw(eventBufferRef.current, nowMs);
      if (nowMs - lastLogAt >= 2000) {
        lastLogAt = nowMs;
        console.debug("WireSong eventBuffer length:", eventBufferRef.current.length);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [eventBufferRef]);

  return (
    <div
      ref={containerRef}
      data-testid="piano-roll"
      className="w-full rounded border border-zinc-800 bg-zinc-900/40 overflow-hidden"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
