import type { NoteEvent } from "../ws";

// Raga engine: classical-scale reinterpretation of the backend's
// scale-degree stream.
//
// The backend emits `degree` (the pentatonic scale index that produced the
// note) alongside `pitch`. This module maps that degree through the selected
// raga with octave wrap. The default raga, Bhupali, is the C-major
// pentatonic itself, so default playback reproduces today's exact pitches.
//
// Content note: ragas here are used strictly as pitch collections
// (folk/classical-scale material). No ritual or devotional context.

export const PENTA_SCALE = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

export const SCALE_LEN = 10;

export interface RagaDef {
  id: string;
  name: string;
  description: string;
  // Semitone offsets from Sa (C), ascending. Length 5-7.
  semitones: number[];
  // Four-note alert phrase in scale degrees (octave wraps allowed), always
  // inside the raga — never raw semitones.
  alertDegrees: [number, number, number, number];
}

export const RAGAS: RagaDef[] = [
  {
    id: "bhupali",
    name: "Bhupali",
    description: "pentatonic default — identical to today's scale",
    semitones: [0, 2, 4, 7, 9],
    alertDegrees: [0, 2, 4, 7],
  },
  {
    id: "yaman",
    name: "Yaman",
    description: "bright evening scale with lifted fourth",
    semitones: [0, 2, 4, 6, 7, 9, 11],
    alertDegrees: [0, 2, 4, 7],
  },
  {
    id: "bhairav",
    name: "Bhairav",
    description: "morning scale with low second",
    semitones: [0, 1, 4, 5, 7, 8, 11],
    alertDegrees: [0, 1, 4, 7],
  },
  {
    id: "malkauns",
    name: "Malkauns",
    description: "deep late-night pentatonic",
    semitones: [0, 3, 5, 7, 10],
    alertDegrees: [0, 2, 4, 7],
  },
  {
    id: "todi",
    name: "Todi",
    description: "tense scale reserved for alerts",
    semitones: [0, 1, 4, 6, 7, 8, 11],
    alertDegrees: [1, 3, 4, 6],
  },
];

export const DEFAULT_RAGA_ID = "bhupali";

export function getRaga(id: string): RagaDef {
  const raga = RAGAS.find((r) => r.id === id);
  if (!raga) {
    throw new Error(`unknown raga "${id}" (known: ${RAGAS.map((r) => r.id).join(", ")})`);
  }
  return raga;
}

// Map a backend scale degree to a MIDI note in the raga, wrapping octaves.
// Bhupali with degrees 0-9 reproduces PENTA_SCALE exactly.
export function ragaDegreeToMidi(raga: RagaDef, degree: number, baseMidi = 60): number {
  const len = raga.semitones.length;
  const wrapped = ((Math.round(degree) % len) + len) % len;
  const octave = Math.floor(Math.round(degree) / len);
  return baseMidi + octave * 12 + raga.semitones[wrapped];
}

// Resolve the playable degree for an event: the backend `degree` when
// present and in range, otherwise derived from `pitch` so legacy fixtures
// (replay-demo.json) and old servers keep sounding correct.
export function degreeForEvent(event: NoteEvent): number {
  if (Number.isInteger(event.degree) && (event.degree as number) >= 0 && (event.degree as number) < SCALE_LEN) {
    return event.degree as number;
  }
  const index = PENTA_SCALE.indexOf(event.pitch);
  if (index >= 0) {
    return index;
  }
  return ((event.pitch - PENTA_SCALE[0]) % SCALE_LEN + SCALE_LEN) % SCALE_LEN;
}

// MIDI notes for the raga's alert phrase (port_scan_alert). Four rising
// notes, always inside the raga.
export function alertMidis(raga: RagaDef, baseMidi = 60): number[] {
  return raga.alertDegrees.map((d) => ragaDegreeToMidi(raga, d, baseMidi));
}

// Raga Clock: automatic raga by local hour of day. Morning airs the
// Bhairav-like scale, midday returns to Bhupali, evening lifts to Yaman,
// late night settles on Malkauns. Off by default.
export function ragaForHour(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 4 && h < 11) {
    return "bhairav";
  }
  if (h >= 11 && h < 16) {
    return "bhupali";
  }
  if (h >= 16 && h < 21) {
    return "yaman";
  }
  return "malkauns";
}

let currentRagaId = DEFAULT_RAGA_ID;
let ragaClockEnabled = false;

function notifyRagaChanged(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("wiresong:raga"));
  }
}

export function onRagaChanged(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }
  window.addEventListener("wiresong:raga", listener);
  return () => window.removeEventListener("wiresong:raga", listener);
}

export function setRaga(id: string): void {
  currentRagaId = getRaga(id).id;
  notifyRagaChanged();
}

export function getRagaId(): string {
  return currentRagaId;
}

export function setRagaClockEnabled(enabled: boolean): void {
  ragaClockEnabled = enabled;
}

export function isRagaClockEnabled(): boolean {
  return ragaClockEnabled;
}

// The raga actually sonified right now: clock override when enabled,
// otherwise the manual selection. Pure in `nowHours` for testability.
export function getActiveRagaId(nowHours = new Date().getHours()): string {
  if (ragaClockEnabled) {
    return ragaForHour(nowHours);
  }
  return currentRagaId;
}

export function getActiveRaga(nowHours = new Date().getHours()): RagaDef {
  return getRaga(getActiveRagaId(nowHours));
}
