import type { NoteEvent } from "./ws";
import replayData from "../../examples/replay-demo.json";

export interface ReplayHandlers {
  onNoteEvent: (event: NoteEvent) => void;
  onComplete: () => void;
}

const REPLAY_EVENTS: NoteEvent[] = replayData;

export function startReplay(handlers: ReplayHandlers): { stop: () => void } {
  let stopped = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const event of REPLAY_EVENTS) {
    timers.push(
      setTimeout(() => {
        if (!stopped) {
          handlers.onNoteEvent(event);
        }
      }, event.timestamp_ms),
    );
  }
  const lastTimestampMs = REPLAY_EVENTS.length > 0 ? REPLAY_EVENTS[REPLAY_EVENTS.length - 1].timestamp_ms : 0;
  timers.push(
    setTimeout(() => {
      if (!stopped) {
        handlers.onComplete();
      }
    }, lastTimestampMs + 50),
  );

  return {
    stop() {
      stopped = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.length = 0;
    },
  };
}
