import { useEffect, useRef, type JSX, type RefObject } from "react";
import type { TimestampedNoteEvent } from "./PianoRoll";
import { colorForEventType } from "./PianoRoll";
import { redactIp } from "./packetFeedFormat";

// Force-directed live graph of src_ip -> dst_ip connections.
// Pure geometry (physics, pruning, keys) is exported and unit-tested;
// the component only reads the shared eventBufferRef (same stream as
// PianoRoll/PacketFeed — no second subscription) and draws on the
// same rAF + canvas pattern as the other visualizers. No React state
// per frame.

export const NODE_STALE_MS = 15000;
export const EDGE_FADE_MS = 15000;
export const LOCAL_RADIUS = 7;
export const REMOTE_RADIUS_MIN = 3;
export const CARTOON_CANVAS_HEIGHT = 260;
const TRAVEL_MIN_MS = 400;
const TRAVEL_MAX_MS = 600;
const SPACER = ">";

export interface GraphNode {
  ip: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastSeenMs: number;
  isLocal: boolean;
}

export interface GraphContainer {
  clientWidth: number;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function spawnNode(
  ip: string,
  nowMs: number,
  isLocal: boolean,
  container: GraphContainer,
): GraphNode {
  const angle = (hashString(ip) % 360) * (Math.PI / 180);
  const ring = 90 + (hashString(ip) % 80);
  const cx = container.clientWidth / 2;
  const cy = CARTOON_CANVAS_HEIGHT / 2;
  return {
    ip,
    x: isLocal ? cx : cx + Math.cos(angle) * ring,
    y: isLocal ? cy : cy + Math.sin(angle) * ring,
    vx: 0,
    vy: 0,
    lastSeenMs: nowMs,
    isLocal,
  };
}

export function upsertNode(
  nodes: Map<string, GraphNode>,
  ip: string,
  nowMs: number,
  isLocalCandidate: boolean,
  recent: boolean,
  container: GraphContainer,
): GraphNode {
  let node = nodes.get(ip);
  if (node === undefined) {
    const promote = isLocalCandidate && ![...nodes.values()].some((n) => n.isLocal);
    node = spawnNode(ip, nowMs, isLocalCandidate && promote, container);
    nodes.set(ip, node);
  } else if (isLocalCandidate && !node.isLocal && ![...nodes.values()].some((n) => n.isLocal)) {
    node.isLocal = true;
    node.x = container.clientWidth / 2;
    node.y = CARTOON_CANVAS_HEIGHT / 2;
  }
  if (recent) {
    node.lastSeenMs = nowMs;
  }
  return node;
}

// Physics tuning (per ~16.7ms step, clamped):
const REPULSION_K = 900; // f = K / d^2 (px per step^2), capped
const MAX_REPULSION = 6;
const REPULSION_RADIUS_PX = 200;
const SPRING_TARGET_PX = 110;
const SPRING_K = 0.004; // f = K * (d - target), px per step
const DAMPING = 0.85;

export function nodeKeyFor(srcIp: string | null | undefined): string {
  return srcIp === null || srcIp === undefined || srcIp === "" ? "unknown" : srcIp;
}

// Canonical, ORDER-INDEPENDENT key: an edge is an undirected spring/line,
// so "a>b" and "b>a" are the same connection. Direction only matters for
// the traveling packet dots, which carry their own explicit src/dst pair.
export function edgeKeyFor(srcIp: string, dstIp: string): string {
  return srcIp <= dstIp ? `${srcIp}${SPACER}${dstIp}` : `${dstIp}${SPACER}${srcIp}`;
}

export function splitEdgeKey(key: string): [string, string] {
  const sep = key.indexOf(SPACER);
  return [key.slice(0, sep), key.slice(sep + SPACER.length)];
}

// Pure: returns a NEW map, never mutates the input.
export function pruneStaleNodes(
  nodes: Map<string, GraphNode>,
  nowMs: number,
): Map<string, GraphNode> {
  const next = new Map<string, GraphNode>();
  for (const [ip, node] of nodes) {
    if (nowMs - node.lastSeenMs <= NODE_STALE_MS) {
      next.set(ip, node);
    }
  }
  return next;
}

// Pure: mutates node positions in place (velocity Verlet-lite). The local
// (pinned) node never moves. Repulsion between all non-local pairs,
// springs along edges toward SPRING_TARGET_PX, damping + speed cap so the
// layout settles instead of jittering forever.
export function applyPhysicsStep(
  nodes: GraphNode[],
  edges: string[],
  dtMs: number,
): void {
  const dt = Math.min(Math.max(dtMs, 0), 64) / 16.7;
  if (dt <= 0) {
    return;
  }
  const index = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    index.set(nodes[i].ip, i);
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.isLocal || b.isLocal) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 0 || d2 > REPULSION_RADIUS_PX * REPULSION_RADIUS_PX) {
        continue;
      }
      const f = Math.min(REPULSION_K / d2, MAX_REPULSION);
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f * dt;
      const fy = (dy / d) * f * dt;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const key of edges) {
    const [src, dst] = splitEdgeKey(key);
    const i = index.get(src);
    const j = index.get(dst);
    if (i === undefined || j === undefined) {
      continue;
    }
    const a = nodes[i];
    const b = nodes[j];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 0) {
      continue;
    }
    const f = SPRING_K * (d - SPRING_TARGET_PX) * dt;
    if (a.isLocal) {
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    } else if (b.isLocal) {
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
    } else {
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
  }

  const damping = Math.pow(DAMPING, dt);
  for (const node of nodes) {
    if (node.isLocal) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= damping;
    node.vy *= damping;
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    const maxSpeed = 8;
    if (speed > maxSpeed) {
      node.vx = (node.vx / speed) * maxSpeed;
      node.vy = (node.vy / speed) * maxSpeed;
    }
    node.x += node.vx * dt;
    node.y += node.vy * dt;
  }
}

interface GraphEdge {
  lastSeenMs: number;
  eventType: string;
}

interface TravelingDot {
  src: string;
  dst: string;
  startMs: number;
  durationMs: number;
  eventType: string;
}

interface Pulse {
  ip: string;
  startMs: number;
  durationMs: number;
}

interface NetworkGraphProps {
  eventBufferRef: RefObject<TimestampedNoteEvent[]>;
  redactIps: boolean;
}

export function NetworkGraph({
  eventBufferRef,
  redactIps,
}: NetworkGraphProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const redactRef = useRef(redactIps);

  useEffect(() => {
    redactRef.current = redactIps;
  }, [redactIps]);

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
      canvas.height = Math.round(CARTOON_CANVAS_HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${CARTOON_CANVAS_HEIGHT}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const degree = new Map<string, Set<string>>();
    const dots: TravelingDot[] = [];
    const pulses: Pulse[] = [];
    let lastProcessed = 0;
    let lastFrameMs = 0;

    const draw = (nowMs: number) => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = CARTOON_CANVAS_HEIGHT;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // ---- consume buffers ----
      const buffer = eventBufferRef.current;
      if (buffer.length < lastProcessed) {
        lastProcessed = 0;
      }
      const fresh = buffer.slice(lastProcessed);
      lastProcessed = buffer.length;
      for (const event of fresh) {
        const ageMs = nowMs - event.received_at_ms;
        const recent = ageMs <= 1000;
        if (event.event_type === "port_scan_alert") {
          if (event.src_ip !== null && event.src_ip !== undefined) {
            const src = nodeKeyFor(event.src_ip);
            upsertNode(nodes, src, nowMs, event.pan > 0.5, recent, container);
            if (recent) {
              pulses.push({ ip: src, startMs: nowMs, durationMs: event.duration_ms || 1200 });
            }
          }
          continue;
        }
        const src = nodeKeyFor(event.src_ip);
        const dst = nodeKeyFor(event.dst_ip);
        if (src === dst) {
          upsertNode(nodes, src, nowMs, event.pan > 0.5 || event.pan < -0.5, recent, container);
          continue;
        }
        upsertNode(nodes, src, nowMs, event.pan > 0.5, recent, container);
        upsertNode(nodes, dst, nowMs, event.pan < -0.5, recent, container);
        if (recent) {
          const key = edgeKeyFor(src, dst);
          const edge = edges.get(key);
          if (edge === undefined) {
            edges.set(key, { lastSeenMs: nowMs, eventType: event.event_type });
          } else {
            edge.lastSeenMs = nowMs;
            edge.eventType = event.event_type;
          }
          let neighbors = degree.get(src);
          if (neighbors === undefined) {
            neighbors = new Set();
            degree.set(src, neighbors);
          }
          neighbors.add(dst);
          neighbors = degree.get(dst);
          if (neighbors === undefined) {
            neighbors = new Set();
            degree.set(dst, neighbors);
          }
          neighbors.add(src);
          if (event.received_at_ms >= nowMs - TRAVEL_MAX_MS) {
            dots.push({
              src,
              dst,
              startMs: nowMs,
              durationMs: TRAVEL_MIN_MS + (hashString(`${src}${dst}${nowMs % 1000}`) % (TRAVEL_MAX_MS - TRAVEL_MIN_MS)),
              eventType: event.event_type,
            });
          }
        }
      }

      // ---- prune ----
      const pruned = pruneStaleNodes(nodes, nowMs);
      for (const ip of nodes.keys()) {
        if (!pruned.has(ip)) {
          edges.delete(ip);
          degree.delete(ip);
          for (const key of [...edges.keys()]) {
            const [a, b] = splitEdgeKey(key);
            if (a === ip || b === ip) {
              edges.delete(key);
            }
          }
        }
      }
      nodes.clear();
      for (const node of pruned.values()) {
        nodes.set(node.ip, node);
      }

      // ---- physics ----
      const local = [...nodes.values()].find((n) => n.isLocal);
      if (local !== undefined) {
        local.x = width / 2;
        local.y = height / 2;
        local.vx = 0;
        local.vy = 0;
      }
      const dtMs = lastFrameMs === 0 ? 16.7 : nowMs - lastFrameMs;
      lastFrameMs = nowMs;
      applyPhysicsStep([...nodes.values()], [...edges.keys()], dtMs);
      for (const node of nodes.values()) {
        if (!node.isLocal) {
          node.x = Math.min(width - 30, Math.max(30, node.x));
          node.y = Math.min(height - 30, Math.max(30, node.y));
        }
      }

      // ---- draw edges ----
      const redacted = redactRef.current;
      for (const [key, edge] of edges) {
        const [a, b] = splitEdgeKey(key);
        const na = nodes.get(a);
        const nb = nodes.get(b);
        if (na === undefined || nb === undefined) {
          continue;
        }
        const fade = 1 - Math.min(1, (nowMs - edge.lastSeenMs) / EDGE_FADE_MS);
        if (fade <= 0) {
          continue;
        }
        const parts = colorForEventType(edge.eventType).match(/[0-9a-f]{2}/gi);
        const rgb = parts !== null ? parts.slice(0, 3) : ["148", "163", "184"];
        ctx.strokeStyle = `rgba(${parseInt(rgb[0], 16)}, ${parseInt(rgb[1], 16)}, ${parseInt(rgb[2], 16)}, ${(0.1 + 0.35 * fade).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      // ---- draw dots ----
      for (let i = dots.length - 1; i >= 0; i--) {
        const dot = dots[i];
        const t = (nowMs - dot.startMs) / dot.durationMs;
        if (t >= 1) {
          dots.splice(i, 1);
          continue;
        }
        const a = nodes.get(dot.src);
        const b = nodes.get(dot.dst);
        if (a === undefined || b === undefined) {
          dots.splice(i, 1);
          continue;
        }
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        ctx.fillStyle = colorForEventType(dot.eventType);
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ---- draw nodes ----
      for (const node of nodes.values()) {
        const fade = 1 - Math.min(1, (nowMs - node.lastSeenMs) / NODE_STALE_MS);
        if (fade <= 0) {
          continue;
        }
        const radius = node.isLocal
          ? LOCAL_RADIUS
          : REMOTE_RADIUS_MIN + Math.min(3, (degree.get(node.ip)?.size ?? 0) * 0.45);
        const a = node.isLocal ? 0.95 * fade : (0.65 + 0.3 * fade) * fade;
        ctx.fillStyle = node.isLocal
          ? `rgba(52, 211, 153, ${a.toFixed(3)})`
          : `rgba(148, 163, 184, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (node.isLocal) {
          ctx.strokeStyle = `rgba(52, 211, 153, ${(0.5 * fade).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, LOCAL_RADIUS + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        let label = node.ip;
        if (redacted && label !== "unknown") {
          label = redactIp(label);
        }
        if (label.length > 18) {
          label = `${label.slice(0, 17)}…`;
        }
        ctx.fillStyle = `rgba(228, 231, 235, ${(0.5 * fade).toFixed(3)})`;
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, node.x, node.y + radius + 11);
      }

      // ---- pulses ----
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pulse = pulses[i];
        const t = (nowMs - pulse.startMs) / pulse.durationMs;
        if (t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const node = nodes.get(pulse.ip);
        if (node === undefined) {
          pulses.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = `rgba(239, 68, 68, ${(0.6 * (1 - t)).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 10 + 34 * t, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    let rafId = 0;
    const loop = (nowMs: number) => {
      draw(nowMs);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [eventBufferRef]);

  return (
    <div
      ref={containerRef}
      data-testid="network-graph"
      className="w-full overflow-hidden rounded-sm"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}