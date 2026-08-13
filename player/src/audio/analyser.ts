import * as Tone from "tone";
import { getMasterBus } from "./synth";

let analyser: Tone.Analyser | null = null;

export function getAnalyser(): Tone.Analyser {
  if (analyser === null) {
    analyser = new Tone.Analyser("fft", 128);
    getMasterBus().connect(analyser);
  }
  return analyser;
}

export function getSpectrum(): Float32Array {
  return getAnalyser().getValue() as Float32Array;
}