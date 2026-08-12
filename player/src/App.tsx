import { useCallback, useEffect, useRef, useState } from "react";
import { initAudio, isAudioStarted, playNoteEvent } from "./audio/synth";
import { startReplay } from "./replay";
import { InstrumentPicker } from "./components/InstrumentPicker";
import { PianoRoll, type TimestampedNoteEvent } from "./components/PianoRoll";
import { RecordControls } from "./components/RecordControls";
import {
  connectWireSong,
  type NoteEvent,
  type WireSongConnection,
  type WireSongStatus,
} from "./ws";

const DEFAULT_URL = "ws://localhost:3000/ws";
const LOG_SIZE = 20;
const BANNER_MS = 3000;

const STATUS_COLORS: Record<WireSongStatus, string> = {
  connecting: "bg-amber-400",
  open: "bg-emerald-500",
  closed: "bg-zinc-600",
  error: "bg-red-500",
};

function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [status, setStatus] = useState<WireSongStatus>("closed");
  const [log, setLog] = useState<NoteEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [perSecond, setPerSecond] = useState(0);
  const [banner, setBanner] = useState<{ message: string; id: number } | null>(
    null,
  );
  const [audioOn, setAudioOn] = useState(false);
  const [replayRunning, setReplayRunning] = useState(false);
  const connectionRef = useRef<WireSongConnection | null>(null);
  const timestampsRef = useRef<number[]>([]);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventBufferRef = useRef<TimestampedNoteEvent[]>([]);
  const replayRef = useRef<{ stop: () => void } | null>(null);

  const enableAudio = useCallback(() => {
    void initAudio().then(() => setAudioOn(isAudioStarted()));
  }, []);

  const handleNoteEvent = useCallback((event: NoteEvent) => {
    playNoteEvent(event);
    eventBufferRef.current.push({ ...event, received_at_ms: performance.now() });
    timestampsRef.current.push(Date.now());
    setTotal((t) => t + 1);
    setLog((prev) => [event, ...prev].slice(0, LOG_SIZE));
  }, []);

  const showBanner = useCallback((message: string) => {
    setBanner({ message, id: Date.now() });
    if (bannerTimerRef.current !== null) {
      clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = setTimeout(() => setBanner(null), BANNER_MS);
  }, []);

  const startReplayDemo = useCallback(() => {
    replayRef.current?.stop();
    replayRef.current = startReplay({
      onNoteEvent: handleNoteEvent,
      onComplete: () => {
        replayRef.current = null;
        setReplayRunning(false);
        showBanner("Replay finished");
      },
    });
    setReplayRunning(true);
  }, [handleNoteEvent, showBanner]);

  const connect = useCallback(() => {
    connectionRef.current?.close();
    connectionRef.current = connectWireSong(url, {
      onNoteEvent: handleNoteEvent,
      onControlMessage: (msg) => showBanner(msg.message),
      onStatusChange: setStatus,
    });
  }, [url, handleNoteEvent, showBanner]);

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 font-mono">
      <h1 className="text-xl font-bold mb-4">WireSong</h1>

      <div className="flex items-center gap-2 mb-4">
        <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[status]}`} />
        <span data-testid="status">{status}</span>
        {replayRunning && (
          <span
            data-testid="replay-indicator"
            className="rounded bg-fuchsia-800 px-2 py-0.5 text-xs"
          >
            Replay Mode
          </span>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          data-testid="url-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2"
        />
        <button
          data-testid="connect-button"
          onClick={connect}
          disabled={replayRunning}
          className="bg-emerald-700 hover:bg-emerald-600 rounded px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Connect
        </button>
        <button
          data-testid="replay-button"
          onClick={startReplayDemo}
          disabled={replayRunning || status === "open" || status === "connecting"}
          className="bg-fuchsia-800 hover:bg-fuchsia-700 rounded px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ▶ Try Live Demo (no backend needed)
        </button>
        <InstrumentPicker />
        <RecordControls />
        {!audioOn && (
          <button
            data-testid="audio-button"
            onClick={enableAudio}
            className="bg-sky-700 hover:bg-sky-600 rounded px-4 py-2"
          >
            🔊 Enable Audio
          </button>
        )}
        <span data-testid="audio-status" className="self-center">
          Audio: {audioOn ? "on" : "off"}
        </span>
      </div>

      <div className="flex gap-6 mb-4">
        <span>
          total: <span data-testid="total">{total}</span>
        </span>
        <span>
          events/sec: <span data-testid="per-second">{perSecond}</span>
        </span>
      </div>

      {banner !== null && (
        <div
          key={banner.id}
          data-testid="control-banner"
          className="bg-amber-500 text-black rounded px-3 py-2 mb-4"
        >
          {banner.message}
        </div>
      )}

      <PianoRoll eventBufferRef={eventBufferRef} />

      <ul className="space-y-1" data-testid="event-log">
        {log.map((event, index) => (
          <li key={log.length - index} className="text-sm">
            <span className="text-zinc-500">{event.event_type}</span>{" "}
            pitch={event.pitch} pan={event.pan.toFixed(2)} size={event.size_bytes}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;
