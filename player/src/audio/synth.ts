import * as Tone from "tone";
import type { NoteEvent } from "../ws";

// The ambient pack intentionally mirrors capture/instruments/ambient.toml's
// sonification (this is the only backend config; packs are a frontend
// concept). The chiptune and orchestral packs are distinct timbre tables
// that do NOT need to match ambient.toml, by design.
export type PackName = "ambient" | "chiptune" | "orchestral";

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

let activeChains = 0;

export function getActiveChainCount(): number {
  return activeChains;
}

function disposeChain(nodes: Tone.ToneAudioNode[]): void {
  for (const node of nodes) {
    node.dispose();
  }
  activeChains -= 1;
}

function scheduleDispose(disposeAfterMs: number, nodes: Tone.ToneAudioNode[]): void {
  setTimeout(() => disposeChain(nodes), disposeAfterMs);
}

const ALARM_OFFSETS = [0, 3, 6, 7];

function scheduleAlarmArpeggio(
  synth: Tone.Synth | Tone.FMSynth,
  event: NoteEvent,
  start: number,
): void {
  const stepSeconds = Math.max(event.duration_ms / 4, 30) / 1000;
  ALARM_OFFSETS.forEach((offset, index) => {
    synth.triggerAttackRelease(
      midiToFrequency(event.pitch + offset),
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

function buildPad(freq: number, event: NoteEvent): Tone.Synth {
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

function buildOrchStringsSustain(freq: number, event: NoteEvent): Tone.FMSynth {
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

function buildOrchFlute(freq: number): Tone.Synth {
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

export const PACKS: Record<PackName, Record<string, VoiceSpec>> = {
  ambient: {
    tcp_syn: { build: buildPluck },
    tcp_synack: { build: buildPluck },
    tcp_rst: { build: buildDamped },
    dns_query: { build: buildBell },
    http_data: { build: buildPad },
    udp: { build: buildPizzicato },
    icmp: { build: buildSine },
    port_scan_alert: { build: buildAlarmArpeggio, isAlarmVoice: true },
  },
  chiptune: {
    tcp_syn: { build: buildChipSquare },
    tcp_synack: { build: buildChipPulse },
    tcp_rst: { build: buildChipStab },
    dns_query: { build: buildChipBlip },
    http_data: { build: buildChipHold },
    udp: { build: buildChipTriangle },
    icmp: { build: buildChipTriangle },
    port_scan_alert: { build: buildChipAlarm, isAlarmVoice: true },
  },
  orchestral: {
    tcp_syn: { build: buildOrchStrings },
    tcp_synack: { build: buildOrchStringsBright },
    tcp_rst: { build: buildOrchBrassHit },
    dns_query: { build: buildOrchCelesta },
    http_data: { build: buildOrchStringsSustain },
    udp: { build: buildOrchPizz },
    icmp: { build: buildOrchFlute },
    port_scan_alert: { build: buildOrchBrassStab, isAlarmVoice: true },
  },
};

let currentPack: PackName = "ambient";

export function setVoicePack(pack: PackName): void {
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
  const voice = PACKS[currentPack][event.event_type] ?? PACKS[currentPack].icmp;
  const freq = midiToFrequency(event.pitch);
  const node = voice.build(freq, event);

  const panner = new Tone.Panner(event.pan);
  const volume = new Tone.Volume(velocityToDb(event.velocity));
  node.connect(panner);
  panner.connect(volume);
  volume.toDestination();
  activeChains += 1;

  scheduleDispose(Math.max(event.duration_ms, 0) + RELEASE_TAIL_MS, [node, panner, volume]);
}
