import type { TimestampedNoteEvent } from "./PianoRoll";

export const TOKEN_BY_EVENT: Record<string, string> = {
  tcp_syn: "TCP_SYN",
  tcp_synack: "TCP_SYNACK",
  tcp_rst: "TCP_RST",
  dns_query: "DNS_QUERY",
  http_data: "HTTP_DATA",
  udp: "UDP",
  icmp: "ICMP",
  port_scan_alert: "PORT_SCAN",
};

export function redactIp(ip: string): string {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 !== null) {
    return `${v4[1]}.${v4[2]}.x.x`;
  }
  const groups = ip.split(":");
  if (groups.length > 4) {
    return `${groups.slice(0, Math.max(2, groups.length - 4)).join(":")}:x:x:x:x`;
  }
  return ip;
}

export function packetFeedRow(event: TimestampedNoteEvent, redacted: boolean): { token: string; body: string; isAlert: boolean } {
  const typeToken = TOKEN_BY_EVENT[event.event_type] ?? event.event_type.toUpperCase().replace(/_/g, "_");
  const fmtIp = (value: string | null | undefined): string => {
    if (value === null || value === undefined) {
      return "—";
    }
    return redacted ? redactIp(value) : value;
  };
  if (event.event_type === "port_scan_alert") {
    return {
      token: typeToken,
      body: `${fmtIp(event.src_ip)} → ??? ALERT`,
      isAlert: true,
    };
  }
  const src = fmtIp(event.src_ip);
  const dst = fmtIp(event.dst_ip);
  const srcPort = event.src_port !== null && event.src_port !== undefined ? `:${event.src_port}` : "";
  const dstPort = event.dst_port !== null && event.dst_port !== undefined ? `:${event.dst_port}` : "";
  return {
    token: typeToken,
    body: `${src}${srcPort} → ${dst}${dstPort} ${event.size_bytes}B`,
    isAlert: false,
  };
}