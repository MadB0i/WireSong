import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_PACKS, PACK_IDS } from "./packs";
import {
  applyFestival,
  clearFestivalPreset,
  festivalById,
  festivalForMonth,
  getActiveFestival,
  getManualFestivalId,
  isAutoSeason,
  packFestivals,
  setAutoSeason,
  setManualFestivalId,
} from "./festivals";
import { getDroneScale } from "./drone";
import { getRagaId, setRaga } from "./ragas";

function defsWithFestivals() {
  return PACK_IDS.map((id) => BUNDLED_PACKS[id]).filter((d) => packFestivals(d).length > 0);
}

describe("pack festival calendars (data-driven)", () => {
  beforeEach(() => {
    setAutoSeason(false);
    setManualFestivalId(null);
    setRaga("bhupali");
    clearFestivalPreset();
  });

  afterEach(() => {
    setAutoSeason(false);
    setManualFestivalId(null);
    setRaga("bhupali");
    clearFestivalPreset();
  });

  it("packs without a calendar expose no festivals and no seasonal pick", () => {
    for (const id of PACK_IDS) {
      const def = BUNDLED_PACKS[id];
      if (packFestivals(def).length === 0) {
        expect(festivalForMonth(def, 3)).toBeNull();
        expect(getActiveFestival(def, 3)).toBeNull();
      }
    }
    expect(defsWithFestivals().length).toBeGreaterThan(0);
  });

  it("every calendar month resolves back to its own festival; gaps resolve to null", () => {
    for (const def of defsWithFestivals()) {
      const covered = new Set<number>();
      for (const festival of packFestivals(def)) {
        for (const month of festival.months) {
          covered.add(month);
          expect(festivalForMonth(def, month)?.id).toBe(festival.id);
        }
        expect(festival.tempoRange[0]).toBeLessThan(festival.tempoRange[1]);
        expect(festival.density).toBeGreaterThanOrEqual(0);
        expect(festival.density).toBeLessThanOrEqual(1);
        expect(festival.droneLevel).toBeGreaterThanOrEqual(0);
        expect(festival.droneLevel).toBeLessThanOrEqual(1);
      }
      for (let month = 0; month < 12; month++) {
        if (!covered.has(month)) {
          expect(festivalForMonth(def, month)).toBeNull();
        }
      }
    }
  });

  it("festival lookup by id returns null for unknown ids", () => {
    for (const def of defsWithFestivals()) {
      expect(festivalById(def, "no-such-festival")).toBeNull();
      expect(festivalById(def, packFestivals(def)[0].id)?.id).toBe(packFestivals(def)[0].id);
    }
  });

  it("auto season is off by default; manual selection drives the active festival", () => {
    expect(isAutoSeason()).toBe(false);
    const def = defsWithFestivals()[0];
    expect(getActiveFestival(def, def.festivals![0].months[0])).toBeNull();
    setManualFestivalId(def.festivals![0].id);
    expect(getManualFestivalId()).toBe(def.festivals![0].id);
    expect(getActiveFestival(def)?.id).toBe(def.festivals![0].id);
  });

  it("auto season reads the active pack's own calendar", () => {
    const def = defsWithFestivals()[0];
    setAutoSeason(true);
    const month = def.festivals![0].months[0];
    expect(getActiveFestival(def, month)?.id).toBe(def.festivals![0].id);
  });

  it("applying a festival sets its raga and drone weight", () => {
    const def = defsWithFestivals()[0];
    const festival = def.festivals![0];
    applyFestival(festival);
    expect(getRagaId()).toBe(festival.defaultRaga);
    expect(getDroneScale()).toBeCloseTo(0.25 + 0.75 * festival.droneLevel, 6);
    clearFestivalPreset();
    expect(getDroneScale()).toBe(1);
  });

  it("applying a festival with an unknown raga throws clearly", () => {
    const def = defsWithFestivals()[0];
    const broken = { ...def.festivals![0], defaultRaga: "no-such-raga" };
    expect(() => applyFestival(broken)).toThrow('unknown raga "no-such-raga"');
  });
});
