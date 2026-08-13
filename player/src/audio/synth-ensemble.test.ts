import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent } from "../ws";

vi.mock("tone", () => {
  interface Created {
    type: string;
    node: MockBase;
  }

  class MockBase {
    type: string;
    opts: Record<string, unknown>;
    triggerCount = 0;
    lastFreqs: number[] = [];

    constructor(type: string, opts: Record<string, unknown> = {}) {
      this.type = type;
      this.opts = opts;
      MockBase.created.push({ type, node: this });
    }

    triggerAttack(freq: number): void {
      this.triggerCount += 1;
      this.lastFreqs.push(freq);
    }

    triggerAttackRelease(freq: number): void {
      this.triggerCount += 1;
      this.lastFreqs.push(freq);
    }

    connect(): MockBase {
      return this;
    }

    dispose(): void {
      return;
    }

    static created: Created[] = [];
  }

  function makeClass(type: string) {
    return class extends MockBase {
      constructor(opts: Record<string, unknown> = {}) {
        super(type, opts);
      }
    };
  }

  const PluckSynth = makeClass("pluck");
  const Synth = makeClass("synth");
  const FMSynth = makeClass("fm");
  const MetalSynth = makeClass("metal");
  const MonoSynth = makeClass("mono");
  const Filter = makeClass("filter");
  const Gain = class extends MockBase {
    gain: { setValueAtTime: () => void; setTargetAtTime: () => void; cancelScheduledValues: () => void; value: number };
    constructor() {
      super("gain");
      this.gain = {
        setValueAtTime: () => undefined,
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
        value: 1,
      };
    }
  };
  const Panner = makeClass("panner");
  const Volume = makeClass("volume");

  return {
    PluckSynth,
    Synth,
    FMSynth,
    MetalSynth,
    MonoSynth,
    Filter,
    Gain,
    Panner,
    Volume,
    Frequency: (pitch: number) => ({
      toFrequency: () => 440 * 2 ** ((pitch - 69) / 12),
    }),
    gainToDb: (v: number) => 20 * Math.log10(v),
    now: () => 0,
    start: async () => {
      return;
    },
    get __created() {
      return MockBase.created;
    },
    __reset: () => {
      MockBase.created = [];
    },
  };
});

const tone = (await import("tone")) as unknown as {
  __created: { type: string; node: { triggerCount: number; lastFreqs: number[] } }[];
  __reset: () => void;
};

const synth = await import("./synth");

const EVENT: NoteEvent = {
  timestamp_ms: 0,
  event_type: "http_data",
  pitch: 64,
  velocity: 0.7,
  duration_ms: 600,
  pan: 0,
  size_bytes: 100,
};

describe("ensemble pack", () => {
  beforeEach(() => {
    tone.__reset();
  });

  it("http_data (bass) triggers at exactly half the frequency ambient's pad uses for the same pitch", () => {
    const freq = synth.midiToFrequency(64);
    synth.PACKS.ambient.http_data.build(freq, EVENT);
    synth.PACKS.ensemble.http_data.build(freq, EVENT);
    const pad = tone.__created.find((c) => c.type === "synth");
    const bass = tone.__created.find((c) => c.type === "mono");
    expect(pad, "ambient pad voice constructed").toBeDefined();
    expect(bass, "ensemble bass voice constructed").toBeDefined();
    expect(pad!.node.lastFreqs[0]).toBeCloseTo(freq, 4);
    expect(bass!.node.lastFreqs[0]).toBeCloseTo(freq / 2, 4);
  });

  it("only the ensemble bass voice transposes down an octave (guitar stays at pitch)", () => {
    const freq = synth.midiToFrequency(57);
    tone.__reset();
    synth.PACKS.ensemble.tcp_syn.build(freq, EVENT);
    synth.PACKS.ensemble.udp.build(freq, EVENT);
    synth.PACKS.ensemble.http_data.build(freq, EVENT);
    const plucks = tone.__created.filter((c) => c.type === "pluck");
    expect(plucks.length).toBe(2);
    for (const p of plucks) {
      expect(p.node.lastFreqs[0]).toBeCloseTo(freq, 4);
    }
    const bass = tone.__created.find((c) => c.type === "mono");
    expect(bass!.node.lastFreqs[0]).toBeCloseTo(freq / 2, 4);
  });

  it("ensemble alarm fires 2 voices per arpeggio note (8 triggers); others fire exactly 1 per note (4)", () => {
    for (const pack of ["ambient", "chiptune", "orchestral", "ensemble"] as const) {
      tone.__reset();
      const alarmEvent: NoteEvent = { ...EVENT, event_type: "port_scan_alert", duration_ms: 800 };
      synth.PACKS[pack].port_scan_alert.build(synth.midiToFrequency(64), alarmEvent);
      const voices = tone.__created.filter((c) =>
        ["synth", "fm", "pluck", "mono"].includes(c.type),
      );
      const total = voices.reduce((sum, v) => sum + v.node.triggerCount, 0);
      if (pack === "ensemble") {
        const guitar = voices.find((v) => v.type === "pluck");
        const bass = voices.find((v) => v.type === "mono");
        expect(guitar).toBeDefined();
        expect(bass).toBeDefined();
        expect(guitar!.node.triggerCount).toBe(4);
        expect(bass!.node.triggerCount).toBe(4);
        expect(bass!.node.lastFreqs[0]).toBeCloseTo(guitar!.node.lastFreqs[0] / 2, 4);
        expect(voices.length).toBe(2);
      } else {
        expect(voices.length).toBe(1);
      }
      expect(total).toBe(pack === "ensemble" ? 8 : 4);
    }
  });
});