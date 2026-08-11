import { describe, expect, it } from "vitest";
import { midiToFrequency, velocityToDb, WAVEFORM_BY_EVENT } from "./synth";

describe("midiToFrequency", () => {
  it("maps MIDI 69 (A4) to ~440 Hz", () => {
    expect(midiToFrequency(69)).toBeGreaterThan(439);
    expect(midiToFrequency(69)).toBeLessThan(441);
  });
});

describe("velocityToDb", () => {
  it("clamps 0 so it never returns -Infinity or NaN", () => {
    const db = velocityToDb(0);
    expect(Number.isFinite(db)).toBe(true);
    expect(db).toBeGreaterThan(-100);
  });

  it("maps 1.0 to ~0 dB", () => {
    const db = velocityToDb(1.0);
    expect(Math.abs(db)).toBeLessThan(0.01);
  });
});

describe("WAVEFORM_BY_EVENT", () => {
  it("has a waveform entry for all 8 backend event types", () => {
    const backendEventTypes = [
      "tcp_syn",
      "tcp_synack",
      "tcp_rst",
      "dns_query",
      "http_data",
      "udp",
      "icmp",
      "port_scan_alert",
    ];
    for (const eventType of backendEventTypes) {
      expect(WAVEFORM_BY_EVENT[eventType], eventType).toBeDefined();
    }
  });
});
