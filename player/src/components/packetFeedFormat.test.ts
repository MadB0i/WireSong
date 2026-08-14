import { describe, expect, it } from "vitest";
import { packetFeedRow, redactIp } from "./packetFeedFormat";

describe("redactIp", () => {
  it("masks the tail of IPv4 addresses", () => {
    expect(redactIp("192.168.1.42")).toBe("192.168.x.x");
  });

  it("masks the tail of IPv6 addresses", () => {
    expect(redactIp("2001:db8::beef:1234:abcd")).toBe("2001:db8:x:x:x:x");
  });

  it("leaves short or malformed strings unchanged", () => {
    expect(redactIp("10.0.0.5")).toBe("10.0.x.x");
    expect(redactIp("localhost")).toBe("localhost");
  });
});

describe("packetFeedRow", () => {
  it("redacts endpoints when asked", () => {
    const row = packetFeedRow(
      {
        timestamp_ms: 0,
        event_type: "tcp_syn",
        pitch: 60,
        velocity: 0.5,
        duration_ms: 100,
        pan: 0,
        size_bytes: 54,
        src_ip: "192.168.1.42",
        dst_ip: "93.184.216.34",
        src_port: 52341,
        dst_port: 443,
        received_at_ms: 0,
      },
      true,
    );
    expect(row.body).toContain("192.168.x.x");
    expect(row.body).toContain("93.184.x.x");
    expect(row.body).toContain(":52341");
  });

  it("shows full endpoints when redaction is off", () => {
    const row = packetFeedRow(
      {
        timestamp_ms: 0,
        event_type: "tcp_syn",
        pitch: 60,
        velocity: 0.5,
        duration_ms: 100,
        pan: 0,
        size_bytes: 54,
        src_ip: "192.168.1.42",
        dst_ip: "93.184.216.34",
        src_port: 52341,
        dst_port: 443,
        received_at_ms: 0,
      },
      false,
    );
    expect(row.body).toContain("192.168.1.42");
    expect(row.body).toContain("93.184.216.34");
  });
});