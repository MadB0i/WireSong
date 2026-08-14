import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPhysicsStep,
  edgeAlphaBoostFor,
  edgeKeyFor,
  edgeWidthFor,
  isConnected,
  nodeKeyFor,
  pruneStaleNodes,
  splitEdgeKey,
  type GraphNode,
  NODE_STALE_MS,
  upsertNode,
  spawnNode,
  type GraphContainer,
} from "./NetworkGraph";

function makeNode(
  ip: string,
  x: number,
  y: number,
  lastSeenMs = 0,
  isLocal = false,
): GraphNode {
  return { ip, x, y, vx: 0, vy: 0, lastSeenMs, isLocal };
}

const testContainer: GraphContainer = { clientWidth: 800 };

describe("pruneStaleNodes", () => {
  it("removes nodes idle past the timeout, keeps recent ones, and does not mutate the input", () => {
    const nowMs = 20_000;
    const input = new Map<string, GraphNode>([
      ["known-recent", makeNode("one", 10, 10, nowMs - 14_000)],
      ["a", makeNode("a", 10, 10, nowMs - 20)],
      ["b", makeNode("b", 10, 10, nowMs - 1_000)],
      ["stale", makeNode("stale", 10, 10, nowMs - 15_001)],
      ["ancient", makeNode("ancient", 10, 10, nowMs - 60_000)],
    ]);
    const result = pruneStaleNodes(input, nowMs);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("known-recent")).toBe(true);
    expect(result.has("stale")).toBe(false);
    expect(result.has("ancient")).toBe(false);
    expect(result.size).toBe(3);
    expect(input.size).toBe(5);
    expect(input.get("a")).toBe(result.get("a"));
  });

  it("a node that keeps receiving events is never pruned, even if its first-ever event is older than the prune timeout", () => {
    const originalTimestamp = 1000;
    const nowMs = originalTimestamp + NODE_STALE_MS + 1000;
    const updatedTimestamp = nowMs - 100;

    const input = new Map<string, GraphNode>([
      ["active-node", makeNode("active-node", 10, 10, originalTimestamp)],
    ]);

    const node = input.get("active-node")!;
    node.lastSeenMs = updatedTimestamp;

    const result = pruneStaleNodes(input, nowMs);

    expect(result.has("active-node")).toBe(true);
    expect(result.get("active-node")!.lastSeenMs).toBe(updatedTimestamp);
  });
});

describe("edgeKeyFor", () => {
  it("is stable across calls and order-independent", () => {
    const a = "93.184.216.34";
    const b = "10.0.0.5";
    expect(edgeKeyFor(a, b)).toBe(edgeKeyFor(a, b));
    expect(edgeKeyFor(a, b)).toBe(edgeKeyFor(b, a));
    expect(edgeKeyFor(a, b)).toBe(`10.0.0.5>93.184.216.34`);
    const [src, dst] = splitEdgeKey(edgeKeyFor(a, b));
    expect([src, dst]).toEqual(["10.0.0.5", "93.184.216.34"]);
  });
});

describe("edgeWidthFor / edgeAlphaBoostFor (traffic weighting)", () => {
  it("starts at 1px for a single event and grows with traffic, capped", () => {
    expect(edgeWidthFor(1)).toBeCloseTo(1, 5);
    expect(edgeWidthFor(4)).toBeGreaterThan(edgeWidthFor(1));
    expect(edgeWidthFor(32)).toBeGreaterThan(edgeWidthFor(4));
    expect(edgeWidthFor(1_000_000)).toBeLessThanOrEqual(3.2);
    expect(edgeWidthFor(0)).toBe(edgeWidthFor(1));
    expect(edgeWidthFor(-5)).toBe(edgeWidthFor(1));
  });

  it("adds alpha boost for busy links, capped, and never exceeds the max", () => {
    expect(edgeAlphaBoostFor(1)).toBeCloseTo(0, 5);
    expect(edgeAlphaBoostFor(16)).toBeGreaterThan(edgeAlphaBoostFor(2));
    expect(edgeAlphaBoostFor(1_000_000)).toBeLessThanOrEqual(0.45);
    expect(edgeAlphaBoostFor(0)).toBe(edgeAlphaBoostFor(1));
  });
});

describe("isConnected", () => {
  it("matches either endpoint of an order-independent edge key", () => {
    const key = edgeKeyFor("10.0.0.5", "93.184.216.34");
    expect(isConnected(key, "10.0.0.5")).toBe(true);
    expect(isConnected(key, "93.184.216.34")).toBe(true);
    expect(isConnected(key, "8.8.8.8")).toBe(false);
    expect(isConnected(key, "10.0.0.5>93")).toBe(false);
  });
});

describe("applyPhysicsStep", () => {
  it("repels two unconnected nodes apart over one step", () => {
    const a = makeNode("a", 100, 100, 0, false);
    const b = makeNode("b", 112, 100, 0, false);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBe(12);
    applyPhysicsStep([a, b], [], 16.7);
    const dAfter = Math.hypot(b.x - a.x, b.y - a.y);
    expect(dAfter).toBeGreaterThan(12);
  });

  it("pulls two connected nodes closer when far past the target distance", () => {
    const a = makeNode("a", 100, 100, 0, false);
    const b = makeNode("b", 560, 100, 0, false);
    const before = Math.hypot(b.x - a.x, b.y - a.y);
    applyPhysicsStep([a, b], [edgeKeyFor("a", "b")], 16.7);
    const after = Math.hypot(b.x - a.x, b.y - a.y);
    expect(before).toBeGreaterThan(400);
    expect(after).toBeLessThan(before);
  });

  it("never moves the pinned local node", () => {
    const local = makeNode("local", 400, 120, 0, true);
    const remote = makeNode("remote", 40, 120, 0, false);
    applyPhysicsStep([local, remote], [edgeKeyFor("local", "remote")], 16.7);
    expect(local.x).toBe(400);
    expect(local.y).toBe(120);
    expect(local.vx).toBe(0);
    expect(local.vy).toBe(0);
    expect(remote.x).not.toBe(40);
  });
});

describe("nodeKeyFor (legacy fixtures without IPs)", () => {
  it("maps missing src_ip to a single shared 'unknown' key, never per-event", () => {
    expect(nodeKeyFor(null)).toBe("unknown");
    expect(nodeKeyFor(undefined)).toBe("unknown");
    expect(nodeKeyFor("")).toBe("unknown");
    expect(nodeKeyFor("192.168.1.5")).toBe("192.168.1.5");
    const map = new Map<string, GraphNode>();
    map.set(nodeKeyFor(null), makeNode("unknown", 0, 0));
    expect(map.size).toBe(1);
    map.set(nodeKeyFor(undefined), makeNode("unknown", 0, 0));
    expect(map.size).toBe(1);
  });
});

describe("NetworkGraph timeline simulation (automated E2E verification)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function getFade(node: GraphNode, nowMs: number): number {
    return 1 - Math.min(1, (nowMs - node.lastSeenMs) / NODE_STALE_MS);
  }

  it("node survives continuous traffic past 15s from first event, then prunes after traffic stops", () => {
    const nodes = new Map<string, GraphNode>();
    const testIp = "10.0.0.42";

    // t=0: first event arrives, node created
    let nowMs = 0;
    vi.setSystemTime(nowMs);
    upsertNode(nodes, testIp, nowMs, false, true, testContainer);
    expect(nodes.has(testIp)).toBe(true);
    expect(getFade(nodes.get(testIp)!, nowMs)).toBe(1);

    // t=5s: second event (recent)
    nowMs = 5_000;
    vi.setSystemTime(nowMs);
    upsertNode(nodes, testIp, nowMs, false, true, testContainer);
    expect(nodes.has(testIp)).toBe(true);
    expect(nodes.get(testIp)!.lastSeenMs).toBe(5_000);
    expect(getFade(nodes.get(testIp)!, nowMs)).toBe(1);

    // t=10s: third event
    nowMs = 10_000;
    vi.setSystemTime(nowMs);
    upsertNode(nodes, testIp, nowMs, false, true, testContainer);
    expect(nodes.get(testIp)!.lastSeenMs).toBe(10_000);

    // t=14s: fourth event (still within 15s of first, but lastSeenMs keeps updating)
    nowMs = 14_000;
    vi.setSystemTime(nowMs);
    upsertNode(nodes, testIp, nowMs, false, true, testContainer);
    expect(nodes.get(testIp)!.lastSeenMs).toBe(14_000);

    // t=16s: 16s after FIRST event, but only 2s after LAST event
    // Old buggy behavior: node would be pruned (16s > 15s from original timestamp)
    // Fixed behavior: node survives because lastSeenMs was updated to 14s
    nowMs = 16_000;
    vi.setSystemTime(nowMs);
    const pruned1 = pruneStaleNodes(nodes, nowMs);
    expect(pruned1.has(testIp)).toBe(true);
    expect(getFade(pruned1.get(testIp)!, nowMs)).toBeCloseTo(1 - 2_000 / NODE_STALE_MS, 2); // fade ~0.87

    // t=20s: another event arrives, node still alive
    nowMs = 20_000;
    vi.setSystemTime(nowMs);
    upsertNode(nodes, testIp, nowMs, false, true, testContainer);
    expect(nodes.get(testIp)!.lastSeenMs).toBe(20_000);

    // t=22s: prune check - node survives (2s since last event)
    nowMs = 22_000;
    vi.setSystemTime(nowMs);
    const pruned2 = pruneStaleNodes(nodes, nowMs);
    expect(pruned2.has(testIp)).toBe(true);

    // TRAFFIC STOPS: no more events

    // t=30s: 10s after last event, still within 15s window
    nowMs = 30_000;
    vi.setSystemTime(nowMs);
    const pruned3 = pruneStaleNodes(nodes, nowMs);
    expect(pruned3.has(testIp)).toBe(true);
    expect(getFade(pruned3.get(testIp)!, nowMs)).toBeCloseTo(1 - 10_000 / NODE_STALE_MS, 2); // fade ~0.33

    // t=36s: 16s after last event - NOW past the 15s timeout, node should prune
    nowMs = 36_000;
    vi.setSystemTime(nowMs);
    const pruned4 = pruneStaleNodes(nodes, nowMs);
    expect(pruned4.has(testIp)).toBe(false);
  });

  it("documents the bug: without lastSeenMs update, node incorrectly prunes at 15s from first event", () => {
    // This test uses an inline buggy implementation to DOCUMENT what the old
    // buggy behavior would have done. It does NOT test the current code.
    // The real upsertNode already has the fix, so we simulate the bug manually.
    function buggyUpsertNode(
      nodes: Map<string, GraphNode>,
      ip: string,
      nowMs: number,
      _isLocalCandidate: boolean,
      _recent: boolean,
      _container: GraphContainer,
    ): GraphNode {
      let node = nodes.get(ip);
      if (node === undefined) {
        node = spawnNode(ip, nowMs, false, _container);
        nodes.set(ip, node);
      }
      // BUG: missing `if (recent) { node.lastSeenMs = nowMs; }`
      return node;
    }

    const nodes = new Map<string, GraphNode>();
    const testIp = "10.0.0.99";

    // t=0: first event
    let nowMs = 0;
    vi.setSystemTime(nowMs);
    buggyUpsertNode(nodes, testIp, nowMs, false, true, testContainer);

    // t=5s: repeat event (but lastSeenMs NOT updated due to bug)
    nowMs = 5_000;
    vi.setSystemTime(nowMs);
    buggyUpsertNode(nodes, testIp, nowMs, false, true, testContainer);

    // t=10s: repeat event
    nowMs = 10_000;
    vi.setSystemTime(nowMs);
    buggyUpsertNode(nodes, testIp, nowMs, false, true, testContainer);

    // t=14s: repeat event
    nowMs = 14_000;
    vi.setSystemTime(nowMs);
    buggyUpsertNode(nodes, testIp, nowMs, false, true, testContainer);

    // t=16s: 16s after first event - with bug, lastSeenMs is still 0, so node prunes
    nowMs = 16_000;
    vi.setSystemTime(nowMs);
    const pruned = pruneStaleNodes(nodes, nowMs);

    // BUG MANIFESTS: node incorrectly pruned despite ongoing traffic
    expect(pruned.has(testIp)).toBe(false);
    // The node's lastSeenMs never updated from original 0
    expect(nodes.get(testIp)!.lastSeenMs).toBe(0);
  });
});