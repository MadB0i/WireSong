import type { NoteEvent } from "./ws";

export interface AlertRecord {
  timestamp_ms: number;
  src_ip: string | null;
  event_count: number;
}

interface AnalyticsState {
  eventCounts: Record<string, number>;
  ipCounts: Map<string, number>;
  alerts: AlertRecord[];
  sparkline: number[];
  startedAtMs: number;
  secondBucketStartMs: number;
  eventsInBucket: number;
  started: boolean;
}

const SPARKLINE_CAPACITY = 60;

const state: AnalyticsState = {
  eventCounts: {},
  ipCounts: new Map<string, number>(),
  alerts: [],
  sparkline: [],
  startedAtMs: 0,
  secondBucketStartMs: 0,
  eventsInBucket: 0,
  started: false,
};

function pushSparklineSample(nowMs: number): void {
  state.sparkline.push(state.eventsInBucket);
  if (state.sparkline.length > SPARKLINE_CAPACITY) {
    state.sparkline.shift();
  }
  state.eventsInBucket = 0;
  state.secondBucketStartMs = nowMs;
}

export function recordAnalytics(event: NoteEvent, nowMs: number): void {
  if (!state.started) {
    state.started = true;
    state.startedAtMs = nowMs;
    state.secondBucketStartMs = nowMs;
  }
  if (nowMs - state.secondBucketStartMs >= 1000) {
    pushSparklineSample(nowMs);
  }
  state.eventsInBucket += 1;

  const type = event.event_type || "unknown";
  state.eventCounts[type] = (state.eventCounts[type] ?? 0) + 1;

  const src = event.src_ip ?? null;
  if (src !== null) {
    state.ipCounts.set(src, (state.ipCounts.get(src) ?? 0) + 1);
  }

  if (event.event_type === "port_scan_alert") {
    state.alerts.push({
      timestamp_ms: nowMs,
      src_ip: src,
      event_count: event.size_bytes ?? 0,
    });
    if (state.alerts.length > 20) {
      state.alerts.shift();
    }
  }
}

export function resetAnalytics(): void {
  state.eventCounts = {};
  state.ipCounts = new Map<string, number>();
  state.alerts = [];
  state.sparkline = [];
  state.startedAtMs = 0;
  state.secondBucketStartMs = 0;
  state.eventsInBucket = 0;
  state.started = false;
}

export interface AnalyticsSnapshot {
  eventCounts: Record<string, number>;
  ipCounts: Map<string, number>;
  alerts: AlertRecord[];
  sparkline: number[];
  totalEvents: number;
  startedAtMs: number;
}

export function getAnalyticsSnapshot(): AnalyticsSnapshot {
  return {
    eventCounts: { ...state.eventCounts },
    ipCounts: new Map(state.ipCounts),
    alerts: [...state.alerts],
    sparkline: [...state.sparkline],
    totalEvents: Object.values(state.eventCounts).reduce((a, b) => a + b, 0),
    startedAtMs: state.startedAtMs,
  };
}