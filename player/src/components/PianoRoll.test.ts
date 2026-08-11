import { describe, expect, it } from "vitest";
import {
  colorForEventType,
  pitchToY,
  pruneExpired,
  timeToX,
  VISIBLE_WINDOW_MS,
} from "./PianoRoll";
import type { TimestampedNoteEvent } from "./PianoRoll";

const HEIGHT = 200;

describe("pitchToY", () => {
  it("maps higher pitch to smaller y", () => {
    expect(pitchToY(81, HEIGHT)).toBeLessThan(pitchToY(60, HEIGHT));
  });

  it("clamps out-of-range pitches into the valid y range", () => {
    const above = pitchToY(120, HEIGHT);
    const below = pitchToY(20, HEIGHT);
    expect(above).toBeGreaterThanOrEqual(0);
    expect(above).toBeLessThanOrEqual(HEIGHT);
    expect(below).toBeGreaterThanOrEqual(0);
    expect(below).toBeLessThanOrEqual(HEIGHT);
  });
});

describe("timeToX", () => {
  it("maps age 0 to the right edge and VISIBLE_WINDOW_MS to the left edge", () => {
    expect(timeToX(0, 800)).toBe(800);
    expect(timeToX(VISIBLE_WINDOW_MS, 800)).toBe(0);
  });
});

describe("colorForEventType", () => {
  it("returns 8 distinct colors for the 8 event types", () => {
    const types = [
      "tcp_syn",
      "tcp_synack",
      "tcp_rst",
      "dns_query",
      "http_data",
      "udp",
      "icmp",
      "port_scan_alert",
    ];
    const colors = new Set(types.map(colorForEventType));
    expect(colors.size).toBe(8);
  });
});

describe("pruneExpired", () => {
  it("keeps only events within the window and does not mutate the input", () => {
    const nowMs = 10_000;
    const events: TimestampedNoteEvent[] = [
      { ...makeNote(), received_at_ms: nowMs - 0 },
      { ...makeNote(), received_at_ms: nowMs - 4000 },
      { ...makeNote(), received_at_ms: nowMs - 9000 },
    ];
    const result = pruneExpired(events, nowMs);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.received_at_ms)).toEqual([10_000, 6_000]);
    expect(events).toHaveLength(3);
  });
});

function makeNote(): Omit<TimestampedNoteEvent, "received_at_ms"> {
  return {
    timestamp_ms: 0,
    event_type: "tcp_syn",
    pitch: 60,
    velocity: 0.5,
    duration_ms: 180,
    pan: 0.6,
    size_bytes: 100,
  };
}
