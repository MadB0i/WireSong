import * as Tone from "tone";
import { getMasterBus } from "./synth";

let recorder: Tone.Recorder | null = null;
let recordingStartMs: number | null = null;

export function startRecording(): void {
  if (recorder !== null) {
    return;
  }
  recorder = new Tone.Recorder();
  getMasterBus().connect(recorder);
  void recorder.start();
  recordingStartMs = performance.now();
}

export function isRecording(): boolean {
  return recorder !== null;
}

export function getRecordingElapsedMs(): number {
  if (recordingStartMs === null) {
    return 0;
  }
  return performance.now() - recordingStartMs;
}

export function getRecordingMimeType(): string {
  return recorder?.mimeType ?? "";
}

export async function stopRecording(): Promise<Blob | null> {
  if (recorder === null) {
    return null;
  }
  const active = recorder;
  recorder = null;
  recordingStartMs = null;
  const blob = await active.stop();
  getMasterBus().disconnect(active);
  active.dispose();
  return blob;
}
