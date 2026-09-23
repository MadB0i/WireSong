import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent } from "../ws";

// Tone is mocked: these tests only check which builder class the glide
// switch selects, never real audio.
vi.mock("tone", () => {
  class MockBase {
    static created: { type: string }[] = [];
    triggerAttack() {
      return;
    }
    triggerAttackRelease() {
      return;
    }
    connect() {
      return this;
    }
    dispose() {
      return;
    }
    constructor(type: string) {
      MockBase.created.push({ type });
    }
  }
  function makeClass(type: string) {
    return class extends MockBase {
      constructor() {
        super(type);
      }
    };
  }
  return {
    Synth: makeClass("synth"),
    FMSynth: makeClass("fm"),
    MonoSynth: makeClass("mono"),
    MetalSynth: makeClass("metal"),
    PluckSynth: makeClass("pluck"),
    Filter: makeClass("filter"),
    Gain: makeClass("gain"),
    Panner: makeClass("panner"),
    Volume: makeClass("volume"),
    Frequency: (pitch: number) => ({
      toFrequency: () => 440 * 2 ** ((pitch - 69) / 12),
    }),
    gainToDb: (v: number) => v,
    now: () => 0,
    start: async () => undefined,
    __reset: () => {
      MockBase.created = [];
    },
    get __created() {
      return MockBase.created;
    },
  };
});

const tone = (await import("tone")) as unknown as {
  __created: { type: string }[];
  __reset: () => void;
};

const synth = await import("./synth");

const EVENT: NoteEvent = {
  timestamp_ms: 0,
  event_type: "http_data",
  pitch: 64,
  degree: 2,
  velocity: 0.7,
  duration_ms: 600,
  pan: 0,
  size_bytes: 100,
};

describe("meend (portamento) switch", () => {
  beforeEach(() => {
    tone.__reset();
    synth.setPortamentoSeconds(0);
  });

  it("defaults to zero (original code path)", () => {
    expect(synth.getPortamentoSeconds()).toBe(0);
  });

  it("clamps negative values to zero", () => {
    synth.setPortamentoSeconds(-1);
    expect(synth.getPortamentoSeconds()).toBe(0);
  });

  it("sustained voices stay on their original builders when glide is off", () => {
    synth.PACKS.ambient.http_data.build(synth.midiToFrequency(64), EVENT);
    synth.PACKS.orchestral.http_data.build(synth.midiToFrequency(64), EVENT);
    synth.PACKS.orchestral.icmp.build(synth.midiToFrequency(64), EVENT);
    expect(tone.__created.map((c) => c.type)).toEqual(["synth", "fm", "synth"]);
  });

  it("sustained voices switch to MonoSynth glide builders when enabled", () => {
    synth.setPortamentoSeconds(synth.MEEND_GLIDE_SECONDS);
    synth.PACKS.ambient.http_data.build(synth.midiToFrequency(64), EVENT);
    synth.PACKS.orchestral.http_data.build(synth.midiToFrequency(64), EVENT);
    synth.PACKS.orchestral.icmp.build(synth.midiToFrequency(64), EVENT);
    expect(tone.__created.map((c) => c.type)).toEqual(["mono", "mono", "mono"]);
  });
});
