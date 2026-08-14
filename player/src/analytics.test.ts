import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAnalyticsSnapshot,
  recordAnalytics,
  resetAnalytics,
} from "./analytics";
import type { NoteEvent } from "./ws";

function makeEvent(eventType: string, srcIp?: string): NoteEvent {
  return {
    timestamp_ms: 0,
    event_type: eventType,
    pitch: 60,
    velocity: 0.5,
    duration_ms: 100,
    pan: 0,
    size_bytes: 100,
    src_ip: srcIp,
  };
}

describe("analytics store", () => {
  afterEach(() => {
    resetAnalytics();
    vi.useRealTimers();
  });

  it("tallies per-type and per-IP counts", () => {
    recordAnalytics(makeEvent("tcp_syn", "1.1.1.1"), 0);
    recordAnalytics(makeEvent("tcp_syn", "1.1.1.1"), 1);
    recordAnalytics(makeEvent("udp", "2.2.2.2"), 2);
    const snapshot = getAnalyticsSnapshot();
    expect(snapshot.eventCounts).toEqual({ tcp_syn: 2, udp: 1 });
    expect(snapshot.ipCounts.get("1.1.1.1")).toBe(2);
    expect(snapshot.ipCounts.get("2.2.2.2")).toBe(1);
    expect(snapshot.totalEvents).toBe(3);
  });

  it("skips IP tallying when src_ip is absent", () => {
    recordAnalytics(makeEvent("icmp"), 0);
    expect(getAnalyticsSnapshot().ipCounts.size).toBe(0);
  });

  it("records port-scan alerts with a cap", () => {
    for (let i = 0; i < 25; i += 1) {
      recordAnalytics(makeEvent("port_scan_alert", "10.0.0.5"), i);
    }
    const snapshot = getAnalyticsSnapshot();
    expect(snapshot.alerts.length).toBe(20);
    expect(snapshot.alerts[19].src_ip).toBe("10.0.0.5");
  });

  it("samples events-per-second into a sparkline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (let i = 0; i < 5; i += 1) {
      recordAnalytics(makeEvent("udp", "3.3.3.3"), i);
    }
    vi.setSystemTime(1_000);
    recordAnalytics(makeEvent("udp", "3.3.3.3"), 1_000);
    recordAnalytics(makeEvent("udp", "3.3.3.3"), 1_001);
    vi.setSystemTime(2_000);
    recordAnalytics(makeEvent("udp", "3.3.3.3"), 2_000);
    const snapshot = getAnalyticsSnapshot();
    expect(snapshot.sparkline).toEqual([5, 2]);
  });

  it("resets all state", () => {
    recordAnalytics(makeEvent("udp", "3.3.3.3"), 0);
    resetAnalytics();
    const snapshot = getAnalyticsSnapshot();
    expect(snapshot.totalEvents).toBe(0);
    expect(snapshot.eventCounts).toEqual({});
    expect(snapshot.ipCounts.size).toBe(0);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.sparkline).toEqual([]);
  });
});