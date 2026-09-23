import * as Tone from "tone";

// Manifest-based sample playback with synthesized fallback.
//
// Each pack manifest may reference recordings (per-event `sample` plus the
// top-level `samples` list). Those files do not have to exist: every file is
// probed at most once per session, and any missing/undecodable recording
// silently resolves to null so the caller plays its fallback synth instead.
// Culture packs therefore work with zero recordings and pick recordings up
// automatically once they are added to their samples/ dir.

const probeCache = new Map<string, boolean>();
const samplers = new Map<string, Tone.Sampler>();

export function sampleUrl(packId: string, file: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}packs/${packId}/${file}`;
}

export function noteNameFor(midi: number) {
  return Tone.Frequency(midi, "midi").toNote();
}

function samplerHasNote(sampler: Tone.Sampler, name: string): boolean {
  try {
    const buffers = (sampler as unknown as { buffers?: { has?: (note: string) => boolean } }).buffers;
    return buffers?.has?.(name) ?? false;
  } catch {
    return false;
  }
}

export interface SampledNote {
  packId: string;
  file: string;
  // Recorded pitch of the file (from the manifest); the sampler
  // pitch-shifts it to the played frequency.
  sampleMidi: number;
  freqHz: number;
  durationSec: number;
  fetchFn?: typeof fetch;
}

// Try to play a recorded sample. Returns a tap node the caller wires into
// its per-note pan/volume chain, or null when no recording is usable (not
// yet recorded, still decoding, or any error) — the caller then plays its
// fallback synth. Never throws.
export function playSampledNote(note: SampledNote): Tone.Gain | null {
  try {
    const url = sampleUrl(note.packId, note.file);
    const known = probeCache.get(url);
    if (known === false) {
      return null;
    }
    let sampler = samplers.get(note.packId);
    if (!sampler) {
      sampler = new Tone.Sampler();
      samplers.set(note.packId, sampler);
    }
    const name = noteNameFor(note.sampleMidi);
    if (known === undefined) {
      probeCache.set(url, false);
      const fetchFn = note.fetchFn ?? fetch;
      void Promise.resolve()
        .then(() => fetchFn(url))
        .then((response) => {
          if (response.ok) {
            probeCache.set(url, true);
            try {
              sampler!.add(name, url);
            } catch {
              probeCache.set(url, false);
            }
          }
        })
        .catch(() => undefined);
      return null;
    }
    if (!samplerHasNote(sampler, name)) {
      return null;
    }
    const tap = new Tone.Gain(1);
    sampler.connect(tap);
    sampler.triggerAttackRelease(note.freqHz, note.durationSec);
    const cleanupMs = Math.max(0, note.durationSec * 1000) + 300;
    setTimeout(() => {
      try {
        sampler!.disconnect(tap);
      } catch {
        // Already torn down; nothing to do.
      }
    }, cleanupMs);
    return tap;
  } catch {
    return null;
  }
}

// Test hook: forget probes and dispose cached samplers.
export function resetSampleState(): void {
  for (const sampler of samplers.values()) {
    try {
      sampler.dispose();
    } catch {
      // Ignore teardown errors in tests.
    }
  }
  samplers.clear();
  probeCache.clear();
}
