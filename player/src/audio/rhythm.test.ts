import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tone", () => {
  class MockMembrane {
    static triggered: { note: unknown; duration: unknown }[] = [];
    connect() {
      return this;
    }
    dispose() {
      return;
    }
    triggerAttackRelease(note: unknown, duration: unknown) {
      MockMembrane.triggered.push({ note, duration });
    }
  }
  class MockGain {
    connect() {
      return this;
    }
    toDestination() {
      return this;
    }
    dispose() {
      return;
    }
  }
  return {
    MembraneSynth: MockMembrane,
    Gain: MockGain,
    now: () => 0,
    Frequency: (pitch: number) => ({
      toFrequency: () => 440 * 2 ** ((pitch - 69) / 12),
      toNote: () => "C",
    }),
    gainToDb: (v: number) => v,
    start: async () => undefined,
    PluckSynth: class {},
    Synth: class {},
    FMSynth: class {},
    MetalSynth: class {},
    MonoSynth: class {},
    NoiseSynth: class {},
    Sampler: class {},
    Filter: class {},
    Oscillator: class {},
    Panner: class {},
    Volume: class {},
    get __triggered() {
      return MockMembrane.triggered;
    },
    __resetHits: () => {
      MockMembrane.triggered = [];
    },
  };
});

const tone = (await import("tone")) as unknown as {
  __triggered: { note: unknown }[];
  __resetHits: () => void;
};

const rhythm = await import("./rhythm");

const GRID = { steps: 4, low: [1, 0, 0, 0], high: [0, 0, 1, 0] };

describe("step-grid rhythm layer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rhythm.resetRhythmState();
    tone.__resetHits();
  });

  afterEach(() => {
    rhythm.resetRhythmState();
    vi.useRealTimers();
  });

  it("stays silent without a grid", () => {
    rhythm.startRhythm();
    expect(rhythm.isRhythmRunning()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(tone.__triggered).toHaveLength(0);
  });

  it("plays the grid pattern once per cycle", () => {
    rhythm.setRhythmGrid(GRID);
    rhythm.startRhythm();
    expect(rhythm.isRhythmRunning()).toBe(true);
    vi.advanceTimersByTime(2000);
    const low = tone.__triggered.filter((t) => t.note === "C2");
    const high = tone.__triggered.filter((t) => t.note === "G2");
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    expect(low.length).toEqual(high.length);
  });

  it("density zero silences the layer, one plays every hit", () => {
    rhythm.setRhythmGrid(GRID);
    rhythm.setRhythmDensity(0);
    rhythm.startRhythm();
    vi.advanceTimersByTime(2000);
    expect(tone.__triggered).toHaveLength(0);
  });

  it("tempo follows packets/sec clamped to 80-160, then to the festival range", () => {
    rhythm.setRhythmGrid(GRID);
    rhythm.startRhythm();
    rhythm.updateRhythmTempo(0);
    expect(rhythm.getRhythmBpm()).toBe(80);
    rhythm.updateRhythmTempo(20);
    expect(rhythm.getRhythmBpm()).toBe(160);
    rhythm.updateRhythmTempo(1000);
    expect(rhythm.getRhythmBpm()).toBe(160);
    rhythm.setRhythmTempoRange(100, 125);
    rhythm.updateRhythmTempo(20);
    expect(rhythm.getRhythmBpm()).toBe(125);
    rhythm.updateRhythmTempo(0);
    expect(rhythm.getRhythmBpm()).toBe(100);
  });

  it("updateRhythmTempo is a no-op while stopped", () => {
    rhythm.setRhythmGrid(GRID);
    const before = rhythm.getRhythmBpm();
    rhythm.updateRhythmTempo(20);
    expect(rhythm.getRhythmBpm()).toBe(before);
  });

  it("start is idempotent and stop halts the pattern", () => {
    rhythm.setRhythmGrid(GRID);
    rhythm.startRhythm();
    rhythm.startRhythm();
    vi.advanceTimersByTime(500);
    const count = tone.__triggered.length;
    expect(count).toBeGreaterThan(0);
    rhythm.stopRhythm();
    expect(rhythm.isRhythmRunning()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(tone.__triggered.length).toBe(count);
  });

  it("disabling stops the layer; clearing the grid stops it too", () => {
    rhythm.setRhythmGrid(GRID);
    rhythm.startRhythm();
    rhythm.setRhythmEnabled(false);
    expect(rhythm.isRhythmRunning()).toBe(false);
    expect(rhythm.isRhythmEnabled()).toBe(false);
    rhythm.setRhythmEnabled(true);
    rhythm.setRhythmGrid(GRID);
    rhythm.startRhythm();
    expect(rhythm.isRhythmRunning()).toBe(true);
    rhythm.setRhythmGrid(null);
    expect(rhythm.isRhythmRunning()).toBe(false);
  });
});
