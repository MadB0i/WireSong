import { useEffect, useRef, type JSX } from "react";
import { isAudioStarted } from "../audio/synth";
import { getSpectrum } from "../audio/analyser";

// Decorative, purely additive layer: seeded static node mesh whose glow is
// driven by the real master-bus FFT (same singleton analyser as
// SpectrumAnalyzer from Step 12 — getSpectrum() reuses it, no second
// analyser instance).

const NODE_COUNT = 42;
const BASE_LINK_ALPHA = 0.055;
const BASE_NODE_ALPHA = 0.2;
const MAX_DPR = 1.5;
const MIN_DB = -60;
const MAX_DB = -8;
const STATIC_REDRAW_MS = 250;
const SEED = 0x5eed13;

interface Node {
  x: number;
  y: number;
  r: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function AmbientBackground(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }

    const rand = mulberry32(SEED);
    const nodes: Node[] = Array.from({ length: NODE_COUNT }, () => ({
      x: rand(),
      y: rand(),
      r: 2 + rand() * 1.2,
    }));

    let width = 0;
    let height = 0;
    let dpr = 1;
    let edges: Array<[number, number]> = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const maxDist = Math.min(width, height) * 0.16;
      edges = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = (nodes[i].x - nodes[j].x) * width;
          const dy = (nodes[i].y - nodes[j].y) * height;
          if (dx * dx + dy * dy < maxDist * maxDist) {
            edges.push([i, j]);
          }
        }
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let rafId = 0;
    let lastStaticDraw = 0;

    const draw = (now: number) => {
      const audioOn = isAudioStarted();
      if (!document.hidden && (audioOn || now - lastStaticDraw > STATIC_REDRAW_MS)) {
        lastStaticDraw = now;
        const spectrum = audioOn ? getSpectrum() : null;
        const boosts = new Float32Array(nodes.length);
        if (spectrum !== null) {
          for (let i = 0; i < nodes.length; i++) {
            boosts[i] = clamp01((spectrum[i % spectrum.length] - MIN_DB) / (MAX_DB - MIN_DB));
          }
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        ctx.lineWidth = 1;
        for (const [i, j] of edges) {
          const linkBoost = (boosts[i] + boosts[j]) / 2;
          const alpha = BASE_LINK_ALPHA + linkBoost * 0.14;
          const hue = 190 + (i * 47 + j * 23) % 95;
          ctx.strokeStyle = `hsla(${hue}, 85%, 70%, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x * width, nodes[i].y * height);
          ctx.lineTo(nodes[j].x * width, nodes[j].y * height);
          ctx.stroke();
        }

        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const boost = boosts[i];
          const cx = node.x * width;
          const cy = node.y * height;
          const alpha = BASE_NODE_ALPHA + boost * 0.55;
          const radius = node.r + boost * 9;
          const hue = 190 + (i * 47) % 95;
          if (boost > 0.04) {
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 3);
            grad.addColorStop(0, `hsla(${hue}, 85%, 78%, ${(alpha * 0.9).toFixed(3)})`);
            grad.addColorStop(0.35, `hsla(${hue}, 80%, 64%, ${(alpha * 0.5).toFixed(3)})`);
            grad.addColorStop(1, "hsla(235, 80%, 60%, 0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, radius * 3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = `hsla(${hue}, 85%, 70%, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="ambient-background"
      className="ambient-bg"
      aria-hidden
    />
  );
}