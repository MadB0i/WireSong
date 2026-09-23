import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("tone", () => {
  class MockSampler {
    static instances: MockSampler[] = [];
    static added: { note: string; url: string }[] = [];
    triggered: { freq: unknown; duration: unknown }[] = [];
    buffers = {
      has: (note: string) => MockSampler.added.some((a) => a.note === note),
    };
    constructor() {
      MockSampler.instances.push(this);
    }
    connect() {
      return this;
    }
    disconnect() {
      return;
    }
    triggerAttackRelease(freq: unknown, duration: unknown) {
      this.triggered.push({ freq, duration });
    }
    add(note: string, url: string) {
      MockSampler.added.push({ note, url });
    }
    dispose() {
      return;
    }
  }
  class MockGain {
    connect() {
      return this;
    }
    dispose() {
      return;
    }
  }
  return {
    Sampler: MockSampler,
    Gain: MockGain,
    Frequency: (midi: number) => ({ toNote: () => `N${midi}` }),
    __sampler: MockSampler,
  };
});

const tone = (await import("tone")) as unknown as {
  __sampler: {
    instances: { triggered: { freq: unknown; duration: unknown }[] }[];
    added: { note: string; url: string }[];
  };
};

const samples = await import("./samples");

function note(fetchFn: (url: string) => Promise<{ ok: boolean }>) {
  return {
    packId: "demo",
    file: "samples/demo-C5.mp3",
    sampleMidi: 72,
    freqHz: 440,
    durationSec: 0.2,
    fetchFn: fetchFn as unknown as typeof fetch,
  };
}

const missing = async () => ({ ok: false });
const present = async () => ({ ok: true });
const failing = async () => {
  throw new Error("network down");
};

async function flushProbes(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("sampleUrl", () => {
  it("points at the pack's served samples directory", () => {
    expect(samples.sampleUrl("demo", "samples/demo-C5.mp3")).toContain(
      "packs/demo/samples/demo-C5.mp3",
    );
  });
});

describe("playSampledNote", () => {
  afterEach(() => {
    samples.resetSampleState();
    tone.__sampler.instances.length = 0;
    tone.__sampler.added.length = 0;
  });

  it("returns null for missing files and probes each file only once", async () => {
    const fetchFn = vi.fn(missing);
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    await flushProbes();
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns null (never throws) when the network fails", async () => {
    const fetchFn = vi.fn(failing);
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    await flushProbes();
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back while probing, then plays the sample once decoded", async () => {
    const fetchFn = vi.fn(present);
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    await flushProbes();
    expect(tone.__sampler.added).toEqual([
      { note: "N72", url: expect.stringContaining("samples/demo-C5.mp3") },
    ]);
    const tap = samples.playSampledNote(note(fetchFn));
    expect(tap).not.toBeNull();
    expect(tone.__sampler.instances).toHaveLength(1);
    expect(tone.__sampler.instances[0].triggered).toEqual([{ freq: 440, duration: 0.2 }]);
  });

  it("resetSampleState forgets probes so the next attempt re-fetches", async () => {
    const fetchFn = vi.fn(missing);
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    await flushProbes();
    samples.resetSampleState();
    expect(samples.playSampledNote(note(fetchFn))).toBeNull();
    await flushProbes();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
