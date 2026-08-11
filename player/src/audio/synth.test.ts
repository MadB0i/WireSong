import { describe, expect, it } from "vitest";
import { midiToFrequency, velocityToDb, PACKS, type PackName } from "./synth";

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

describe("PACKS", () => {
  const packNames: PackName[] = ["ambient", "chiptune", "orchestral"];
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

  it("every pack has a buildable voice for all 8 backend event types", () => {
    for (const pack of packNames) {
      for (const eventType of backendEventTypes) {
        const voice = PACKS[pack][eventType];
        expect(voice, `${pack}/${eventType}`).toBeDefined();
        expect(typeof voice.build, `${pack}/${eventType}`).toBe("function");
      }
    }
  });

  it("flags only the port_scan_alert voice as an alarm voice", () => {
    for (const pack of packNames) {
      for (const eventType of backendEventTypes) {
        expect(PACKS[pack][eventType].isAlarmVoice === true, `${pack}/${eventType}`).toBe(
          eventType === "port_scan_alert",
        );
      }
    }
  });
});
