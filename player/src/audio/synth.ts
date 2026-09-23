import * as Tone from "tone";
import type { NoteEvent } from "../ws";
import {
  BUNDLED_PACKS,
  getPackDef,
  registerPackDef,
  type PackDefinition,
} from "./packs";
import {
  alertMidis,
  degreeForEvent,
  getActiveRaga,
  ragaDegreeToMidi,
} from "./ragas";
import { playSampledNote } from "./samples";

// Instrument packs are data-driven: player/public/packs/<id>/pack.json is
// the source of truth for the event -> voice mapping (plus sample manifest
// and fallback synth per event). This module owns the Tone.js voice builders
// keyed by voice id; the JSON selects which builder plays each event type.
// The ambient pack intentionally mirrors capture/instruments/ambient.toml's
// sonification (this is the only backend config; packs are a frontend
// concept). Packs change timbre only, never the mapping.
export type PackName = string;

export const BUILTIN_PACK_IDS = ["ambient", "chiptune", "orchestral", "ensemble"];

interface VoiceSpec {
  build: (freq: number, event: NoteEvent) => Tone.ToneAudioNode;
  isAlarmVoice?: boolean;
}

const RELEASE_TAIL_MS = 200;

export function midiToFrequency(pitch: number): number {
  return Tone.Frequency(pitch, "midi").toFrequency();
}

export function velocityToDb(velocity: number): number {
  const clamped = Math.min(1.0, Math.max(0.01, velocity));
  return Tone.gainToDb(clamped);
}

let audioStarted = false;

export async function initAudio(): Promise<void> {
  if (audioStarted) {
    return;
  }
  await Tone.start();
  audioStarted = true;
}

export function isAudioStarted(): boolean {
  return audioStarted;
}

export function setAudioMuted(next: boolean): void {
  const bus = getMasterBus();
  const now = Tone.now();
  bus.gain.cancelScheduledValues(now);
  bus.gain.setTargetAtTime(next ? 0 : 1, now, 0.05);
}

function disposeChain(nodes: Tone.ToneAudioNode[]): void {
  for (const node of nodes) {
    node.dispose();
  }
}

function scheduleDispose(disposeAfterMs: number, nodes: Tone.ToneAudioNode[]): void {
  setTimeout(() => disposeChain(nodes), disposeAfterMs);
}

// Port-scan alarm: the selected raga's four-note alert phrase (scale
// degrees, so it always stays inside the raga). Default (Bhupali) keeps the
// established character: four rising notes, loudest in the mix, inbound.
function scheduleAlarmArpeggio(
  synth: Tone.Synth | Tone.FMSynth | Tone.MonoSynth | Tone.PluckSynth,
  event: NoteEvent,
  start: number,
  freqScale = 1,
): void {
  const stepSeconds = Math.max(event.duration_ms / 4, 30) / 1000;
  alertMidis(getActiveRaga()).forEach((midi, index) => {
    synth.triggerAttackRelease(
      midiToFrequency(midi) * freqScale,
      stepSeconds,
      start + index * stepSeconds,
    );
  });
}

function buildPluck(freq: number): Tone.PluckSynth {
  const synth = new Tone.PluckSynth();
  synth.triggerAttack(freq);
  return synth;
}

function buildDamped(freq: number): Tone.Filter {
  const synth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
  });
  const filter = new Tone.Filter(600, "lowpass");
  synth.connect(filter);
  synth.triggerAttack(freq);
  return filter;
}

function buildBell(freq: number): Tone.MetalSynth {
  const synth = new Tone.MetalSynth();
  synth.triggerAttack(freq);
  return synth;
}

function buildPad(freq: number, event: NoteEvent): Tone.Synth | Tone.MonoSynth {
  if (getPortamentoSeconds() > 0) {
    const glide = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.3, decay: 0.2, sustain: 0.6, release: 0.8 },
      portamento: getPortamentoSeconds(),
    });
    glide.triggerAttackRelease(freq, event.duration_ms / 1000);
    return glide;
  }
  const synth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.3, decay: 0.2, sustain: 0.6, release: 0.8 },
  });
  synth.triggerAttackRelease(freq, event.duration_ms / 1000);
  return synth;
}

function buildPizzicato(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildSine(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.05, decay: 0.1, sustain: 0.3, release: 0.2 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildAlarmArpeggio(_freq: number, event: NoteEvent): Tone.Synth {
  const synth = new Tone.Synth({ oscillator: { type: "sawtooth" } });
  scheduleAlarmArpeggio(synth, event, Tone.now() + 0.01);
  return synth;
}

function buildChipSquare(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildChipPulse(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "pulse", width: 0.4 },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.04 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildChipStab(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildChipBlip(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.03 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildChipHold(freq: number, event: NoteEvent): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.08 },
  });
  synth.triggerAttackRelease(freq, event.duration_ms / 1000);
  return synth;
}

function buildChipTriangle(freq: number): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.06 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildChipAlarm(_freq: number, event: NoteEvent): Tone.Synth {
  const synth = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05 },
  });
  scheduleAlarmArpeggio(synth, event, Tone.now() + 0.01);
  return synth;
}

function buildOrchStrings(freq: number): Tone.FMSynth {
  const synth = new Tone.FMSynth({
    harmonicity: 1.2,
    modulationIndex: 2,
    oscillator: { type: "sine" },
    modulation: { type: "sine" },
    envelope: { attack: 0.4, decay: 0.2, sustain: 0.6, release: 0.6 },
    modulationEnvelope: { attack: 0.4, decay: 0.2, sustain: 0.6, release: 0.6 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildOrchStringsBright(freq: number): Tone.FMSynth {
  const synth = new Tone.FMSynth({
    harmonicity: 1.5,
    modulationIndex: 4,
    oscillator: { type: "sine" },
    modulation: { type: "sine" },
    envelope: { attack: 0.2, decay: 0.15, sustain: 0.5, release: 0.4 },
    modulationEnvelope: { attack: 0.2, decay: 0.15, sustain: 0.5, release: 0.4 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildOrchBrassHit(freq: number): Tone.FMSynth {
  const synth = new Tone.FMSynth({
    harmonicity: 0.9,
    modulationIndex: 8,
    oscillator: { type: "triangle" },
    modulation: { type: "square" },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.2 },
    modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.2 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildOrchCelesta(freq: number): Tone.MetalSynth {
  const synth = new Tone.MetalSynth({
    harmonicity: 9.0,
    modulationIndex: 20,
    resonance: 7000,
    octaves: 1.5,
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildOrchStringsSustain(freq: number, event: NoteEvent): Tone.FMSynth | Tone.MonoSynth {
  if (getPortamentoSeconds() > 0) {
    const glide = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.6, decay: 0.2, sustain: 0.8, release: 1.0 },
      portamento: getPortamentoSeconds(),
    });
    glide.triggerAttackRelease(freq, event.duration_ms / 1000);
    return glide;
  }
  const synth = new Tone.FMSynth({
    harmonicity: 1.1,
    modulationIndex: 1.5,
    oscillator: { type: "sine" },
    modulation: { type: "sine" },
    envelope: { attack: 0.6, decay: 0.2, sustain: 0.8, release: 1.0 },
    modulationEnvelope: { attack: 0.6, decay: 0.2, sustain: 0.8, release: 1.0 },
  });
  synth.triggerAttackRelease(freq, event.duration_ms / 1000);
  return synth;
}

function buildOrchPizz(freq: number): Tone.Filter {
  const synth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
  });
  const filter = new Tone.Filter(1200, "lowpass");
  synth.connect(filter);
  synth.triggerAttack(freq);
  return filter;
}

function buildOrchFlute(freq: number): Tone.Synth | Tone.MonoSynth {
  if (getPortamentoSeconds() > 0) {
    const glide = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.15, decay: 0.1, sustain: 0.7, release: 0.3 },
      portamento: getPortamentoSeconds(),
    });
    glide.triggerAttack(freq);
    return glide;
  }
  const synth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.15, decay: 0.1, sustain: 0.7, release: 0.3 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildOrchBrassStab(_freq: number, event: NoteEvent): Tone.FMSynth {
  const synth = new Tone.FMSynth({
    harmonicity: 1.0,
    modulationIndex: 6,
    oscillator: { type: "sawtooth" },
    modulation: { type: "square" },
    envelope: { attack: 0.005, decay: 0.25, sustain: 0.05, release: 0.15 },
    modulationEnvelope: { attack: 0.005, decay: 0.25, sustain: 0.05, release: 0.15 },
  });
  scheduleAlarmArpeggio(synth, event, Tone.now() + 0.01);
  return synth;
}

function buildGuitar(freq: number): Tone.PluckSynth {
  const synth = new Tone.PluckSynth({ resonance: 0.9, dampening: 3000 });
  synth.triggerAttack(freq);
  return synth;
}

function buildGuitarMuted(freq: number): Tone.Gain {
  const synth = new Tone.PluckSynth({ resonance: 0.9, dampening: 3000 });
  synth.triggerAttack(freq);
  const filter = new Tone.Filter(800, "lowpass");
  const gate = new Tone.Gain(1);
  const now = Tone.now();
  gate.gain.setValueAtTime(1, now);
  gate.gain.setTargetAtTime(0.0001, now, 0.012);
  synth.connect(filter);
  filter.connect(gate);
  return gate;
}

function buildGuitarStaccato(freq: number): Tone.Gain {
  const synth = new Tone.PluckSynth({ resonance: 0.9, dampening: 2600 });
  synth.triggerAttack(freq);
  const gate = new Tone.Gain(1);
  const now = Tone.now();
  gate.gain.setValueAtTime(1, now);
  gate.gain.setTargetAtTime(0.0001, now, 0.02);
  synth.connect(gate);
  return gate;
}

function buildBass(freq: number): Tone.MonoSynth {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.4 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildBassOctave(freq: number, _event: NoteEvent): Tone.MonoSynth {
  return buildBass(freq / 2);
}

function buildEnsembleAlarm(_freq: number, event: NoteEvent): Tone.Gain {
  const out = new Tone.Gain(1);
  const guitar = new Tone.PluckSynth({ resonance: 0.9, dampening: 3000 });
  const bass = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.3 },
  });
  guitar.connect(out);
  bass.connect(out);
  const start = Tone.now() + 0.01;
  scheduleAlarmArpeggio(guitar, event, start);
  scheduleAlarmArpeggio(bass, event, start, 0.5);
  return out;
}

// ---- Folk voices for culture packs --------------------------------------
// Timbre recipes referenced by culture-pack manifests (voice ids in each
// pack's `events`). Every voice first tries its recorded sample (when one
// has been added to the pack's samples/ dir) and otherwise plays the
// synthesized approximation below, so culture packs work with zero
// recordings. Folk, festival and secular material only.

function tryPackSample(freq: number, event: NoteEvent): Tone.Gain | null {
  const def = getPackDef(getVoicePack());
  const file = def?.events[event.event_type]?.sample;
  if (!def || !file) {
    return null;
  }
  const sampleMidi = def.samples.find((s) => s.file === file)?.note ?? 72;
  return playSampledNote({
    packId: def.id,
    file,
    sampleMidi,
    freqHz: freq,
    durationSec: Math.max(event.duration_ms, 30) / 1000,
  });
}

function buildDotora(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  return (
    tryPackSample(freq, event) ??
    (() => {
      const synth = new Tone.PluckSynth({ resonance: 0.85, dampening: 3200 });
      synth.triggerAttack(freq);
      return synth;
    })()
  );
}

function buildDotoraHigh(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  return (
    tryPackSample(freq, event) ??
    (() => {
      const synth = new Tone.PluckSynth({ resonance: 0.85, dampening: 3800 });
      synth.triggerAttack(freq * 2);
      return synth;
    })()
  );
}

function buildToka(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  return (
    tryPackSample(freq, event) ??
    (() => {
      const noise = new Tone.NoiseSynth({
        noise: { type: "pink" },
        envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.02 },
      });
      noise.triggerAttackRelease(0.05);
      return noise;
    })()
  );
}

function buildTaal(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  return (
    tryPackSample(freq, event) ??
    (() => {
      const synth = new Tone.MetalSynth({
        harmonicity: 12,
        modulationIndex: 24,
        resonance: 5000,
        octaves: 1.2,
        envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
      });
      synth.triggerAttack(freq);
      return synth;
    })()
  );
}

function buildBaanhi(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  if (getPortamentoSeconds() > 0) {
    const glide = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.25, decay: 0.15, sustain: 0.7, release: 0.4 },
      portamento: getPortamentoSeconds(),
    });
    glide.triggerAttackRelease(freq, event.duration_ms / 1000);
    return glide;
  }
  const synth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.25, decay: 0.15, sustain: 0.7, release: 0.4 },
  });
  synth.triggerAttackRelease(freq, event.duration_ms / 1000);
  return synth;
}

function buildGogona(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  return (
    tryPackSample(freq, event) ??
    (() => {
      const synth = new Tone.FMSynth({
        harmonicity: 2.5,
        modulationIndex: 12,
        oscillator: { type: "square" },
        modulation: { type: "sine" },
        envelope: { attack: 0.002, decay: 0.15, sustain: 0, release: 0.08 },
        modulationEnvelope: { attack: 0.002, decay: 0.15, sustain: 0, release: 0.08 },
      });
      synth.triggerAttack(freq);
      return synth;
    })()
  );
}

function buildXutuli(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  return (
    tryPackSample(freq, event) ??
    (() => {
      const synth = new Tone.FMSynth({
        harmonicity: 3,
        modulationIndex: 3,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.08, decay: 0.1, sustain: 0.5, release: 0.25 },
        modulationEnvelope: { attack: 0.08, decay: 0.1, sustain: 0.5, release: 0.25 },
      });
      synth.triggerAttack(freq);
      return synth;
    })()
  );
}

function buildPepaAlarm(_freq: number, event: NoteEvent): Tone.Gain {
  // Always synthesized: the phrase must track the selected raga, which a
  // single held pepa recording cannot do. Reedy pipe states the alert
  // phrase while the dhol answers with a roll — loudest voice in the mix.
  const out = new Tone.Gain(1.2);
  const pepa = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 },
  });
  const dhol = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 },
  });
  pepa.connect(out);
  dhol.connect(out);
  const start = Tone.now() + 0.01;
  scheduleAlarmArpeggio(pepa, event, start);
  const hits = 8;
  const step = event.duration_ms / 1000 / hits;
  for (let i = 0; i < hits; i++) {
    dhol.triggerAttackRelease(i % 2 === 0 ? "C2" : "G2", 0.12, start + i * step);
  }
  return out;
}

function buildTumbi(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  const synth = new Tone.PluckSynth({ resonance: 0.95, dampening: 5200 });
  synth.triggerAttack(freq);
  return synth;
}

function buildTumbiHigh(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  const synth = new Tone.PluckSynth({ resonance: 0.95, dampening: 6000 });
  synth.triggerAttack(freq * 2);
  return synth;
}

function buildChimta(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  const synth = new Tone.MetalSynth({
    harmonicity: 14,
    modulationIndex: 20,
    resonance: 6500,
    octaves: 1.0,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.06 },
  });
  synth.triggerAttack(freq);
  return synth;
}

function buildAlgoza(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  if (getPortamentoSeconds() > 0) {
    const glide = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.1, decay: 0.1, sustain: 0.7, release: 0.25 },
      portamento: getPortamentoSeconds(),
    });
    glide.triggerAttackRelease(freq, event.duration_ms / 1000);
    return glide;
  }
  const synth = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.1, decay: 0.1, sustain: 0.7, release: 0.25 },
  });
  synth.triggerAttackRelease(freq, event.duration_ms / 1000);
  return synth;
}

function buildHarmonium(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  if (getPortamentoSeconds() > 0) {
    const glide = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.25, decay: 0.15, sustain: 0.7, release: 0.4 },
      portamento: getPortamentoSeconds(),
    });
    glide.triggerAttackRelease(freq, event.duration_ms / 1000);
    return glide;
  }
  const synth = new Tone.FMSynth({
    harmonicity: 1.0,
    modulationIndex: 4,
    oscillator: { type: "sawtooth" },
    modulation: { type: "sine" },
    envelope: { attack: 0.25, decay: 0.15, sustain: 0.7, release: 0.4 },
    modulationEnvelope: { attack: 0.25, decay: 0.15, sustain: 0.7, release: 0.4 },
  });
  synth.triggerAttackRelease(freq, event.duration_ms / 1000);
  return synth;
}

function buildDhol(freq: number, event: NoteEvent): Tone.ToneAudioNode {
  const sampled = tryPackSample(freq, event);
  if (sampled) {
    return sampled;
  }
  const drum = new Tone.MembraneSynth({
    pitchDecay: 0.06,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.08 },
  });
  drum.triggerAttackRelease("C2", 0.22);
  return drum;
}

function buildDholAlarm(_freq: number, event: NoteEvent): Tone.Gain {
  // Always synthesized so the phrase tracks the selected raga: tumbi twang
  // states the alert phrase while the dhol answers with a roll.
  const out = new Tone.Gain(1.2);
  const tumbi = new Tone.PluckSynth({ resonance: 0.95, dampening: 5200 });
  const dhol = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.06 },
  });
  tumbi.connect(out);
  dhol.connect(out);
  const start = Tone.now() + 0.01;
  scheduleAlarmArpeggio(tumbi, event, start);
  const hits = 8;
  const step = event.duration_ms / 1000 / hits;
  for (let i = 0; i < hits; i++) {
    dhol.triggerAttackRelease(i % 2 === 0 ? "C2" : "G2", 0.14, start + i * step);
  }
  return out;
}

export const VOICE_BUILDERS: Record<string, VoiceSpec> = {
  pluck: { build: buildPluck },
  damped: { build: buildDamped },
  bell: { build: buildBell },
  pad: { build: buildPad },
  pizzicato: { build: buildPizzicato },
  sine: { build: buildSine },
  alarm_arpeggio: { build: buildAlarmArpeggio, isAlarmVoice: true },
  chip_square: { build: buildChipSquare },
  chip_pulse: { build: buildChipPulse },
  chip_stab: { build: buildChipStab },
  chip_blip: { build: buildChipBlip },
  chip_hold: { build: buildChipHold },
  chip_triangle: { build: buildChipTriangle },
  chip_alarm: { build: buildChipAlarm, isAlarmVoice: true },
  orch_strings: { build: buildOrchStrings },
  orch_strings_bright: { build: buildOrchStringsBright },
  orch_brass_hit: { build: buildOrchBrassHit },
  orch_celesta: { build: buildOrchCelesta },
  orch_strings_sustain: { build: buildOrchStringsSustain },
  orch_pizz: { build: buildOrchPizz },
  orch_flute: { build: buildOrchFlute },
  orch_brass_stab: { build: buildOrchBrassStab, isAlarmVoice: true },
  guitar: { build: buildGuitar },
  guitar_muted: { build: buildGuitarMuted },
  guitar_staccato: { build: buildGuitarStaccato },
  bass_octave: { build: buildBassOctave },
  ensemble_alarm: { build: buildEnsembleAlarm, isAlarmVoice: true },
  dotora: { build: buildDotora },
  dotora_high: { build: buildDotoraHigh },
  toka: { build: buildToka },
  taal: { build: buildTaal },
  baanhi: { build: buildBaanhi },
  gogona: { build: buildGogona },
  xutuli: { build: buildXutuli },
  pepa_alarm: { build: buildPepaAlarm, isAlarmVoice: true },
  tumbi: { build: buildTumbi },
  tumbi_high: { build: buildTumbiHigh },
  chimta: { build: buildChimta },
  algoza: { build: buildAlgoza },
  harmonium: { build: buildHarmonium },
  dhol: { build: buildDhol },
  dhol_alarm: { build: buildDholAlarm, isAlarmVoice: true },
};
export const KNOWN_VOICE_IDS: string[] = Object.keys(VOICE_BUILDERS);

function voicesForPack(def: PackDefinition): Record<string, VoiceSpec> {
  const table: Record<string, VoiceSpec> = {};
  for (const [eventType, eventDef] of Object.entries(def.events)) {
    const voice = VOICE_BUILDERS[eventDef.voice];
    if (!voice) {
      throw new Error(
        `pack "${def.id}" maps "${eventType}" to unknown voice "${eventDef.voice}" ` +
          `(known voices: ${KNOWN_VOICE_IDS.join(", ")})`,
      );
    }
    table[eventType] = { ...voice, isAlarmVoice: eventDef.role === "alarm" };
  }
  return table;
}

const packTables: Record<string, Record<string, VoiceSpec>> = {};
for (const def of Object.values(BUNDLED_PACKS)) {
  packTables[def.id] = voicesForPack(def);
}

export const PACKS: Record<string, Record<string, VoiceSpec>> = packTables;

// Register a validated pack definition at runtime (e.g. re-fetched from the
// network, or a user-added pack). Throws with a clear message when the
// definition references an unknown voice id; the previous table is kept.
export function registerPackDefinition(def: PackDefinition): void {
  packTables[def.id] = voicesForPack(def);
  registerPackDef(def);
}

let currentPack: PackName = "ambient";

// Meend (glide) for melodic voices: seconds of portamento applied by the
// sustained builders (pad, orchestral sustain/flute). Zero (default) keeps
// the exact original code path, so default sound is unchanged.
let glideSeconds = 0;

export const MEEND_GLIDE_SECONDS = 0.12;

export function setPortamentoSeconds(seconds: number): void {
  glideSeconds = Math.max(0, seconds);
}

export function getPortamentoSeconds(): number {
  return glideSeconds;
}

let masterBus: Tone.Gain | null = null;

export function getMasterBus(): Tone.Gain {
  if (!masterBus) {
    masterBus = new Tone.Gain(1).toDestination();
  }
  return masterBus;
}

export function setVoicePack(pack: PackName): void {
  if (!packTables[pack]) {
    console.warn(`WireSong: unknown pack "${pack}", keeping "${currentPack}"`);
    return;
  }
  currentPack = pack;
}

export function getVoicePack(): PackName {
  return currentPack;
}

export function playNoteEvent(event: NoteEvent): void {
  if (!audioStarted) {
    console.debug("WireSong audio not started; dropping note", event.event_type);
    return;
  }
  const table = PACKS[currentPack] ?? PACKS.ambient;
  const voice = table[event.event_type] ?? table.icmp;
  // Melodic notes go through the active raga (degree -> raga note). With the
  // default Bhupali raga this reproduces event.pitch exactly. Alerts carry
  // their phrase in the alarm builders; the pitch here is unused by them.
  const freq =
    event.event_type === "port_scan_alert"
      ? midiToFrequency(event.pitch)
      : midiToFrequency(ragaDegreeToMidi(getActiveRaga(), degreeForEvent(event)));
  const node = voice.build(freq, event);

  const panner = new Tone.Panner(event.pan);
  const volume = new Tone.Volume(velocityToDb(event.velocity));
  node.connect(panner);
  panner.connect(volume);
  volume.connect(getMasterBus());

  scheduleDispose(Math.max(event.duration_ms, 0) + RELEASE_TAIL_MS, [node, panner, volume]);
}
