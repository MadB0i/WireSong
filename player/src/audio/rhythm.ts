import * as Tone from "tone";
import { getMasterBus } from "./synth";

// Rhythm layer: a step-grid drum pattern from the active pack's `rhythm`
// definition (low/high drum grids). Tempo follows a smoothed packets/sec
// value, clamped to 80-160 BPM and further into the active festival's tempo
// range. Packs without a rhythm grid stay silent; starting/stopping never
// touches the note path, so pack switches can't glitch or drop notes.

export interface RhythmGrid {
  steps: number;
  low: number[];
  high: number[];
}

const DEFAULT_MIN_BPM = 80;
const DEFAULT_MAX_BPM = 160;

let grid: RhythmGrid | null = null;
let tempoMin = DEFAULT_MIN_BPM;
let tempoMax = DEFAULT_MAX_BPM;
let density = 1;
let enabled = true;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let bpm = 120;
let voices: { low: Tone.MembraneSynth; high: Tone.MembraneSynth } | null = null;

export function getRhythmBpm(): number {
  return bpm;
}

export function isRhythmRunning(): boolean {
  return timer !== null;
}

export function isRhythmEnabled(): boolean {
  return enabled;
}

export function setRhythmEnabled(next: boolean): void {
  enabled = next;
  if (!enabled) {
    stopRhythm();
  }
}

export function setRhythmGrid(next: RhythmGrid | null): void {
  grid = next;
  step = 0;
  if (next === null) {
    stopRhythm();
  }
}

export function setRhythmTempoRange(min: number, max: number): void {
  tempoMin = Math.min(min, max);
  tempoMax = Math.max(min, max);
}

export function setRhythmDensity(next: number): void {
  density = Math.min(1, Math.max(0, next));
}

function bpmForPacketsPerSec(pps: number): number {
  const raw = DEFAULT_MIN_BPM + Math.max(0, pps) * 4;
  return Math.min(tempoMax, Math.max(tempoMin, Math.min(DEFAULT_MAX_BPM, raw)));
}

// Feed the smoothed packets/sec value; the tempo glides to match. No-op
// unless the layer is running.
export function updateRhythmTempo(packetsPerSec: number): void {
  if (!isRhythmRunning()) {
    return;
  }
  const next = bpmForPacketsPerSec(packetsPerSec);
  if (next !== bpm) {
    bpm = next;
    restartTimer();
  }
}

function tick(): void {
  if (!grid || !voices) {
    return;
  }
  const index = step % grid.steps;
  step += 1;
  const now = Tone.now();
  if (grid.low[index] === 1 && Math.random() < density) {
    try {
      voices.low.triggerAttackRelease("C2", 0.14, now);
    } catch {
      // A missed drum hit must never break the sequence.
    }
  }
  if (grid.high[index] === 1 && Math.random() < density) {
    try {
      voices.high.triggerAttackRelease("G2", 0.1, now);
    } catch {
      // A missed drum hit must never break the sequence.
    }
  }
}

function restartTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const stepMs = (60 / Math.max(1, bpm) / 4) * 1000;
  timer = setInterval(tick, stepMs);
}

export function startRhythm(): void {
  if (!enabled || !grid || timer !== null) {
    return;
  }
  try {
    const low = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 5,
      envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.06 },
    });
    const high = new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
    });
    low.connect(getMasterBus());
    high.connect(getMasterBus());
    voices = { low, high };
    step = 0;
    restartTimer();
  } catch {
    voices = null;
  }
}

export function stopRhythm(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (voices) {
    const stale = voices;
    voices = null;
    setTimeout(() => {
      for (const voice of [stale.low, stale.high]) {
        try {
          voice.dispose();
        } catch {
          // Already gone.
        }
      }
    }, 300);
  }
}

// Test hook: forget configuration and stop the layer.
export function resetRhythmState(): void {
  stopRhythm();
  grid = null;
  tempoMin = DEFAULT_MIN_BPM;
  tempoMax = DEFAULT_MAX_BPM;
  density = 1;
  enabled = true;
  step = 0;
  bpm = 120;
}
