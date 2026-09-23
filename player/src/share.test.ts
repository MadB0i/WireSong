import { beforeEach, describe, expect, it } from "vitest";
import {
  beginShareCapture,
  buildSharePage,
  captureShareEvent,
  currentShareContext,
  endShareCapture,
} from "./share";
import { setRaga } from "./audio/ragas";
import { setAutoSeason, setManualFestivalId } from "./audio/festivals";
import { setVoicePack } from "./audio/synth";
import type { NoteEvent } from "./ws";

const EVENT: NoteEvent = {
  timestamp_ms: 1,
  event_type: "tcp_syn",
  pitch: 60,
  velocity: 80,
  duration_ms: 200,
  pan: 0.2,
  size_bytes: 60,
};

describe("share capture", () => {
  beforeEach(() => {
    setVoicePack("ambient");
    setRaga("bhupali");
    setAutoSeason(false);
    setManualFestivalId(null);
  });

  it("collects musical metadata while active", () => {
    beginShareCapture();
    captureShareEvent(EVENT);
    const recording = endShareCapture();
    expect(recording).not.toBeNull();
    expect(recording!.events).toHaveLength(1);
    expect(recording!.events[0]).toMatchObject({
      type: "tcp_syn",
      pitch: 60,
      velocity: 80,
      duration_ms: 200,
      pan: 0.2,
    });
    expect(recording!.events[0].t).toBeGreaterThanOrEqual(0);
    expect(recording!.ended_at).toBeGreaterThanOrEqual(recording!.started_at);
  });

  it("drops events outside an active capture", () => {
    captureShareEvent(EVENT);
    expect(endShareCapture()).toBeNull();
  });

  it("is empty after ending a capture", () => {
    beginShareCapture();
    captureShareEvent(EVENT);
    endShareCapture();
    expect(endShareCapture()).toBeNull();
  });

  it("stores the scale degree with each event", () => {
    beginShareCapture();
    captureShareEvent({ ...EVENT, pitch: 76, degree: undefined });
    const recording = endShareCapture();
    expect(recording!.events[0].d).toBe(7);
  });

  it("captures the performance context with pack, raga, and festival", () => {
    const context = currentShareContext();
    expect(context).toMatchObject({
      packId: "ambient",
      packLabel: "Ambient",
      ragaId: "bhupali",
      ragaName: "Bhupali",
      festivalId: null,
      festivalLabel: null,
    });
    beginShareCapture();
    captureShareEvent(EVENT);
    const recording = endShareCapture();
    expect(recording!.context).toEqual(context);
  });
});

describe("buildSharePage", () => {
  it("embeds the context labels and musical metadata, never IPs", () => {
    beginShareCapture();
    captureShareEvent({
      ...EVENT,
      src_ip: "10.0.0.5",
      dst_ip: "93.184.216.34",
      src_port: 52341,
      dst_port: 443,
    });
    const recording = endShareCapture();
    const html = buildSharePage(recording!, null);
    expect(html).toContain("Ambient");
    expect(html).toContain("Bhupali");
    expect(html).toContain("<canvas");
    expect(html).toContain("port_scan_alert");
    expect(html).not.toContain("10.0.0.5");
    expect(html).not.toContain("93.184.216.34");
    expect(html).not.toContain("52341");
  });
});