import { useEffect, useState } from "react";
import { getAnalyticsSnapshot, resetAnalytics, type AnalyticsSnapshot } from "../analytics";
import { EVENT_TYPE_COLORS } from "./PianoRoll";
import { redactIp } from "./packetFeedFormat";

interface AnalyticsPanelProps {
  redact: boolean;
}

const ANALYTIC_EVENTS = [
  "tcp_syn",
  "tcp_synack",
  "tcp_rst",
  "dns_query",
  "http_data",
  "udp",
  "icmp",
  "port_scan_alert",
];

const NO_DATA = "No data yet — connect or run the live demo.";

export function AnalyticsPanel({ redact }: AnalyticsPanelProps) {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot>(() =>
    getAnalyticsSnapshot(),
  );

  useEffect(() => {
    const interval = setInterval(() => setSnapshot(getAnalyticsSnapshot()), 500);
    return () => clearInterval(interval);
  }, []);

  const { eventCounts, ipCounts, alerts, sparkline, totalEvents } = snapshot;
  const topTalkers = [...ipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxCount = Math.max(1, ...Object.values(eventCounts));
  const maxTalker = Math.max(1, ...topTalkers.map(([, count]) => count));
  const maxSpark = Math.max(1, ...sparkline);

  return (
    <section data-testid="analytics-panel" className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
          Analytics
        </h2>
        <button
          type="button"
          onClick={() => {
            resetAnalytics();
            setSnapshot(getAnalyticsSnapshot());
          }}
          className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:border-aurora-500/40 hover:text-aurora-300"
        >
          Reset
        </button>
      </div>

      {totalEvents === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">{NO_DATA}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Event mix
            </h3>
            <ul className="space-y-1.5">
              {ANALYTIC_EVENTS.map((type) => {
                const count = eventCounts[type] ?? 0;
                if (count === 0) {
                  return null;
                }
                const color = EVENT_TYPE_COLORS[type] ?? "#94a3b8";
                return (
                  <li key={type} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 truncate text-zinc-400">
                      {type}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(3, (count / maxCount) * 100)}%`,
                          background: color,
                          boxShadow: `0 0 8px ${color}66`,
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-zinc-500">
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Top talkers
            </h3>
            <ul className="space-y-1.5">
              {topTalkers.length === 0 ? (
                <li className="text-xs text-zinc-500">No IP data captured.</li>
              ) : (
                topTalkers.map(([ip, count]) => (
                  <li key={ip} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 truncate font-mono text-zinc-300">
                      {redact ? redactIp(ip) : ip}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-aurora-500 to-cyan-glow"
                        style={{ width: `${Math.max(3, (count / maxTalker) * 100)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-zinc-500">
                      {count}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Traffic (events/sec)
            </h3>
            <div className="flex h-14 items-end gap-[2px]">
              {sparkline.length === 0 ? (
                <span className="text-xs text-zinc-500">Waiting…</span>
              ) : (
                sparkline.map((value, index) => (
                  <div
                    key={index}
                    className="w-1 flex-1 rounded-t bg-gradient-to-t from-aurora-600/60 to-violet-glow"
                    style={{
                      height: `${Math.max(4, (value / maxSpark) * 100)}%`,
                      opacity: 0.35 + (index / sparkline.length) * 0.65,
                    }}
                  />
                ))
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Port-scan alerts
            </h3>
            <ul className="space-y-1.5">
              {alerts.length === 0 ? (
                <li className="text-xs text-zinc-500">No alerts detected.</li>
              ) : (
                [...alerts].slice(-5).reverse().map((alert, index) => (
                  <li
                    key={`${alert.timestamp_ms}-${index}`}
                    className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                    <span className="font-mono text-red-300">
                      {redact && alert.src_ip !== null
                        ? redactIp(alert.src_ip)
                        : alert.src_ip ?? "unknown"}
                    </span>
                    <span className="ml-auto shrink-0 text-zinc-500">
                      {new Date(alert.timestamp_ms).toLocaleTimeString()}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}