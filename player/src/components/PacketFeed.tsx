import { useEffect, useRef, type JSX, type RefObject } from "react";
import type { TimestampedNoteEvent } from "./PianoRoll";
import { colorForEventType } from "./PianoRoll";
import { packetFeedRow } from "./packetFeedFormat";

const MAX_ROWS = 40;
const RENDER_INTERVAL_MS = 250;

interface PacketFeedProps {
  eventBufferRef: RefObject<TimestampedNoteEvent[]>;
  redact: boolean;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function PacketFeed({ eventBufferRef, redact }: PacketFeedProps): JSX.Element {
  const containerRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const render = () => {
      const events = eventBufferRef.current;
      const rows = events.slice(Math.max(0, events.length - MAX_ROWS)).reverse();
      container.replaceChildren();
      for (const event of rows) {
        const { token, body, isAlert } = packetFeedRow(event, redact);
        const row = document.createElement("li");
        row.className = "feed-row";
        const tokenEl = document.createElement("span");
        tokenEl.className = isAlert ? "feed-token feed-alert" : "feed-token";
        tokenEl.style.color = colorForEventType(event.event_type);
        tokenEl.textContent = token;
        const bodyEl = document.createElement("span");
        bodyEl.className = isAlert ? "feed-body feed-alert" : "feed-body";
        bodyEl.textContent = `${formatClock(event.received_at_ms)} ${body}`;
        row.append(tokenEl, bodyEl);
        container.append(row);
      }
    };
    render();
    const interval = setInterval(render, RENDER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [eventBufferRef, redact]);

  return (
    <div
      data-testid="packet-feed"
      className="flex min-h-[140px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/25"
    >
      <header className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-aurora-400 to-cyan-glow" />
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          Packet feed
        </h2>
      </header>
      <ul
        ref={containerRef}
        data-testid="event-log"
        data-feed-testid="packet-feed-rows"
        className="feed-scroll max-h-56 flex-1 list-none overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-[1.7]"
      />
    </div>
  );
}