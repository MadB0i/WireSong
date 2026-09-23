import { useEffect, useState, type ReactElement } from "react";
import { getVoicePack, registerPackDefinition, setVoicePack, type PackName } from "../audio/synth";
import { BUNDLED_PACKS, PACK_IDS, ensurePacksFromNetwork } from "../audio/packs";

interface PackMeta {
  name: PackName;
  label: string;
  tagline: string;
  icon: ReactElement;
}

const WAVES = [0, 1, 2];

const FALLBACK_ICON = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
  >
    <path d="M2 12q3-7 5 0t5 0 5 0 5 0" />
  </svg>
);

const PACK_ICONS: Record<string, ReactElement> = {
  ambient: (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M2 12q3-7 5 0t5 0 5 0 5 0" />
    </svg>
  ),
  chiptune: (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="miter"
    >
      <path d="M2 7h5v10h5V7h5v10h5" />
    </svg>
  ),
  orchestral: (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M9.5 17.5a2 2 0 1 1-1.9-2.4l.9-8.1a1 1 0 0 1 1-.9h.3l8-2a1 1 0 0 1 1.2.8l.4 3.1a1 1 0 0 1-.9 1.2l-8 .6v8.2z" />
    </svg>
  ),
  ensemble: (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4l7 3v12" />
      <path d="M12 7l7-3v13" />
      <path d="M5 19h14" />
    </svg>
  ),
};

// Display metadata comes from the pack.json files (single source of truth);
// only the icons stay in code.
const PACK_META: PackMeta[] = PACK_IDS.map((id) => ({
  name: id,
  label: BUNDLED_PACKS[id].displayName,
  tagline: BUNDLED_PACKS[id].tagline,
  icon: PACK_ICONS[id] ?? FALLBACK_ICON,
}));

interface InstrumentPickerProps {
  onPackChange?: (pack: PackName) => void;
}

export function InstrumentPicker({ onPackChange }: InstrumentPickerProps): ReactElement {
  const [activePack, setActivePack] = useState<PackName>(getVoicePack);

  // Re-fetch the served manifests once: identical content is a no-op (the
  // bundled copy already matches), drift is registered when valid and only
  // ever logged when it cannot be applied. Playback never blocks on this.
  useEffect(() => {
    let cancelled = false;
    void ensurePacksFromNetwork().then(({ loaded, warnings }) => {
      if (cancelled) {
        return;
      }
      for (const def of loaded) {
        try {
          registerPackDefinition(def);
        } catch (err) {
          warnings.push(err instanceof Error ? err.message : String(err));
        }
      }
      for (const warning of warnings) {
        console.warn(`WireSong packs: ${warning}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectPack = (pack: PackName) => {
    setVoicePack(pack);
    setActivePack(pack);
    onPackChange?.(pack);
  };

  return (
    <div
      data-testid="instrument-picker"
      className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-1.5 backdrop-blur-md"
    >
      {PACK_META.map(({ name, label, tagline, icon }) => {
        const isActive = activePack === name;
        return (
          <button
            key={name}
            data-testid={`pack-${name}`}
            onClick={() => selectPack(name)}
            aria-pressed={isActive}
            className={
              isActive
                ? `group flex items-center gap-3 rounded-xl border border-aurora-400/50 bg-gradient-to-r from-aurora-600/25 to-violet-glow/20 px-3 py-2 text-left shadow-lg shadow-aurora-600/20 transition-all duration-200 active:scale-[0.99]`
                : `group flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-left transition-all duration-200 hover:border-white/25 hover:bg-white/5 active:scale-[0.99]`
            }
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                isActive
                  ? "border-aurora-400/50 bg-aurora-500/15 text-aurora-300"
                  : "border-white/10 text-zinc-400 group-hover:text-zinc-200"
              }`}
            >
              {icon}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span
                  className={isActive ? "text-sm font-semibold text-aurora-200" : "text-sm font-medium text-zinc-300 group-hover:text-zinc-100"}
                >
                  {label}
                </span>
                {isActive && (
                  <span className="pack-wave flex h-3 items-end gap-[2px]">
                    {WAVES.map((i) => (
                      <span key={i} className="w-[3px] rounded-full bg-gradient-to-t from-aurora-500 to-cyan-glow" style={{ animationDelay: `${i * 0.18}s` }} />
                    ))}
                  </span>
                )}
              </span>
              <span className="truncate text-xs text-zinc-500">{tagline}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}