import { useEffect, useState, type ReactElement } from "react";
import { isAudioStarted } from "../audio/synth";
import {
  getRecordingElapsedMs,
  startRecording,
  stopRecording,
} from "../audio/recorder";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function extensionForType(mimeType: string): string {
  if (mimeType.includes("wav")) {
    return "wav";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("mpeg") || mimeType.includes("mp4")) {
    return "m4a";
  }
  return "webm";
}

export function RecordControls(): ReactElement {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [savedName, setSavedName] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const interval = setInterval(() => setElapsedMs(getRecordingElapsedMs()), 250);
    return () => clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    if (savedName === null) {
      return;
    }
    const timer = setTimeout(() => setSavedName(null), 3000);
    return () => clearTimeout(timer);
  }, [savedName]);

  const toggle = async () => {
    if (!recording) {
      setElapsedMs(0);
      startRecording();
      setRecording(true);
      return;
    }
    const blob = await stopRecording();
    setRecording(false);
    setElapsedMs(0);
    if (blob === null) {
      return;
    }
    const filename = `wiresong-${Date.now()}.${extensionForType(blob.type)}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setSavedName(filename);
  };

  return (
    <div
      data-testid="record-controls"
      className="flex items-center gap-2 rounded-sm border border-white/10 bg-black/40 px-2.5 py-1"
    >
      <button
        data-testid="record-button"
        onClick={toggle}
        disabled={!isAudioStarted()}
        className={
          recording
            ? "record-pulse rounded-sm bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-500"
            : "rounded-sm border border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {recording ? "■ Stop" : "● Record"}
      </button>
      <span
        data-testid="record-elapsed"
        className="font-mono text-[11px] text-zinc-400 tabular-nums"
      >
        {recording ? formatElapsed(elapsedMs) : savedName !== null ? `Saved: ${savedName}` : "idle"}
      </span>
    </div>
  );
}
