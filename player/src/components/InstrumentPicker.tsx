import { useState, type ReactElement } from "react";
import { getVoicePack, setVoicePack, type PackName } from "../audio/synth";

const PACK_OPTIONS: Array<{ name: PackName; label: string }> = [
  { name: "ambient", label: "Ambient" },
  { name: "chiptune", label: "Chiptune" },
  { name: "orchestral", label: "Orchestral" },
];

interface InstrumentPickerProps {
  onPackChange?: (pack: PackName) => void;
}

export function InstrumentPicker({ onPackChange }: InstrumentPickerProps): ReactElement {
  const [activePack, setActivePack] = useState<PackName>(getVoicePack);

  const selectPack = (pack: PackName) => {
    setVoicePack(pack);
    setActivePack(pack);
    onPackChange?.(pack);
  };

  return (
    <div
      data-testid="instrument-picker"
      className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 p-1"
    >
      <span className="px-1 text-xs text-zinc-500">pack:</span>
      {PACK_OPTIONS.map(({ name, label }) => (
        <button
          key={name}
          data-testid={`pack-${name}`}
          onClick={() => selectPack(name)}
          className={
            activePack === name
              ? "rounded bg-sky-700 px-3 py-1 text-sm"
              : "rounded px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
