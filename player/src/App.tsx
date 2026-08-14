import { useCallback, useEffect, useRef, useState } from "react";
import {
  initAudio,
  isAudioStarted,
  playNoteEvent,
  setAudioMuted,
} from "./audio/synth";
import { startReplay } from "./replay";
import { recordAnalytics, resetAnalytics } from "./analytics";
import { InstrumentPicker } from "./components/InstrumentPicker";
import {
  PianoRoll,
  EVENT_TYPE_COLORS,
  type TimestampedNoteEvent,
} from "./components/PianoRoll";
import { PacketFeed } from "./components/PacketFeed";
import { SpectrumAnalyzer } from "./components/SpectrumAnalyzer";
import { AmbientBackground } from "./components/AmbientBackground";
import { NetworkGraph } from "./components/NetworkGraph";
import { RecordControls } from "./components/RecordControls";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import {
  connectWireSong,
  type NoteEvent,
  type WireSongConnection,
  type WireSongStatus,
} from "./ws";

const DEFAULT_URL = "ws://localhost:3000/ws";
const BANNER_MS = 3000;

const STATUS_COLORS: Record<WireSongStatus, string> = {
  connecting: "bg-amber-400",
  open: "bg-emerald-400",
  closed: "bg-zinc-600",
  error: "bg-red-500",
};

const LEGEND_EVENTS = [
  "tcp_syn",
  "tcp_synack",
  "tcp_rst",
  "dns_query",
  "http_data",
  "udp",
  "icmp",
  "port_scan_alert",
];

const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97]";

const EQ_BARS = [0, 1, 2, 3, 4];

function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [status, setStatus] = useState<WireSongStatus>("closed");
  const [total, setTotal] = useState(0);
  const [perSecond, setPerSecond] = useState(0);
  const [banner, setBanner] = useState<{ message: string; id: number } | null>(
    null,
  );
  const [audioOn, setAudioOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [replayRunning, setReplayRunning] = useState(false);
  const [redactIps, setRedactIps] = useState(true);
  const connectionRef = useRef<WireSongConnection | null>(null);
  const timestampsRef = useRef<number[]>([]);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventBufferRef = useRef<TimestampedNoteEvent[]>([]);
  const replayRef = useRef<{ stop: () => void } | null>(null);

  const enableAudio = useCallback(() => {
    void initAudio().then(() => setAudioOn(isAudioStarted()));
  }, []);

  const toggleAudio = useCallback(() => {
    if (!audioOn) {
      enableAudio();
      return;
    }
    const next = !muted;
    setAudioMuted(next);
    setMuted(next);
  }, [audioOn, muted, enableAudio]);

  const handleNoteEvent = useCallback((event: NoteEvent) => {
    playNoteEvent(event);
    const now = performance.now();
    eventBufferRef.current.push({ ...event, received_at_ms: now });
    timestampsRef.current.push(Date.now());
    recordAnalytics(event, Date.now());
    setTotal((t) => t + 1);
  }, []);

  const showBanner = useCallback((message: string) => {
    setBanner({ message, id: Date.now() });
    if (bannerTimerRef.current !== null) {
      clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = setTimeout(() => setBanner(null), BANNER_MS);
  }, []);

  const stopReplayDemo = useCallback(() => {
    replayRef.current?.stop();
    replayRef.current = null;
    setReplayRunning(false);
  }, []);

  const startReplayDemo = useCallback(() => {
    enableAudio();
    replayRef.current?.stop();
    resetAnalytics();
    replayRef.current = startReplay({
      onNoteEvent: handleNoteEvent,
      onComplete: () => {
        replayRef.current = null;
        setReplayRunning(false);
        showBanner("Replay finished");
      },
    });
    setReplayRunning(true);
  }, [enableAudio, handleNoteEvent, showBanner]);

  const connect = useCallback(() => {
    enableAudio();
    connectionRef.current?.close();
    resetAnalytics();
    connectionRef.current = connectWireSong(url, {
      onNoteEvent: handleNoteEvent,
      onControlMessage: (msg) => showBanner(msg.message),
      onStatusChange: setStatus,
    });
  }, [enableAudio, url, handleNoteEvent, showBanner]);

  const disconnect = useCallback(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setStatus("closed");
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 1000;
      timestampsRef.current = timestampsRef.current.filter((t) => t >= cutoff);
      setPerSecond(timestampsRef.current.length);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      connectionRef.current?.close();
      connectionRef.current = null;
      replayRef.current?.stop();
      replayRef.current = null;
      if (bannerTimerRef.current !== null) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  const audioLabel = !audioOn
    ? "🔊 Enable Audio"
    : muted
      ? "🔈 Unmute Audio"
      : "🔇 Mute Audio";

  return (
    <div className="relative min-h-screen text-zinc-100">
      <div className="app-backdrop" />
      <div className="app-grid" />
      <div className="app-grain" />
      <AmbientBackground />

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-6">
        <header className="mb-4 flex items-center gap-3">
          <svg
            viewBox="0 0 44 26"
            className="h-8 w-14 shrink-0"
            fill="none"
            aria-hidden
          >
            <rect
              x="1"
              y="1"
              width="42"
              height="24"
              rx="2"
              stroke="rgba(232, 234, 238, 0.35)"
              strokeWidth="1"
            />
            <path
              d="M3 13h8v-5h4v8h4v-6h6v7h4v-4h4v4h4v-6h4"
              stroke="#34d399"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              Wire
              <span className="bg-gradient-to-r from-aurora-400 via-violet-glow to-cyan-glow bg-clip-text text-transparent">
                Song
              </span>
            </h1>
            <p className="text-xs text-zinc-500">
              your network traffic, as a generative soundscape
            </p>
          </div>
          <div className="ml-auto flex h-12 items-end gap-1" data-testid="equalizer">
            {EQ_BARS.map((i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-gradient-to-t from-aurora-600/60 via-aurora-400 to-cyan-glow/90 transition-[height] duration-300 ease-out"
                style={{
                  height: `${Math.min(48, 14 + perSecond * 12 + i * 3)}px`,
                }}
              />
            ))}
          </div>
        </header>

        <div className="mb-3 flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium backdrop-blur-md">
            <span
              className={`status-dot h-2 w-2 rounded-full ${STATUS_COLORS[status]}`}
            />
            <span data-testid="status" className="font-mono text-zinc-200">
              {status}
            </span>
          </span>
          {replayRunning && (
            <span
              data-testid="replay-indicator"
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-glow/40 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-300 backdrop-blur-md"
            >
              <span className="status-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
              Replay Mode
            </span>
          )}
        </div>

        <section className="glass rounded-2xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="url-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="min-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 backdrop-blur-md transition focus:border-aurora-400/60 focus:outline-none focus:ring-2 focus:ring-aurora-500/25"
            />
            <button
              data-testid="connect-button"
              onClick={connect}
              disabled={replayRunning}
              className={`${PRIMARY_BTN} border-transparent bg-gradient-to-r from-aurora-600 to-violet-glow text-white shadow-lg shadow-aurora-600/30 hover:shadow-aurora-500/40 hover:brightness-110`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              Connect
            </button>
            {(status === "open" || status === "connecting") && (
              <button
                data-testid="disconnect-button"
                onClick={disconnect}
                className={`${PRIMARY_BTN} border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                >
                  <path d="M5 12h14" />
                </svg>
                Disconnect
              </button>
            )}
            <button
              data-testid="replay-button"
              onClick={startReplayDemo}
              disabled={
                replayRunning || status === "open" || status === "connecting"
              }
              className={`${PRIMARY_BTN} border-violet-glow/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20`}
            >
              ▶ Try Live Demo
            </button>
            {replayRunning && (
              <button
                data-testid="stop-replay-button"
                onClick={stopReplayDemo}
                className={`${PRIMARY_BTN} border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20`}
              >
                ■ Stop Demo
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
            <div className="ml-auto flex items-center gap-2">
              <RecordControls />
              <button
                data-testid="audio-button"
                onClick={toggleAudio}
                className={
                  audioOn && !muted
                    ? `${PRIMARY_BTN} border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10`
                    : `${PRIMARY_BTN} border-transparent bg-gradient-to-r from-aurora-600 to-violet-glow text-white shadow-lg shadow-aurora-600/30 hover:brightness-110`
                }
              >
                {audioLabel}
              </button>
              <span
                data-testid="audio-status"
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-mono text-[11px] text-zinc-400 backdrop-blur-md"
              >
                Audio:{" "}
                <span className="text-zinc-200">
                  {audioOn ? (muted ? "on · muted" : "on") : "off"}
                </span>
              </span>
            </div>
          </div>

          {banner !== null && (
            <div
              key={banner.id}
              data-testid="control-banner"
              className="banner-in mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-200 backdrop-blur-md"
            >
              {banner.message}
            </div>
          )}

          <div className="mt-3 border-t border-white/5 pt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-aurora-400 to-cyan-glow" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                Sound pack
              </h2>
            </div>
            <InstrumentPicker />
          </div>
        </section>

        <section className="glass mt-4 rounded-2xl px-5 pb-1 pt-4">
          <SpectrumAnalyzer />
        </section>

        <section className="mt-4 border-t border-white/5 pt-3">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-start gap-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              <span>total events</span>
              <p
                data-testid="total"
                className="font-mono text-2xl font-semibold text-zinc-50 tabular-nums"
              >
                {total}
              </p>
            </div>
            <div className="flex flex-col items-start gap-0.5 ml-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              <span>events/sec</span>
              <p
                data-testid="per-second"
                className="font-mono text-2xl font-semibold text-zinc-50 tabular-nums"
              >
                {perSecond}
              </p>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent flex-1 mx-4"></div>
        </section>

        <section className="glass mt-4 rounded-2xl p-3">
          <header className="flex items-center gap-2 px-2 pb-2 pt-0.5">
            <span className="status-dot h-1.5 w-1.5 rounded-full bg-gradient-to-r from-aurora-400 to-cyan-glow" />
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              Piano roll
            </h2>
            <span className="ml-auto font-mono text-[11px] text-zinc-600">
              8s window · pentatonic
            </span>
          </header>
          <PianoRoll eventBufferRef={eventBufferRef} />
          <footer
            data-testid="event-legend"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 px-2 pt-1.5"
          >
            {LEGEND_EVENTS.map((eventType) => (
              <span
                key={eventType}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-500"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: EVENT_TYPE_COLORS[eventType] }}
                />
                {eventType}
              </span>
            ))}
          </footer>
        </section>

        <section className="glass mt-4 rounded-2xl p-3">
          <header className="flex items-center gap-2 px-2 pb-2 pt-0.5">
            <span className="status-dot h-1.5 w-1.5 rounded-full bg-gradient-to-r from-aurora-400 to-cyan-glow" />
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              Network graph
            </h2>
            <span className="ml-auto font-mono text-[11px] text-zinc-600">
              live connections · local node pinned
            </span>
          </header>
          <NetworkGraph eventBufferRef={eventBufferRef} redactIps={redactIps} />
          <footer className="border-t border-white/5 px-2 pt-1.5 font-mono text-[10px] text-zinc-600">
            hover a node for details · dots travel src → dst per event
          </footer>
        </section>

        <section className="glass mt-4 rounded-2xl">
          <PacketFeed
            eventBufferRef={eventBufferRef}
            redact={redactIps}
            onRedactChange={setRedactIps}
          />
        </section>

        <div className="mt-4">
          <AnalyticsPanel redact={redactIps} />
        </div>

        <footer className="mt-6 text-center font-mono text-[11px] text-zinc-600">
          WireSong · network sonification · MIT
        </footer>
      </div>
    </div>
  );
}

export default App;