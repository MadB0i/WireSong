import type { PackDefinition, PackFestivalDef } from "./packs";
import { setRaga, getRaga } from "./ragas";
import { setRhythmDensity, setRhythmTempoRange } from "./rhythm";
import { setDroneScale } from "./drone";

// Festival modes: pack-level presets that tune the performance
// (tempo range, rhythmic density, drone weight, default raga).
//
// All data lives in the active pack's own `festivals` calendar — this module
// never names a festival, season, or culture. Packs without a calendar
// simply expose no festival UI. Months with no entry mean "no seasonal
// override" (the pack default keeps playing).

export type { PackFestivalDef as FestivalDef };

export function packFestivals(def: PackDefinition | undefined): PackFestivalDef[] {
  return def?.festivals ?? [];
}

export function festivalById(def: PackDefinition | undefined, id: string): PackFestivalDef | null {
  return packFestivals(def).find((f) => f.id === id) ?? null;
}

// Month as a JS Date month (0 = January). Returns null when the pack's
// calendar has no entry for that month.
export function festivalForMonth(def: PackDefinition | undefined, month: number): PackFestivalDef | null {
  const m = ((Math.floor(month) % 12) + 12) % 12;
  return packFestivals(def).find((f) => f.months.includes(m)) ?? null;
}

let autoSeason = false;
let manualFestivalId: string | null = null;

export function isAutoSeason(): boolean {
  return autoSeason;
}

export function setAutoSeason(enabled: boolean): void {
  autoSeason = enabled;
}

export function getManualFestivalId(): string | null {
  return manualFestivalId;
}

export function setManualFestivalId(id: string | null): void {
  manualFestivalId = id;
}

// The festival in force for a pack right now: seasonal pick when auto is
// on, otherwise the manual selection (possibly null = pack default).
export function getActiveFestival(
  def: PackDefinition | undefined,
  nowMonth = new Date().getMonth(),
): PackFestivalDef | null {
  if (autoSeason) {
    return festivalForMonth(def, nowMonth);
  }
  if (manualFestivalId === null) {
    return null;
  }
  return festivalById(def, manualFestivalId);
}

// Apply a festival's performance preset. Throws a clear error for an
// unknown defaultRaga so pack typos surface immediately.
export function applyFestival(festival: PackFestivalDef): void {
  getRaga(festival.defaultRaga);
  setRaga(festival.defaultRaga);
  setRhythmTempoRange(festival.tempoRange[0], festival.tempoRange[1]);
  setRhythmDensity(festival.density);
  setDroneScale(0.25 + 0.75 * festival.droneLevel);
}

export function clearFestivalPreset(): void {
  setRhythmTempoRange(80, 160);
  setRhythmDensity(1);
  setDroneScale(1);
}
