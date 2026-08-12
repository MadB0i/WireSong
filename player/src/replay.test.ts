import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startReplay } from "./replay";
import replayData from "../../examples/replay-demo.json";

const TOTAL_EVENTS = replayData.length;

describe("startReplay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires every event at its timestamp offset, then onComplete", () => {
    const onNoteEvent = vi.fn();
    const onComplete = vi.fn();
    startReplay({ onNoteEvent, onComplete });
    vi.advanceTimersByTime(60_000);
    expect(onNoteEvent).toHaveBeenCalledTimes(TOTAL_EVENTS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels pending timers mid-replay (no late events, no onComplete)", () => {
    const onNoteEvent = vi.fn();
    const onComplete = vi.fn();
    const replay = startReplay({ onNoteEvent, onComplete });
    vi.advanceTimersByTime(10_000);
    replay.stop();
    vi.advanceTimersByTime(60_000);
    const expectedBeforeStop = replayData.filter((e) => e.timestamp_ms < 10_000).length;
    expect(onNoteEvent).toHaveBeenCalledTimes(expectedBeforeStop);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("restarts cleanly after stop (fresh timers, correct pacing)", () => {
    const onNoteEvent = vi.fn();
    const onComplete = vi.fn();
    const first = startReplay({ onNoteEvent, onComplete });
    vi.advanceTimersByTime(5_000);
    first.stop();
    vi.advanceTimersByTime(30_000);
    const stale = onNoteEvent.mock.calls.length;

    startReplay({ onNoteEvent, onComplete });
    vi.advanceTimersByTime(5_000);
    const expected5s = replayData.filter((e) => e.timestamp_ms < 5_000).length;
    expect(onNoteEvent.mock.calls.length).toBe(stale + expected5s);
    vi.advanceTimersByTime(60_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
