import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RAGA_ID,
  PENTA_SCALE,
  RAGAS,
  alertMidis,
  degreeForEvent,
  getActiveRaga,
  getActiveRagaId,
  getRaga,
  getRagaId,
  isRagaClockEnabled,
  ragaDegreeToMidi,
  ragaForHour,
  setRaga,
  setRagaClockEnabled,
} from "./ragas";
import type { NoteEvent } from "../ws";

function event(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {
    timestamp_ms: 0,
    event_type: "tcp_syn",
    pitch: 64,
    velocity: 0.5,
    duration_ms: 180,
    pan: 0,
    size_bytes: 60,
    ...overrides,
  };
}

describe("raga table", () => {
  it("has the five required ragas with 4-note in-scale alert phrases", () => {
    expect(RAGAS.map((r) => r.id)).toEqual(["bhupali", "yaman", "bhairav", "malkauns", "todi"]);
    for (const raga of RAGAS) {
      expect(raga.alertDegrees).toHaveLength(4);
      expect(raga.semitones.length).toBeGreaterThanOrEqual(5);
      const midis = alertMidis(raga);
      expect(midis).toHaveLength(4);
      for (const midi of midis) {
        expect(raga.semitones).toContain(((midi - 60) % 12 + 12) % 12);
      }
    }
  });

  it("alert phrases rise overall (alarm character)", () => {
    for (const raga of RAGAS) {
      const midis = alertMidis(raga);
      expect(midis[3]).toBeGreaterThan(midis[0]);
    }
  });

  it("getRaga throws a clear error for unknown ids", () => {
    expect(() => getRaga("nope")).toThrow('unknown raga "nope"');
  });
});

describe("ragaDegreeToMidi", () => {
  it("Bhupali degrees 0-9 reproduce today's pentatonic scale exactly", () => {
    const bhupali = getRaga("bhupali");
    const midis = Array.from({ length: 10 }, (_, d) => ragaDegreeToMidi(bhupali, d));
    expect(midis).toEqual(PENTA_SCALE);
  });

  it("wraps octaves for degrees beyond the raga length", () => {
    const bhupali = getRaga("bhupali");
    expect(ragaDegreeToMidi(bhupali, 5)).toBe(72);
    expect(ragaDegreeToMidi(bhupali, 7)).toBe(76);
    const yaman = getRaga("yaman");
    expect(ragaDegreeToMidi(yaman, 7)).toBe(72);
  });
});

describe("degreeForEvent", () => {
  it("prefers the backend degree when in range", () => {
    expect(degreeForEvent(event({ pitch: 60, degree: 7 }))).toBe(7);
  });

  it("derives the degree from pitch for legacy payloads", () => {
    expect(degreeForEvent(event({ pitch: 76 }))).toBe(PENTA_SCALE.indexOf(76));
    expect(degreeForEvent(event({ pitch: 60, degree: undefined }))).toBe(0);
  });

  it("falls back to pitch arithmetic for off-scale pitches", () => {
    expect(degreeForEvent(event({ pitch: 61 }))).toBe(((61 - 60) % 10 + 10) % 10);
  });
});

describe("ragaForHour (Raga Clock)", () => {
  it("maps morning to Bhairav, midday to Bhupali, evening to Yaman, night to Malkauns", () => {
    expect(ragaForHour(6)).toBe("bhairav");
    expect(ragaForHour(12)).toBe("bhupali");
    expect(ragaForHour(18)).toBe("yaman");
    expect(ragaForHour(23)).toBe("malkauns");
    expect(ragaForHour(2)).toBe("malkauns");
  });

  it("respects the documented boundaries", () => {
    expect(ragaForHour(4)).toBe("bhairav");
    expect(ragaForHour(11)).toBe("bhupali");
    expect(ragaForHour(16)).toBe("yaman");
    expect(ragaForHour(21)).toBe("malkauns");
  });
});

describe("raga selection state", () => {
  beforeEach(() => {
    setRaga(DEFAULT_RAGA_ID);
    setRagaClockEnabled(false);
  });

  it("defaults to Bhupali with the clock off", () => {
    expect(getRagaId()).toBe("bhupali");
    expect(isRagaClockEnabled()).toBe(false);
    expect(getActiveRagaId(18)).toBe("bhupali");
  });

  it("manual selection sticks when the clock is off", () => {
    setRaga("yaman");
    expect(getActiveRagaId(6)).toBe("yaman");
    expect(getActiveRaga(6).id).toBe("yaman");
  });

  it("clock overrides the manual selection by hour", () => {
    setRaga("yaman");
    setRagaClockEnabled(true);
    expect(getActiveRagaId(6)).toBe("bhairav");
    expect(getActiveRagaId(18)).toBe("yaman");
  });

  it("setRaga rejects unknown ids", () => {
    expect(() => setRaga("nope")).toThrow('unknown raga "nope"');
    expect(getRagaId()).toBe("bhupali");
  });
});
