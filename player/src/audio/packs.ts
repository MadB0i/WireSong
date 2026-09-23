import ambientPackJson from "../packs/ambient/pack.json";
import axomPackJson from "../packs/axom/pack.json";
import punjabPackJson from "../packs/punjab/pack.json";import chiptunePackJson from "../packs/chiptune/pack.json";
import ensemblePackJson from "../packs/ensemble/pack.json";
import orchestralPackJson from "../packs/orchestral/pack.json";

// Data-driven instrument packs.
//
// Canonical manifests live in `player/src/packs/<id>/pack.json` (imported by
// the bundle); `scripts/sync-packs.mjs` mirrors them to
// `player/public/packs/<id>/pack.json` for the runtime fetch path. Each pack
// describes, per backend event type: which voice to play, an optional sample
// file, and the synthesized fallback that must work with zero sample files
// present. The JSON files are the source of truth; they are bundled at build
// time for instant synchronous use and re-fetched from the network at runtime
// so a stale deploy is detected (see ensurePacksFromNetwork).

export const EVENT_TYPES = [
  "tcp_syn",
  "tcp_synack",
  "tcp_rst",
  "dns_query",
  "http_data",
  "udp",
  "icmp",
  "port_scan_alert",
] as const;

export type PackEventType = (typeof EVENT_TYPES)[number];

export const PACK_IDS = ["ambient", "chiptune", "orchestral", "ensemble", "axom", "punjab"] as const;

export type PackId = (typeof PACK_IDS)[number];

export interface PackFallbackSynth {
  kind: string;
  options?: Record<string, unknown>;
  transposeSemitones?: number;
}

export interface PackEventDef {
  voice: string;
  label: string;
  role: "note" | "alarm";
  sample: string | null;
  fallbackSynth: PackFallbackSynth;
}

export interface PackSampleDef {
  note: number;
  file: string;
}

export interface PackRhythmDef {
  steps: number;
  low: number[];
  high: number[];
  comment?: string;
}

export interface PackCultureDef {
  region?: string;
  tradition?: string;
  credits?: string;
  status?: "placeholder" | "community-reviewed";
  reviewedBy?: string[];
}

export interface PackFestivalDef {
  id: string;
  label: string;
  labelLocal?: string;
  // Months this festival applies to, as JS Date months (0 = January).
  // Months with no entry mean "no seasonal override".
  months: number[];
  tempoRange: [number, number];
  density: number;
  droneLevel: number;
  defaultRaga: string;
}

export interface PackDroneDef {
  rootMidi: number;
  intervalSemitones: number;
  comment?: string;
}

export interface PackDefinition {
  id: string;
  version: number;
  displayName: string;
  displayNameLocal?: string;
  tagline: string;
  culture?: PackCultureDef;
  events: Record<string, PackEventDef>;
  samples: PackSampleDef[];
  rhythm?: PackRhythmDef | null;
  drone?: PackDroneDef | null;
  festivals?: PackFestivalDef[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Pure structural validation. Returns a list of human-readable problems
// (empty = valid) so callers can surface clear error messages.
export function validatePackDefinition(expectedId: string, data: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(data)) {
    return [`pack "${expectedId}": top level must be a JSON object`];
  }
  if (data.id !== expectedId) {
    errors.push(`pack "${expectedId}": "id" is ${JSON.stringify(data.id)}, expected "${expectedId}"`);
  }
  if (typeof data.version !== "number" || data.version < 1) {
    errors.push(`pack "${expectedId}": "version" must be a number >= 1`);
  }
  if (typeof data.displayName !== "string" || data.displayName.trim() === "") {
    errors.push(`pack "${expectedId}": "displayName" must be a non-empty string`);
  }
  if (data.displayNameLocal !== undefined && (typeof data.displayNameLocal !== "string" || data.displayNameLocal.trim() === "")) {
    errors.push(`pack "${expectedId}": "displayNameLocal" must be a non-empty string when present`);
  }
  if (typeof data.tagline !== "string" || data.tagline.trim() === "") {
    errors.push(`pack "${expectedId}": "tagline" must be a non-empty string`);
  }
  if (!isRecord(data.events)) {
    errors.push(`pack "${expectedId}": "events" must be an object keyed by event type`);
  } else {
    for (const eventType of EVENT_TYPES) {
      const entry = data.events[eventType];
      if (!isRecord(entry)) {
        errors.push(`pack "${expectedId}": missing event "${eventType}"`);
        continue;
      }
      if (typeof entry.voice !== "string" || entry.voice.trim() === "") {
        errors.push(`pack "${expectedId}": event "${eventType}" needs a non-empty "voice" id`);
      }
      if (typeof entry.label !== "string" || entry.label.trim() === "") {
        errors.push(`pack "${expectedId}": event "${eventType}" needs a non-empty "label"`);
      }
      if (entry.role !== "note" && entry.role !== "alarm") {
        errors.push(`pack "${expectedId}": event "${eventType}" has invalid "role" (want "note" or "alarm")`);
      }
      if (entry.sample !== null && typeof entry.sample !== "string") {
        errors.push(`pack "${expectedId}": event "${eventType}" "sample" must be a file path or null`);
      }
      if (!isRecord(entry.fallbackSynth) || typeof entry.fallbackSynth.kind !== "string" || entry.fallbackSynth.kind.trim() === "") {
        errors.push(`pack "${expectedId}": event "${eventType}" needs "fallbackSynth.kind"`);
      }
    }
    for (const key of Object.keys(data.events)) {
      if (!(EVENT_TYPES as readonly string[]).includes(key)) {
        errors.push(`pack "${expectedId}": unknown event "${key}"`);
      }
    }
    const eventsTable: Record<string, unknown> = data.events;
    const alarms = EVENT_TYPES.filter((t) => {
      const entry: unknown = eventsTable[t];
      return isRecord(entry) && entry.role === "alarm";
    });
    if (alarms.length !== 1 || alarms[0] !== "port_scan_alert") {
      errors.push(`pack "${expectedId}": exactly "port_scan_alert" must carry role "alarm"`);
    }
  }
  if (!Array.isArray(data.samples)) {
    errors.push(`pack "${expectedId}": "samples" must be an array`);
  } else {
    data.samples.forEach((sample: unknown, index: number) => {
      if (!isRecord(sample) || !Number.isInteger(sample.note) || (sample.note as number) < 0 || (sample.note as number) > 127) {
        errors.push(`pack "${expectedId}": samples[${index}] needs an integer "note" (0-127)`);
      }
      if (!isRecord(sample) || typeof sample.file !== "string" || sample.file.trim() === "") {
        errors.push(`pack "${expectedId}": samples[${index}] needs a non-empty "file"`);
      }
    });
  }
  if (data.rhythm !== undefined && data.rhythm !== null) {
    if (!isRecord(data.rhythm)) {
      errors.push(`pack "${expectedId}": "rhythm" must be an object or null`);
    } else {
      const { steps, low, high } = data.rhythm as { steps?: unknown; low?: unknown; high?: unknown };
      if (!Number.isInteger(steps) || (steps as number) <= 0) {
        errors.push(`pack "${expectedId}": rhythm needs a positive integer "steps"`);
      } else {
        for (const [name, grid] of [["low", low], ["high", high]] as const) {
          if (!Array.isArray(grid) || grid.length !== steps || !grid.every((v) => v === 0 || v === 1)) {
            errors.push(`pack "${expectedId}": rhythm."${name}" must be ${String(steps)} steps of 0/1`);
          }
        }
      }
    }
  }
  if (data.drone !== undefined && data.drone !== null) {
    if (!isRecord(data.drone)) {
      errors.push(`pack "${expectedId}": "drone" must be an object or null`);
    } else {
      const rootMidi: unknown = data.drone.rootMidi;
      const interval: unknown = data.drone.intervalSemitones;
      if (!Number.isInteger(rootMidi) || (rootMidi as number) < 0 || (rootMidi as number) > 127) {
        errors.push(`pack "${expectedId}": drone needs an integer "rootMidi" (0-127)`);
      }
      if (!Number.isInteger(interval) || (interval as number) < -24 || (interval as number) > 24) {
        errors.push(`pack "${expectedId}": drone needs an integer "intervalSemitones" (-24..24)`);
      }
    }
  }
  if (data.culture !== undefined && data.culture !== null) {
    if (!isRecord(data.culture)) {
      errors.push(`pack "${expectedId}": "culture" must be an object or null`);
    } else {
      for (const key of ["region", "tradition", "credits"] as const) {
        const value: unknown = data.culture[key];
        if (value !== undefined && typeof value !== "string") {
          errors.push(`pack "${expectedId}": culture."${key}" must be a string when present`);
        }
      }
      const status: unknown = data.culture.status;
      if (status !== undefined && status !== "placeholder" && status !== "community-reviewed") {
        errors.push(`pack "${expectedId}": culture."status" must be "placeholder" or "community-reviewed"`);
      }
      const reviewedBy: unknown = data.culture.reviewedBy;
      if (reviewedBy !== undefined && (!Array.isArray(reviewedBy) || !reviewedBy.every((r) => typeof r === "string"))) {
        errors.push(`pack "${expectedId}": culture."reviewedBy" must be an array of strings`);
      }
    }
  }
  if (data.festivals !== undefined && data.festivals !== null) {
    if (!Array.isArray(data.festivals)) {
      errors.push(`pack "${expectedId}": "festivals" must be an array`);
    } else {
      data.festivals.forEach((festival: unknown, index: number) => {
        const where = `pack "${expectedId}": festivals[${index}]`;
        if (!isRecord(festival)) {
          errors.push(`${where} must be an object`);
          return;
        }
        if (typeof festival.id !== "string" || (festival.id as string).trim() === "") {
          errors.push(`${where} needs a non-empty "id"`);
        }
        if (typeof festival.label !== "string" || (festival.label as string).trim() === "") {
          errors.push(`${where} needs a non-empty "label"`);
        }
        if (festival.labelLocal !== undefined && (typeof festival.labelLocal !== "string" || (festival.labelLocal as string).trim() === "")) {
          errors.push(`${where} "labelLocal" must be a non-empty string when present`);
        }
        if (!Array.isArray(festival.months) || (festival.months as unknown[]).length === 0 || !(festival.months as unknown[]).every((m) => Number.isInteger(m) && (m as number) >= 0 && (m as number) <= 11)) {
          errors.push(`${where} needs a non-empty "months" array of JS months (0-11)`);
        }
        const tempoRange: unknown = festival.tempoRange;
        if (!Array.isArray(tempoRange) || tempoRange.length !== 2 || !(tempoRange as unknown[]).every((t) => typeof t === "number") || (tempoRange as number[])[0] < 40 || (tempoRange as number[])[1] > 240 || (tempoRange as number[])[0] >= (tempoRange as number[])[1]) {
          errors.push(`${where} needs "tempoRange" as [min, max] BPM (40-240, min < max)`);
        }
        for (const key of ["density", "droneLevel"] as const) {
          const value: unknown = festival[key];
          if (typeof value !== "number" || value < 0 || value > 1) {
            errors.push(`${where} needs "${key}" as a number in 0..1`);
          }
        }
        if (typeof festival.defaultRaga !== "string" || (festival.defaultRaga as string).trim() === "") {
          errors.push(`${where} needs a non-empty "defaultRaga"`);
        }
      });
    }
  }
  return errors;
}

function packUrl(id: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}packs/${id}/pack.json`;
}

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }>;

// Fetch a pack manifest over HTTP and validate it. Every failure mode gets
// an explicit message naming the pack id and the URL that was tried.
export async function loadPack(id: string, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<PackDefinition> {
  const url = packUrl(id);
  let response: Awaited<ReturnType<FetchFn>>;
  try {
    response = await fetchFn(url);
  } catch (err) {
    throw new Error(`failed to load pack "${id}": network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`pack "${id}" not found: HTTP ${response.status} at ${url}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`pack "${id}" has invalid JSON at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const problems = validatePackDefinition(id, data);
  if (problems.length > 0) {
    throw new Error(`pack "${id}" failed validation:\n - ${problems.join("\n - ")}`);
  }
  return data as PackDefinition;
}

const bundled: Record<string, PackDefinition> = {
  ambient: ambientPackJson as unknown as PackDefinition,
  axom: axomPackJson as unknown as PackDefinition,
  punjab: punjabPackJson as unknown as PackDefinition,  chiptune: chiptunePackJson as unknown as PackDefinition,
  ensemble: ensemblePackJson as unknown as PackDefinition,
  orchestral: orchestralPackJson as unknown as PackDefinition,
};

export const BUNDLED_PACKS: Record<string, PackDefinition> = bundled;

// Runtime-registered definitions (re-fetched manifests, user-added packs).
// The bundled copy is the fallback; lookups never throw.
const runtimeDefs: Record<string, PackDefinition> = {};

export function registerPackDef(def: PackDefinition): void {
  runtimeDefs[def.id] = def;
}

export function getPackDef(id: string): PackDefinition | undefined {
  return runtimeDefs[id] ?? bundled[id];
}

export function getBundledPack(id: string): PackDefinition {
  const def = bundled[id];
  if (!def) {
    throw new Error(`unknown pack "${id}" (known: ${Object.keys(bundled).join(", ")})`);
  }
  return def;
}

// Re-fetch every served manifest, validate it, and return warnings for
// anything that does not match the bundled copy. Callers decide whether to
// hot-swap (same content = no-op). Never throws: a missing/stale manifest
// must never break playback.
export async function ensurePacksFromNetwork(fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<{ loaded: PackDefinition[]; warnings: string[] }> {
  const loaded: PackDefinition[] = [];
  const warnings: string[] = [];
  for (const id of PACK_IDS) {
    try {
      const net = await loadPack(id, fetchFn);
      loaded.push(net);
      if (JSON.stringify(net) !== JSON.stringify(bundled[id])) {
        warnings.push(`pack "${id}": served manifest differs from the bundled copy`);
      }
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, warnings };
}
