import { describe, expect, it, vi } from "vitest";

// This file only needs the voice-id registry from ./synth, never real
// audio: mock Tone so the heavy library is not imported here (keeps the
// full suite fast and avoids import contention with synth-packs.test.ts,
// which re-imports the real Tone module).
vi.mock("tone", () => ({
  Frequency: (pitch: number) => ({ toFrequency: () => 440 * 2 ** ((pitch - 69) / 12) }),
  gainToDb: (v: number) => v,
  now: () => 0,
  start: async () => undefined,
  PluckSynth: class {},
  Synth: class {},
  FMSynth: class {},
  MetalSynth: class {},
  MonoSynth: class {},
  Filter: class {},
  Gain: class {},
  Panner: class {},
  Volume: class {},
}));

import {
  BUNDLED_PACKS,
  PACK_IDS,
  getBundledPack,
  loadPack,
  validatePackDefinition,
  type FetchFn,
} from "./packs";
import { KNOWN_VOICE_IDS } from "./synth";

const BACKEND_EVENT_TYPES = [
  "tcp_syn",
  "tcp_synack",
  "tcp_rst",
  "dns_query",
  "http_data",
  "udp",
  "icmp",
  "port_scan_alert",
];

function stubFetch(payload: unknown, ok = true, status = 200): FetchFn {
  return async (url: string) => {
    if (!url.includes("packs/")) {
      throw new Error(`unexpected url ${url}`);
    }
    return {
      ok,
      status,
      json: async () => {
        if (typeof payload === "string" && payload === "{invalid") {
          throw new SyntaxError("Unexpected token in JSON");
        }
        return payload;
      },
    };
  };
}

describe("bundled pack manifests", () => {
  it("every known pack id validates with zero errors", () => {
    for (const id of PACK_IDS) {
      expect(validatePackDefinition(id, BUNDLED_PACKS[id])).toEqual([]);
    }
  });

  it("carries a display name and tagline for the UI", () => {
    for (const id of PACK_IDS) {
      const def = BUNDLED_PACKS[id];
      expect(def.id).toBe(id);
      expect(def.displayName.trim().length).toBeGreaterThan(0);
      expect(def.tagline.trim().length).toBeGreaterThan(0);
    }
  });

  it("maps all 8 backend event types to known synth voices, alarm only on port_scan_alert", () => {
    for (const id of PACK_IDS) {
      const def = BUNDLED_PACKS[id];
      expect(Object.keys(def.events).sort()).toEqual([...BACKEND_EVENT_TYPES].sort());
      for (const eventType of BACKEND_EVENT_TYPES) {
        const entry = def.events[eventType];
        expect(KNOWN_VOICE_IDS, `${id}/${eventType}`).toContain(entry.voice);
        expect(entry.fallbackSynth.kind.trim().length, `${id}/${eventType}`).toBeGreaterThan(0);
        expect(entry.role, `${id}/${eventType}`).toBe(eventType === "port_scan_alert" ? "alarm" : "note");
      }
    }
  });

  it("getBundledPack throws a clear error for unknown ids", () => {
    expect(() => getBundledPack("nope")).toThrow('unknown pack "nope"');
  });
});

describe("validatePackDefinition", () => {
  it("rejects a non-object payload", () => {
    expect(validatePackDefinition("ambient", null)).toEqual([
      'pack "ambient": top level must be a JSON object',
    ]);
  });

  it("reports id mismatch, missing events and unknown events", () => {
    const def = JSON.parse(JSON.stringify(BUNDLED_PACKS.ambient));
    def.id = "other";
    delete def.events.udp;
    def.events.bogus = { voice: "sine", label: "x", role: "note", sample: null, fallbackSynth: { kind: "Synth" } };
    const problems = validatePackDefinition("ambient", def);
    expect(problems.some((p) => p.includes('"id"'))).toBe(true);
    expect(problems.some((p) => p.includes('missing event "udp"'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown event "bogus"'))).toBe(true);
  });

  it("requires exactly port_scan_alert as the alarm voice", () => {
    const def = JSON.parse(JSON.stringify(BUNDLED_PACKS.ambient));
    def.events.tcp_syn.role = "alarm";
    const problems = validatePackDefinition("ambient", def);
    expect(problems.some((p) => p.includes("alarm"))).toBe(true);
  });

  it("rejects events without a fallback synth kind", () => {
    const def = JSON.parse(JSON.stringify(BUNDLED_PACKS.ambient));
    def.events.icmp.fallbackSynth = {};
    const problems = validatePackDefinition("ambient", def);
    expect(problems.some((p) => p.includes("fallbackSynth.kind"))).toBe(true);
  });
});

describe("loadPack", () => {
  it("loads and validates a manifest, requesting the pack.json URL", async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => BUNDLED_PACKS.ambient };
    };
    const def = await loadPack("ambient", fetchFn);
    expect(def.id).toBe("ambient");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("packs/ambient/pack.json");
  });

  it("names the pack id and HTTP status when the manifest is missing", async () => {
    await expect(loadPack("ambient", stubFetch(null, false, 404))).rejects.toThrow(
      'pack "ambient" not found: HTTP 404',
    );
  });

  it("reports invalid JSON with the pack id", async () => {
    await expect(loadPack("ambient", stubFetch("{invalid"))).rejects.toThrow(
      'pack "ambient" has invalid JSON',
    );
  });

  it("lists validation problems when the manifest is malformed", async () => {
    const broken = JSON.parse(JSON.stringify(BUNDLED_PACKS.ambient));
    delete broken.events.tcp_rst;
    await expect(loadPack("ambient", stubFetch(broken))).rejects.toThrow('missing event "tcp_rst"');
  });

  it("wraps network failures with the pack id and URL", async () => {
    const failing: FetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(loadPack("chiptune", failing)).rejects.toThrow('failed to load pack "chiptune"');
  });
});
