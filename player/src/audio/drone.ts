import * as Tone from "tone";
import { getMasterBus, midiToFrequency } from "./synth";

// Sustained Sa-Pa drone bed for the Axom (Bihu) pack: root and fifth
// through a lowpass, with level following baseline traffic (packets/sec).
// Folk-festival use only: a neutral harmonic bed under the melodic voices.
// Silent unless explicitly started; stopping always tears the nodes down.

interface DroneNodes {
  oscA: Tone.Oscillator;
  oscB: Tone.Oscillator;
  filter: Tone.Filter;
  gain: Tone.Gain;
}

let nodes: DroneNodes | null = null;

export function isDroneRunning(): boolean {
  return nodes !== null;
}

// Idempotent: calling twice keeps the existing drone (no stacking, no pop).
export function startDrone(rootMidi = 36, fifthSemitones = 7): void {
  if (nodes) {
    return;
  }
  try {
    const oscA = new Tone.Oscillator(midiToFrequency(rootMidi), "triangle");
    const oscB = new Tone.Oscillator(midiToFrequency(rootMidi + fifthSemitones), "sine");
    const filter = new Tone.Filter(900, "lowpass");
    const gain = new Tone.Gain(0);
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(getMasterBus());
    oscA.start();
    oscB.start();
    nodes = { oscA, oscB, filter, gain };
  } catch {
    nodes = null;
  }
}

export function stopDrone(): void {
  if (!nodes) {
    return;
  }
  const stale = nodes;
  nodes = null;
  try {
    stale.gain.gain.setTargetAtTime(0, Tone.now(), 0.1);
  } catch {
    // Tear down silently.
  }
  setTimeout(() => {
    for (const node of [stale.oscA, stale.oscB, stale.filter, stale.gain] as const) {
      try {
        node.dispose();
      } catch {
        // Already gone.
      }
    }
  }, 400);
}

// Level follows smoothed packets/sec: a quiet bed at idle (~0.03), rising
// gently with traffic, hard-capped so it never covers the melody. No-op
// unless the drone is running, so stray calls can never start sound.
export function setDroneLevel(packetsPerSec: number): void {
  if (!nodes) {
    return;
  }
  const level = Math.min(0.12, Math.max(0, 0.03 + packetsPerSec * 0.004));
  try {
    nodes.gain.gain.setTargetAtTime(level, Tone.now(), 0.5);
  } catch {
    // Ignore automation errors; the bed simply holds its level.
  }
}
