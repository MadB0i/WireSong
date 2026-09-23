import { useEffect, useState, type ReactElement } from "react";
import {
  RAGAS,
  getActiveRagaId,
  getRagaId,
  isRagaClockEnabled,
  onRagaChanged,
  setRaga,
  setRagaClockEnabled,
} from "../audio/ragas";
import {
  MEEND_GLIDE_SECONDS,
  getPortamentoSeconds,
  setPortamentoSeconds,
} from "../audio/synth";

const BTN =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md transition";

export function RagaPicker(): ReactElement {
  const [ragaId, setRagaIdState] = useState(getRagaId);
  const [clock, setClock] = useState(isRagaClockEnabled);
  const [glide, setGlide] = useState(getPortamentoSeconds() > 0);
  const [activeId, setActiveId] = useState(() => getActiveRagaId());

  // Festival presets (and any other external selection) change the raga
  // outside this component; refresh the display when that happens.
  useEffect(() => {
    return onRagaChanged(() => {
      setRagaIdState(getRagaId());
      setActiveId(getActiveRagaId());
    });
  }, []);

  const refreshActive = () => setActiveId(getActiveRagaId());

  const selectRaga = (id: string) => {
    setRaga(id);
    setRagaIdState(id);
    refreshActive();
  };

  const toggleClock = () => {
    const next = !clock;
    setRagaClockEnabled(next);
    setClock(next);
    refreshActive();
  };

  const toggleGlide = () => {
    const next = !glide;
    setPortamentoSeconds(next ? MEEND_GLIDE_SECONDS : 0);
    setGlide(next);
  };

  return (
    <div
      data-testid="raga-picker"
      className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-white/10 bg-black/25 p-1.5 backdrop-blur-md"
    >
      <span className="px-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        Raga
      </span>
      {RAGAS.map((raga) => {
        const isActive = !clock && ragaId === raga.id;
        return (
          <button
            key={raga.id}
            data-testid={`raga-${raga.id}`}
            title={raga.description}
            onClick={() => selectRaga(raga.id)}
            aria-pressed={isActive}
            className={
              isActive
                ? `${BTN} border-aurora-400/50 bg-aurora-500/15 text-aurora-200`
                : `${BTN} border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200`
            }
          >
            {raga.name}
          </button>
        );
      })}
      <button
        data-testid="raga-clock-toggle"
        onClick={toggleClock}
        aria-pressed={clock}
        title="Auto-change raga by time of day (morning Bhairav, midday Bhupali, evening Yaman, late night Malkauns)"
        className={
          clock
            ? `${BTN} border-aurora-400/50 bg-aurora-500/15 text-aurora-200`
            : `${BTN} border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200`
        }
      >
        🕰 Clock
      </button>
      <button
        data-testid="meend-toggle"
        onClick={toggleGlide}
        aria-pressed={glide}
        title="Meend: portamento glide on melodic voices"
        className={
          glide
            ? `${BTN} border-aurora-400/50 bg-aurora-500/15 text-aurora-200`
            : `${BTN} border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200`
        }
      >
        〜 Meend
      </button>
      <span data-testid="raga-active" className="ml-auto px-1.5 font-mono text-[10px] text-zinc-500">
        {clock ? `auto · ${RAGAS.find((r) => r.id === activeId)?.name ?? activeId}` : RAGAS.find((r) => r.id === ragaId)?.name ?? ragaId}
      </span>
    </div>
  );
}
