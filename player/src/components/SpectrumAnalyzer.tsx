import { useEffect, useRef, type JSX } from "react";
import { isAudioStarted } from "../audio/synth";
import { getSpectrum } from "../audio/analyser";

const CANVAS_HEIGHT = 72;
const MIN_DB = -100;
const MAX_DB = -10;
const IDLE_BAR_RATIO = 0.18;

export function SpectrumAnalyzer(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container === null || canvas === null) {
      return;
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(CANVAS_HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let rafId = 0;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = canvas.clientWidth;
      const height = CANVAS_HEIGHT;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(129, 140, 248, 0.14)";
      ctx.fillRect(0, height - 1, width, 1);

      if (!isAudioStarted()) {
        ctx.fillStyle = "rgba(129, 140, 248, 0.22)";
        const idleWidth = width / 48;
        for (let i = 0; i < 48; i++) {
          const x = i * (width / 48);
          ctx.fillRect(x, height * (1 - IDLE_BAR_RATIO), idleWidth - 1, height * IDLE_BAR_RATIO);
        }
        rafId = requestAnimationFrame(draw);
        return;
      }

      const spectrum = getSpectrum();
      const bins = spectrum.length;
      if (bins === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }
      const barWidth = width / bins;
      for (let i = 0; i < bins; i++) {
        const db = spectrum[i];
        const normalized = Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
        const barHeight = Math.max(1, normalized * height);
        const alpha = 0.35 + 0.65 * normalized;
        const t = bins <= 1 ? 0 : i / (bins - 1);
        const hue = 235 - t * 45;
        ctx.fillStyle = `hsla(${hue.toFixed(1)}, 80%, ${(66 + t * 4).toFixed(1)}%, ${alpha.toFixed(3)})`;
        ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="spectrum-analyzer"
      className="w-full overflow-hidden"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}