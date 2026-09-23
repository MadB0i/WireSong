import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteEvent } from "../ws";

// Culture packs ship with zero recordings, so every sampled voice must
// resolve to its synthesized fallback. Stub fetch to 404 so the sampler
// probes fail fast and deterministically. All assertions are driven by the
// pack manifests — no culture, festival, or season names appear here.
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
    toDestination() {
      return this;
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
const packs = await import("./packs");

function event(eventType: string, portAlert = false): NoteEvent {
  return {
    timestamp_ms: 0,
    event_type: eventType,
    pitch: portAlert ? 72 : 64,
    degree: portAlert ? 5 : 2,
    velocity: 0.7,
    duration_ms: 600,
    pan: 0,
    size_bytes: 100,
  };
}

// Expected fallback builder per voice id (timbre-registry vocabulary).
const FALLBACK_TYPE: Record<string, string> = {
  dotora: "pluck",
  dotora_high: "pluck",
  toka: "noise",
  taal: "metal",
  baanhi: "synth",
  gogona: "fm",
  xutuli: "fm",
  kham: "membrane",
  kham_high: "membrane",
  jotha: "metal",
  siphung: "synth",
  serja: "fm",
};

function packEventForVoice(voice: string): { packId: string; eventType: string } {
  for (const packId of packs.PACK_IDS) {
    const def = packs.BUNDLED_PACKS[packId];
    for (const [eventType, entry] of Object.entries(def.events)) {
      if (entry.voice === voice) {
        return { packId, eventType };
      }
    }
  }
  throw new Error(`no pack event uses voice "${voice}"`);
}

describe("culture-pack fallback voices", () => {
  beforeEach(() => {
    tone.__reset();
    synth.setPortamentoSeconds(0);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    synth.setVoicePack("ambient");
  });

  it("every pack maps all 8 events, alarm flagged only on port_scan_alert", () => {
    for (const packId of packs.PACK_IDS) {
      const table = synth.PACKS[packId];
      expect(Object.keys(table)).toHaveLength(8);
      for (const [eventType, voice] of Object.entries(table)) {
        expect(typeof voice.build).toBe("function");
        expect(voice.isAlarmVoice === true, `${packId}/${eventType}`).toBe(
          eventType === "port_scan_alert",
        );
      }
    }
  });

  it("every voice builds its fallback approximation with zero recordings", () => {
    for (const [voice, type] of Object.entries(FALLBACK_TYPE)) {
      tone.__reset();
      const { packId, eventType } = packEventForVoice(voice);
      synth.setVoicePack(packId);
      synth.PACKS[packId][eventType].build(synth.midiToFrequency(64), event(eventType));
      expect(tone.__created.map((c) => c.type), voice).toContain(type);
    }
  });

  it("every alarm voice fires a multi-note phrase plus its drum roll", () => {
    for (const packId of packs.PACK_IDS) {
      tone.__reset();
      synth.setVoicePack(packId);
      const alarm = event("port_scan_alert", true);
      synth.PACKS[packId].port_scan_alert.build(synth.midiToFrequency(72), alarm);
      const total = tone.__created.reduce((sum, c) => sum + c.node.triggerCount, 0);
      expect(total, `${packId} alarm triggers`).toBeGreaterThanOrEqual(4);
    }
  });

  it("switching packs mid-stream never drops notes", async () => {
    await synth.initAudio();
    for (const packId of packs.PACK_IDS) {
      synth.setVoicePack(packId);
      expect(synth.getVoicePack()).toBe(packId);
      synth.playNoteEvent(event("tcp_syn"));
    }
    const total = tone.__created.reduce((sum, c) => sum + c.node.triggerCount, 0);
    expect(total).toBeGreaterThanOrEqual(packs.PACK_IDS.length);
  });

  it("unknown pack ids keep the current pack instead of glitching", async () => {
    await synth.initAudio();
    synth.setVoicePack(packs.PACK_IDS[0]);
    synth.setVoicePack("no-such-pack");
    expect(synth.getVoicePack()).toBe(packs.PACK_IDS[0]);
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
