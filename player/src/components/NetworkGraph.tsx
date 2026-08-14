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
const HOVER_RADIUS_PX = 18;
const SWEEP_RPM = 0.35;
const SWEEP_WEDGE_RAD = 0.45;
const RING_MIN_GAP_MS = 350;
const RING_DURATION_MS = 800;
const BURST_DURATION_MS = 450;
const BURST_PARTICLE_COUNT = 8;

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

// Edge stroke width scales with traffic count (log curve so 1 event ≈ 1px,
// busy links get visibly thicker without exploding visually).
export function edgeWidthFor(eventCount: number): number {
  return Math.min(3.2, 1 + Math.log2(Math.max(1, eventCount)) * 0.55);
}

// Extra alpha for busy edges, layered on top of the base fade alpha.
export function edgeAlphaBoostFor(eventCount: number): number {
  return Math.min(0.45, Math.log2(Math.max(1, eventCount)) * 0.12);
}

// Whether an (order-independent) edge key touches the given ip.
export function isConnected(edgeKey: string, ip: string): boolean {
  const [a, b] = splitEdgeKey(edgeKey);
  return a === ip || b === ip;
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
  eventCount: number;
}

interface TravelingDot {
  src: string;
  dst: string;
  startMs: number;
  durationMs: number;
  eventType: string;
  positions: number[]; // [x1, y1, x2, y2, ...] sampled each frame
}

interface Pulse {
  ip: string;
  startMs: number;
  durationMs: number;
}

interface Burst {
  x: number;
  y: number;
  startMs: number;
  durationMs: number;
  eventType: string;
  seed: number;
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
    const rings: Pulse[] = [];
    const bursts: Burst[] = [];
    const lastRingMs = new Map<string, number>();
    let lastProcessed = 0;
    let lastFrameMs = 0;
    let lastPulseAddMs = 0;
    let sweepAngle = 0;
    let hoveredIp: string | null = null;

    // ---- hover tracking (highlight + tooltip) ----
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: string | null = null;
      let bestDist = HOVER_RADIUS_PX * HOVER_RADIUS_PX;
      for (const node of nodes.values()) {
        const dx = node.x - mx;
        const dy = node.y - my;
        const d = dx * dx + dy * dy;
        if (d <= bestDist) {
          bestDist = d;
          best = node.ip;
        }
      }
      hoveredIp = best;
      canvas.style.cursor = best === null ? "default" : "pointer";
    };
    const onPointerLeave = () => {
      hoveredIp = null;
      canvas.style.cursor = "default";
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    const draw = (nowMs: number) => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = CARTOON_CANVAS_HEIGHT;
      const hovered = hoveredIp;
      const frameDt = lastFrameMs === 0 ? 16.7 : nowMs - lastFrameMs;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // ---- consume buffers ----
      const buffer = eventBufferRef.current;
      if (buffer.length < lastProcessed) {
        lastProcessed = 0;
      }
      const fresh = buffer.slice(lastProcessed);
      lastProcessed = buffer.length;

      // ---- recent event count for pulse triggering ----
      const recentEventCount = eventBufferRef.current.filter(
        (e) => nowMs - e.received_at_ms <= 1000
      ).length;

      // ---- local node (pinned at center) ----
      const local = [...nodes.values()].find((n) => n.isLocal);

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
            edges.set(key, { lastSeenMs: nowMs, eventType: event.event_type, eventCount: 1 });
          } else {
            edge.lastSeenMs = nowMs;
            edge.eventType = event.event_type;
            edge.eventCount += 1;
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
              positions: [],
            });
          }
          // sonar echo ring on the destination (throttled per node)
          const lastRing = lastRingMs.get(dst);
          if (lastRing === undefined || nowMs - lastRing >= RING_MIN_GAP_MS) {
            lastRingMs.set(dst, nowMs);
            rings.push({ ip: dst, startMs: nowMs, durationMs: RING_DURATION_MS });
          }
        }
      }

      // ---- local node transmit-pulse (activity-driven, not fixed-interval) ----
      if (recentEventCount > 0 && nowMs - lastPulseAddMs > 800) {
        pulses.push({ ip: local?.ip ?? "", startMs: nowMs, durationMs: 1500 });
        lastPulseAddMs = nowMs;
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

      // ---- radar range rings (structural framing on local node) ----
      if (local !== undefined) {
        const maxRadius = Math.min(width, height) * 0.45;
        const ringStep = maxRadius / 3;
        ctx.strokeStyle = "rgba(129, 140, 248, 0.09)";
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          const r = i * ringStep;
          ctx.beginPath();
          ctx.arc(local.x, local.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }

        // ---- radar sweep (rotating beam) ----
        sweepAngle += ((SWEEP_RPM * Math.PI * 2) * frameDt) / 1000;
        const sweepGrad = ctx.createRadialGradient(local.x, local.y, 0, local.x, local.y, maxRadius);
        sweepGrad.addColorStop(0, "rgba(129, 140, 248, 0.12)");
        sweepGrad.addColorStop(1, "rgba(129, 140, 248, 0)");
        ctx.fillStyle = sweepGrad;
        ctx.beginPath();
        ctx.moveTo(local.x, local.y);
        ctx.arc(local.x, local.y, maxRadius, sweepAngle - SWEEP_WEDGE_RAD, sweepAngle);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(129, 140, 248, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(local.x, local.y);
        ctx.lineTo(
          local.x + Math.cos(sweepAngle) * maxRadius,
          local.y + Math.sin(sweepAngle) * maxRadius,
        );
        ctx.stroke();
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
        const connectedToHover = hovered !== null && isConnected(key, hovered);
        const dim = hovered !== null && !connectedToHover;
        const weight = edgeWidthFor(edge.eventCount);
        const alphaBoost = edgeAlphaBoostFor(edge.eventCount);
        const alpha = Math.min(0.9, 0.1 + 0.35 * fade + alphaBoost) * (dim ? 0.15 : 1);
        const parts = colorForEventType(edge.eventType).match(/[0-9a-f]{2}/gi);
        const rgb = parts !== null ? parts.slice(0, 3) : ["148", "163", "184"];
        const r = parseInt(rgb[0], 16);
        const g = parseInt(rgb[1], 16);
        const blue = parseInt(rgb[2], 16);
        // stable per-edge bend so the graph reads organic, not chaotic
        const curve = ((hashString(key) % 20) - 10) * 0.002;
        if (!dim && (weight > 1.3 || connectedToHover)) {
          // soft under-glow pass (cheap fake glow, no shadowBlur cost)
          ctx.strokeStyle = `rgba(${r}, ${g}, ${blue}, ${(alpha * 0.18).toFixed(3)})`;
          ctx.lineWidth = weight + 3.5;
          curvedEdgePath(ctx, na.x, na.y, nb.x, nb.y, curve);
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(${r}, ${g}, ${blue}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = connectedToHover ? weight + 1 : weight;
        curvedEdgePath(ctx, na.x, na.y, nb.x, nb.y, curve);
        ctx.stroke();
      }

      // ---- draw dots ----
      for (let i = dots.length - 1; i >= 0; i--) {
        const dot = dots[i];
        const t = (nowMs - dot.startMs) / dot.durationMs;
        if (t >= 1) {
          const dstNode = nodes.get(dot.dst);
          if (dstNode !== undefined) {
            bursts.push({
              x: dstNode.x,
              y: dstNode.y,
              startMs: nowMs,
              durationMs: BURST_DURATION_MS,
              eventType: dot.eventType,
              seed: (hashString(`${dot.src}${dot.dst}${dot.startMs}`) % 628) / 100,
            });
          }
          dots.splice(i, 1);
          continue;
        }
        const a = nodes.get(dot.src);
        const b = nodes.get(dot.dst);
        if (a === undefined || b === undefined) {
          dots.splice(i, 1);
          continue;
        }
        // sample current position into the trail buffer
        const curX = a.x + (b.x - a.x) * t;
        const curY = a.y + (b.y - a.y) * t;
        dot.positions.push(curX, curY);
        // keep only last 6 position pairs (12 numbers = 6 points)
        if (dot.positions.length > 12) {
          dot.positions.splice(0, dot.positions.length - 12);
        }
        // draw fading trail from stored positions
        ctx.globalAlpha = 0.25;
        for (let j = 0; j < dot.positions.length; j += 2) {
          const px = dot.positions[j];
          const py = dot.positions[j + 1];
          const ageRatio = j / dot.positions.length;
          const radius = 2.4 * (1 - ageRatio * 0.5);
          ctx.fillStyle = colorForEventType(dot.eventType);
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        // draw current point on top
        ctx.globalAlpha = 1;
        ctx.fillStyle = colorForEventType(dot.eventType);
        ctx.beginPath();
        ctx.arc(curX, curY, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(curX, curY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ---- draw nodes ----
      for (const node of nodes.values()) {
        const fade = 1 - Math.min(1, (nowMs - node.lastSeenMs) / NODE_STALE_MS);
        if (fade <= 0) {
          continue;
        }
        const isHovered = hovered === node.ip;
        const connectedToHover =
          hovered !== null && !isHovered && (degree.get(hovered)?.has(node.ip) ?? false);
        const dim = hovered !== null && !isHovered && !connectedToHover;
        const radius =
          (node.isLocal
            ? LOCAL_RADIUS
            : REMOTE_RADIUS_MIN + Math.min(3, (degree.get(node.ip)?.size ?? 0) * 0.45)) +
          (isHovered ? 2 : 0);
        const a = (node.isLocal ? 0.95 * fade : (0.65 + 0.3 * fade) * fade) * (dim ? 0.22 : 1);
        ctx.fillStyle = node.isLocal
          ? `rgba(34, 211, 238, ${a.toFixed(3)})`
          : `rgba(165, 180, 252, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (node.isLocal) {
          ctx.strokeStyle = `rgba(129, 140, 248, ${((0.55 * fade) * (dim ? 0.22 : 1)).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, LOCAL_RADIUS + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (isHovered) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = `rgba(129, 140, 248, ${(0.35 * fade).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 9, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Always-visible label: show IP for nodes seen within last 5 seconds,
        // tied to the node's fade (fades with it). Omit for older nodes to reduce clutter.
        // A hovered node always shows its label regardless of age.
        const labelAge = nowMs - node.lastSeenMs;
        if (labelAge <= 5_000 || isHovered) {
          let label = node.ip;
          if (redacted && label !== "unknown") {
            label = redactIp(label);
          }
          if (label.length > 18) {
            label = `${label.slice(0, 17)}…`;
          }
          ctx.fillStyle = `rgba(228, 231, 235, ${((isHovered ? 0.9 : 0.5) * fade).toFixed(3)})`;
          ctx.font = "9px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.fillText(label, node.x, node.y - radius - 4);
        }
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

      // ---- sonar rings (node receive echo) ----
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i];
        const t = (nowMs - ring.startMs) / ring.durationMs;
        if (t >= 1) {
          rings.splice(i, 1);
          continue;
        }
        const node = nodes.get(ring.ip);
        if (node === undefined) {
          rings.splice(i, 1);
          continue;
        }
        const ease = 1 - Math.pow(1 - t, 3);
        ctx.strokeStyle = `rgba(34, 211, 238, ${(0.5 * (1 - t)).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4 + ease * 26, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ---- particle bursts (packet arrival impact) ----
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        const t = (nowMs - burst.startMs) / burst.durationMs;
        if (t >= 1) {
          bursts.splice(i, 1);
          continue;
        }
        const fade = 1 - t;
        ctx.fillStyle = colorForEventType(burst.eventType);
        for (let j = 0; j < BURST_PARTICLE_COUNT; j++) {
          const angle = (j / BURST_PARTICLE_COUNT) * Math.PI * 2 + burst.seed;
          const dist = Math.sin(t * Math.PI) * 20;
          const px = burst.x + Math.cos(angle) * dist;
          const py = burst.y + Math.sin(angle) * dist;
          ctx.globalAlpha = fade * 0.85;
          ctx.beginPath();
          ctx.arc(px, py, 1.6 * (1 - t * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // ---- hover tooltip ----
      if (hoveredIp !== null) {
        const node = nodes.get(hoveredIp);
        if (node !== undefined) {
          drawNodeTooltip(
            ctx,
            node,
            degree.get(node.ip)?.size ?? 0,
            nowMs,
            redacted,
            width,
            height,
          );
        }
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
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [eventBufferRef]);

  return (
    <div
      ref={containerRef}
      data-testid="network-graph"
      className="w-full overflow-hidden rounded-2xl"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

function drawNodeTooltip(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  connectionCount: number,
  nowMs: number,
  redacted: boolean,
  canvasWidth: number,
  canvasHeight: number,
): void {
  let label = node.ip;
  if (redacted && label !== "unknown") {
    label = redactIp(label);
  }
  const lastSeenMs = Math.max(0, nowMs - node.lastSeenMs);
  const lastSeenLabel = lastSeenMs < 1000 ? "now" : `${(lastSeenMs / 1000).toFixed(1)}s ago`;
  const lines = [
    label,
    `${connectionCount} connection${connectionCount === 1 ? "" : "s"}`,
    `last seen ${lastSeenLabel}`,
  ];
  ctx.font = "10px JetBrains Mono, monospace";
  const lineHeight = 14;
  const padX = 9;
  const padY = 7;
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
  }
  const boxWidth = maxWidth + padX * 2;
  const boxHeight = lines.length * lineHeight + padY * 2;
  let x = node.x + 12;
  let y = node.y - boxHeight - 10;
  x = Math.max(4, Math.min(canvasWidth - boxWidth - 4, x));
  y = Math.max(4, Math.min(canvasHeight - boxHeight - 4, y));
  roundRectPath(ctx, x, y, boxWidth, boxHeight, 7);
  ctx.fillStyle = "rgba(7, 9, 16, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(129, 140, 248, 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "rgba(226, 232, 240, 0.95)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, x + padX, y + padY + i * lineHeight);
  });
  ctx.textBaseline = "alphabetic";
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Quadratic bezier between two nodes, bent perpendicular by a stable
// per-edge factor so overlapping links read as organic arcs.
function curvedEdgePath(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  curve: number,
): void {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const cxp = mx + nx * curve * len;
  const cyp = my + ny * curve * len;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(cxp, cyp, bx, by);
}