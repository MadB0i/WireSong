import * as Tone from "tone";
import type { NoteEvent } from "../ws";

// TODO: this mirrors capture/instruments/ambient.toml's
// [event.*].waveform values by hand. If ambient.toml changes, update
// this table too. A future step could serve this mapping from the
// backend instead of duplicating it.
export const WAVEFORM_BY_EVENT: Record<string, string> = {
  tcp_syn: "pluck",
  tcp_synack: "pluck",
  tcp_rst: "damped",
  dns_query: "bell",
  http_data: "pad",
  udp: "pizzicato",
  icmp: "sine",
  port_scan_alert: "alarm_arpeggio",
};

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

export function playNoteEvent(event: NoteEvent): void {
  if (!audioStarted) {
    console.debug("WireSong audio not started; dropping note", event.event_type);
    return;
  }
  const waveform = WAVEFORM_BY_EVENT[event.event_type] ?? "sine";
  if (waveform === "alarm_arpeggio") {
    playAlarmArpeggio(event);
    return;
  }
  playSingleVoice(event, waveform);
}

function playSingleVoice(event: NoteEvent, waveform: string): void {
  const freq = midiToFrequency(event.pitch);
  const panner = new Tone.Panner(event.pan);
  const volume = new Tone.Volume(velocityToDb(event.velocity));
  panner.connect(volume);
  volume.toDestination();
  activeChains += 1;

  const disposeAfterMs = event.duration_ms + RELEASE_TAIL_MS;
  const chain: Tone.ToneAudioNode[] = [panner, volume];

  switch (waveform) {
    case "pluck": {
      const synth = new Tone.PluckSynth();
      synth.connect(panner);
      synth.triggerAttack(freq);
      chain.push(synth);
      break;
    }
    case "damped": {
      const synth = new Tone.Synth({
        oscillator: { type: "square" },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
      });
      const filter = new Tone.Filter(600, "lowpass");
      synth.connect(filter);
      filter.connect(panner);
      synth.triggerAttack(freq);
      chain.push(synth, filter);
      break;
    }
    case "bell": {
      const synth = new Tone.MetalSynth();
      synth.connect(panner);
      synth.triggerAttack(freq);
      chain.push(synth);
      break;
    }
    case "pad": {
      const synth = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.3, decay: 0.2, sustain: 0.6, release: 0.8 },
      });
      synth.connect(panner);
      synth.triggerAttackRelease(freq, event.duration_ms / 1000);
      chain.push(synth);
      break;
    }
    case "pizzicato": {
      const synth = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
      });
      synth.connect(panner);
      synth.triggerAttack(freq);
      chain.push(synth);
      break;
    }
    default: {
      const synth = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.05, decay: 0.1, sustain: 0.3, release: 0.2 },
      });
      synth.connect(panner);
      synth.triggerAttack(freq);
      chain.push(synth);
    }
  }

  scheduleDispose(disposeAfterMs, chain);
}

function playAlarmArpeggio(event: NoteEvent): void {
  const semitoneOffsets = [0, 3, 6, 7];
  const stepSeconds = Math.max(event.duration_ms / 4, 30) / 1000;

  const synth = new Tone.Synth({ oscillator: { type: "sawtooth" } });
  const panner = new Tone.Panner(event.pan);
  const volume = new Tone.Volume(velocityToDb(event.velocity));
  synth.connect(panner);
  panner.connect(volume);
  volume.toDestination();
  activeChains += 1;

  const start = Tone.now() + 0.01;
  semitoneOffsets.forEach((offset, index) => {
    synth.triggerAttackRelease(
      midiToFrequency(event.pitch + offset),
      stepSeconds,
      start + index * stepSeconds,
    );
  });

  scheduleDispose(Math.max(event.duration_ms, 0) + RELEASE_TAIL_MS, [synth, panner, volume]);
}
