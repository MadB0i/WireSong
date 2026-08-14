import { describe, expect, it } from "vitest";
import {
  beginShareCapture,
  captureShareEvent,
  endShareCapture,
} from "./share";
import type { NoteEvent } from "./ws";

const EVENT: NoteEvent = {
  timestamp_ms: 1,
  event_type: "tcp_syn",
  pitch: 60,
  velocity: 80,
  duration_ms: 200,
  pan: 0.2,
  size_bytes: 60,
};

describe("share capture", () => {
  it("collects musical metadata while active", () => {
    beginShareCapture();
    captureShareEvent(EVENT);
    const recording = endShareCapture();
    expect(recording).not.toBeNull();
    expect(recording!.events).toHaveLength(1);
    expect(recording!.events[0]).toMatchObject({
      type: "tcp_syn",
      pitch: 60,
      velocity: 80,
      duration_ms: 200,
      pan: 0.2,
    });
    expect(recording!.events[0].t).toBeGreaterThanOrEqual(0);
    expect(recording!.ended_at).toBeGreaterThanOrEqual(recording!.started_at);
  });

  it("drops events outside an active capture", () => {
    captureShareEvent(EVENT);
    expect(endShareCapture()).toBeNull();
  });

  it("is empty after ending a capture", () => {
    beginShareCapture();
    captureShareEvent(EVENT);
    endShareCapture();
    expect(endShareCapture()).toBeNull();
  });
});