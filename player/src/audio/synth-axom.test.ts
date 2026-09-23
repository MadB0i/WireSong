import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent } from "../ws";

// No recordings exist in the repo, so every axom voice must resolve to its
// synthesized fallback. Stub fetch to 404 so the sampler probes fail fast
// and deterministically.
vi.mock("tone", () => {
  class MockBase {
    static created: { type: string; node: MockBase }[] = [];
    triggerCount = 0;
    constructor(type: string) {
      MockBase.created.push({ type, node: this });
    }
    triggerAttack() {
      this.triggerCount += 1;
    }
    triggerAttackRelease() {
      this.triggerCount += 1;
    }
    connect() {
      return this;
    }
    disconnect() {
      return;
    }
    dispose() {
      return;
    }
  }
  function makeClass(type: string) {
    return class extends MockBase {
      constructor() {
        super(type);
      }
    };
  }
  class MockSampler {
    connect() {
      return this;
    }
    disconnect() {
      return;
    }
    triggerAttackRelease() {
      return;
    }
    add() {
      return;
    }
    dispose() {
      return;
    }
  }
  return {
    PluckSynth: makeClass("pluck"),
    NoiseSynth: makeClass("noise"),
    MetalSynth: makeClass("metal"),
    Synth: makeClass("synth"),
    FMSynth: makeClass("fm"),
    MonoSynth: makeClass("mono"),
    MembraneSynth: makeClass("membrane"),
    Filter: makeClass("filter"),
    Gain: makeClass("gain"),
    Panner: makeClass("panner"),
    Volume: makeClass("volume"),
    Sampler: MockSampler,
    Frequency: (pitch: number, fmt?: string) => ({
      toFrequency: () => 440 * 2 ** ((pitch - 69) / 12),
      toNote: () => (fmt === "midi" ? `N${pitch}` : "C"),
    }),
    gainToDb: (v: number) => v,
    now: () => 0,
    start: async () => undefined,
    get __created() {
      return MockBase.created;
    },
    __reset: () => {
      MockBase.created = [];
    },
  };
});

const tone = (await import("tone")) as unknown as {
  __created: { type: string; node: { triggerCount: number } }[];
  __reset: () => void;
};

const synth = await import("./synth");

function event(eventType: string): NoteEvent {
  return {
    timestamp_ms: 0,
    event_type: eventType,
    pitch: 64,
    degree: 2,
    velocity: 0.7,
    duration_ms: 600,
    pan: 0,
    size_bytes: 100,
  };
}

describe("axom pack (zero sample files)", () => {
  beforeEach(() => {
    tone.__reset();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps all 8 events, alarm flagged only on the pepa voice", () => {
    const table = synth.PACKS.axom;
    expect(Object.keys(table)).toHaveLength(8);
    for (const [eventType, voice] of Object.entries(table)) {
      expect(typeof voice.build).toBe("function");
      expect(voice.isAlarmVoice === true).toBe(eventType === "port_scan_alert");
    }
  });

  it("every voice falls back to its synth approximation", () => {
    const expected: [string, string][] = [
      ["tcp_syn", "pluck"],
      ["tcp_synack", "pluck"],
      ["tcp_rst", "noise"],
      ["dns_query", "metal"],
      ["http_data", "synth"],
      ["udp", "fm"],
      ["icmp", "fm"],
    ];
    for (const [eventType, type] of expected) {
      tone.__reset();
      synth.PACKS.axom[eventType].build(synth.midiToFrequency(64), event(eventType));
      expect(tone.__created.map((c) => c.type)).toContain(type);
    }
  });

  it("dotora answer plays an octave above the call", () => {
    tone.__reset();
    synth.setPortamentoSeconds(0);
    const freq = synth.midiToFrequency(64);
    synth.PACKS.axom.tcp_syn.build(freq, event("tcp_syn"));
    synth.PACKS.axom.tcp_synack.build(freq, event("tcp_synack"));
    expect(tone.__created.filter((c) => c.type === "pluck")).toHaveLength(2);
  });

  it("pepa alarm fires the reed phrase plus an 8-hit dhol roll", () => {
    tone.__reset();
    const alarm = event("port_scan_alert");
    const out = synth.PACKS.axom.port_scan_alert.build(synth.midiToFrequency(72), alarm);
    expect(out).toBeDefined();
    const mono = tone.__created.find((c) => c.type === "mono");
    const membrane = tone.__created.find((c) => c.type === "membrane");
    expect(mono, "pepa reed voice").toBeDefined();
    expect(membrane, "dhol voice").toBeDefined();
    expect(mono!.node.triggerCount).toBe(4);
    expect(membrane!.node.triggerCount).toBe(8);
  });

  it("rejects pack definitions that reference unknown voices", () => {
    expect(() =>
      synth.registerPackDefinition({
        id: "bogus",
        version: 1,
        displayName: "Bogus",
        tagline: "x",
        events: {
          tcp_syn: {
            voice: "nope",
            label: "x",
            role: "note",
            sample: null,
            fallbackSynth: { kind: "Synth" },
          },
        },
        samples: [],
      }),
    ).toThrow('unknown voice "nope"');
  });
});
