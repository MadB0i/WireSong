import { useEffect, useState, type ReactElement } from "react";
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
} from "../audio/festivals";
import { getPackDef } from "../audio/packs";
import { isRhythmEnabled, setRhythmEnabled } from "../audio/rhythm";

const BTN =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md transition";

interface FestivalPickerProps {
  packId: string;
}

// Festival modes for the active culture pack. All names, months, and preset
// values come from that pack's own `festivals` calendar; this component
// knows no festival itself. Packs without a calendar render nothing.
export function FestivalPicker({ packId }: FestivalPickerProps): ReactElement | null {
  const def = getPackDef(packId);
  const festivals = packFestivals(def);
  const [manualId, setManualId] = useState<string | null>(getManualFestivalId);
  const [auto, setAuto] = useState(isAutoSeason);
  const [rhythm, setRhythm] = useState(isRhythmEnabled);
  const [activeId, setActiveId] = useState<string | null>(() => getActiveFestival(def)?.id ?? null);

  useEffect(() => {
    setManualId(getManualFestivalId());
    setAuto(isAutoSeason());
    setRhythm(isRhythmEnabled());
    const next = getActiveFestival(getPackDef(packId));
    setActiveId(next?.id ?? null);
    if (next) {
      applyFestival(next);
    } else {
      clearFestivalPreset();
    }
  }, [packId]);

  if (festivals.length === 0) {
    return null;
  }

  const selectFestival = (id: string) => {
    const festival = festivalById(def, id);
    if (!festival) {
      return;
    }
    setAutoSeason(false);
    setAuto(false);
    setManualFestivalId(id);
    setManualId(id);
    applyFestival(festival);
    setActiveId(id);
  };

  const toggleAuto = () => {
    const next = !auto;
    setAutoSeason(next);
    setAuto(next);
    const festival = next ? festivalForMonth(def, new Date().getMonth()) : null;
    if (festival) {
      applyFestival(festival);
      setActiveId(festival.id);
    } else {
      clearFestivalPreset();
      setActiveId(manualId);
    }
  };

  const toggleRhythm = () => {
    const next = !rhythm;
    setRhythmEnabled(next);
    setRhythm(next);
  };

  return (
    <div
      data-testid="festival-picker"
      className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-white/10 bg-black/25 p-1.5 backdrop-blur-md"
    >
      <span className="px-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        Festival
      </span>
      {festivals.map((festival) => {
        const isActive = activeId === festival.id;
        return (
          <button
            key={festival.id}
            data-testid={`festival-${festival.id}`}
            title={`${festival.tempoRange[0]}-${festival.tempoRange[1]} BPM`}
            onClick={() => selectFestival(festival.id)}
            aria-pressed={isActive}
            className={
              isActive
                ? `${BTN} border-aurora-400/50 bg-aurora-500/15 text-aurora-200`
                : `${BTN} border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200`
            }
          >
            {festival.label}
            {festival.labelLocal !== undefined && (
              <span className="font-normal text-zinc-500">{festival.labelLocal}</span>
            )}
          </button>
        );
      })}
      <button
        data-testid="festival-auto-toggle"
        onClick={toggleAuto}
        aria-pressed={auto}
        title="Pick the festival mode from the current month (this pack's calendar)"
        className={
          auto
            ? `${BTN} border-aurora-400/50 bg-aurora-500/15 text-aurora-200`
            : `${BTN} border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200`
        }
      >
        📅 Auto by season
      </button>
      <button
        data-testid="rhythm-toggle"
        onClick={toggleRhythm}
        aria-pressed={rhythm}
        title="Step-grid drum layer from this pack's rhythm pattern"
        className={
          rhythm
            ? `${BTN} border-aurora-400/50 bg-aurora-500/15 text-aurora-200`
            : `${BTN} border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200`
        }
      >
        🥁 Rhythm
      </button>
    </div>
  );
}
