import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("tone", () => {
  const levels: number[] = [];
  class MockGain {
    gain = {
      value: 0,
      setTargetAtTime: (v: number) => {
        levels.push(v);
      },
    };
    disposed = false;
    constructor(volume = 0) {
      this.gain.value = volume;
    }
    connect() {
      return this;
    }
    toDestination() {
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class MockOsc {
    disposed = false;
    started = false;
    static instances: MockOsc[] = [];
    frequency: number;
    oscType: string;
    constructor(frequency: number, oscType: string) {
      this.frequency = frequency;
      this.oscType = oscType;
      MockOsc.instances.push(this);
    }
    connect() {
      return this;
    }
    start() {
      this.started = true;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class MockFilter {
    disposed = false;
    frequency: number;
    filterType: string;
    constructor(frequency: number, filterType: string) {
      this.frequency = frequency;
      this.filterType = filterType;
    }
    connect() {
      return this;
    }
    dispose() {
      this.disposed = true;
    }
  }
  return {
    Gain: MockGain,
    Oscillator: MockOsc,
    Filter: MockFilter,
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
    MembraneSynth: class {},
    Sampler: class {},
    Panner: class {},
    Volume: class {},
    get __levels() {
      return levels;
    },
    get __oscs() {
      return MockOsc.instances;
    },
    __resetAll: () => {
      levels.length = 0;
      MockOsc.instances.length = 0;
    },
  };
});

const tone = (await import("tone")) as unknown as {
  __levels: number[];
  __oscs: { frequency: number; started: boolean; disposed: boolean }[];
  __resetAll: () => void;
};

const drone = await import("./drone");

describe("Sa-Pa drone", () => {
  afterEach(() => {
    drone.stopDrone();
    tone.__resetAll();
    vi.useRealTimers();
  });

  it("starts silent on root and fifth, and is idempotent", () => {
    drone.startDrone(36, 7);
    expect(drone.isDroneRunning()).toBe(true);
    expect(tone.__oscs).toHaveLength(2);
    expect(tone.__oscs[0].started).toBe(true);
    expect(tone.__oscs[1].started).toBe(true);
    // Fifth is a perfect fifth (7 semitones) above the root.
    const ratio = tone.__oscs[1].frequency / tone.__oscs[0].frequency;
    expect(ratio).toBeCloseTo(2 ** (7 / 12), 4);
    drone.startDrone(36, 7);
    expect(tone.__oscs).toHaveLength(2);
  });

  it("follows packets/sec with a hard cap, and ignores calls when stopped", () => {
    drone.startDrone(36, 7);
    drone.setDroneLevel(0);
    drone.setDroneLevel(20);
    drone.setDroneLevel(10_000);
    expect(tone.__levels).toEqual([0.03, 0.11, 0.12]);
    drone.stopDrone();
    const count = tone.__levels.length;
    drone.setDroneLevel(50);
    expect(tone.__levels).toHaveLength(count);
  });

  it("stopDrone silences then disposes the nodes", () => {
    vi.useFakeTimers();
    drone.startDrone(36, 7);
    drone.stopDrone();
    expect(drone.isDroneRunning()).toBe(false);
    expect(tone.__levels.at(-1)).toBe(0);
    vi.advanceTimersByTime(500);
    expect(tone.__oscs.every((o) => o.disposed)).toBe(true);
  });
});
