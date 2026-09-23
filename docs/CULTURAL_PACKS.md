# Cultural packs

WireSong's "Cultural packs" are folk/festival instrument packs that change
**timbre only**. The sonification mapping (pitch, velocity, duration, pan)
always comes from `capture/instruments/ambient.toml`; packs never touch it,
so switching packs mid-stream never breaks the harmony.

The engine is culture-agnostic: shared code, UI strings, and tests never
name a festival, season, or tradition. Everything cultural lives in pack
data under `player/src/packs/<id>/`. Pack ids (e.g. `axom`, `bodo`) are
registry keys — like `ambient` — and may appear in code and tests as data.

Content policy: **folk, festival, and secular classical-scale material
only. Nothing devotional, ritual, or worship-related in any pack** — code,
UI, samples, or docs.

## Shipped packs

| Pack | Kind | Status |
|---|---|---|
| Ambient, Chiptune, Orchestral, Ensemble | stock synth timbres | built-in |
| Axom (Bihu) — অসম (বিহু) | Assamese Bihu folk | placeholder |
| Bodo folk | Bwisagu dance-season folk skeleton | placeholder |

Placeholder packs show a "placeholder · awaiting community review" badge
in the picker until musicians from that tradition review them.

## File layout

```
player/src/packs/<id>/pack.json        canonical manifest (imported by the bundle)
player/src/packs/<id>/samples/         recording guide + credits/licenses (+ recordings later)
player/public/packs/<id>/              generated mirror for the runtime fetch path (committed)
```

`scripts/sync-packs.mjs` (runs via the `predev`/`prebuild` hooks) mirrors
`src/packs/` to `public/packs/`, verifying each manifest id matches its
directory. Edit the `src` copy; the `public` copy is generated.

## Manifest schema (`pack.json`)

```jsonc
{
  "id": "axom",                    // = directory name, required
  "version": 2,                    // number >= 1
  "displayName": "Axom (Bihu)",    // UI label, required
  "displayNameLocal": "অসম (বিহু)",// UI label in local script, optional
  "tagline": "Bihu folk — dotora, pepa, dhol",
  "culture": {                     // optional; marks a culture pack
    "region": "Assam, India",
    "tradition": "Bihu folk and festival music",
    "credits": "…",
    "status": "placeholder | community-reviewed",
    "reviewedBy": ["Name — what they reviewed"]
  },
  "events": {                      // exactly the 8 backend event types
    "tcp_syn": {
      "voice": "dotora",           // fallback-voice id (see registry below)
      "label": "Dotora (plucked lute)",
      "role": "note | alarm",      // exactly port_scan_alert is "alarm"
      "sample": "samples/dotora-C5.mp3",  // or null
      "fallbackSynth": { "kind": "PluckSynth", "options": {…}, "transposeSemitones": 12 }
    }
    // … tcp_synack, tcp_rst, dns_query, http_data, udp, icmp, port_scan_alert
  },
  "samples": [{ "note": 72, "file": "samples/dotora-C5.mp3" }],
  "drone": { "rootMidi": 36, "intervalSemitones": 7 },  // or null
  "rhythm": {                          // or null
    "steps": 16,
    "low": [1, 0, …],                // 16 entries of 0/1 (bass drum)
    "high": [0, 0, 1, …],            // 16 entries of 0/1 (treble drum)
    "comment": "TODO: verify with a … player"
  },
  "festivals": [                       // [] or omitted = no festival UI
    {
      "id": "bohag",
      "label": "Bohag / Rongali Bihu (spring)",
      "labelLocal": "বহাগ / ৰঙালী বিহু",   // optional
      "months": [3, 4],              // JS months (0 = January); gaps = no override
      "tempoRange": [130, 160],      // BPM, within 40-240
      "density": 1.0,                // 0..1 step-gate probability
      "droneLevel": 0.3,             // 0..1 bed weight
      "defaultRaga": "bhupali"       // raga applied with the festival
    }
  ]
}
```

Validation (`validatePackDefinition` in `player/src/audio/packs.ts`)
rejects malformed manifests with explicit messages; unknown top-level keys
are ignored for forward compatibility.

## Fallback-voice registry

`voice` ids reference builders in `player/src/audio/synth.ts`
(`VOICE_BUILDERS`). Voice ids are timbre recipes, not repertoire: to add a
new folk instrument, add a builder that approximates it with stock Tone.js
voices (pluck/filtered-noise/FM/membrane) and reference it from the pack.
Registering a manifest with an unknown voice id throws a clear error and
keeps the previous table, so a bad manifest can never silence playback.

## Samples

- Lazy-loaded per voice; each file is probed at most once per session.
- Missing files silently fall back to synthesis — packs work with zero
  recordings and pick recordings up automatically once added.
- Mono MP3 (~96 kbps) or OGG (q2); total shipped samples must stay
  **under 3 MB**.
- Only **self-recorded or CC0** files. Document every file in the pack's
  `samples/` (`README.md` recording guide, `CREDITS.md`, `LICENSES.md`).

## Adding a new culture pack

1. Copy `src/packs/bodo/` to `src/packs/<id>/` and edit the manifest
   (keep `id` == directory name). Start with `status: "placeholder"`.
2. Map the 8 events to existing fallback voices, or add new builders for
   new instruments (approximations only — no sampled audio yet).
3. Optionally add `rhythm` (mark the pattern `TODO: verify with a …
   player`), `festivals` (months others leave empty stay on pack default),
   and `drone`.
4. Write `samples/README.md` (exact file/note/duration list) plus
   `CREDITS.md`/`LICENSES.md` templates.
5. Run `npm run sync:packs`, `npm test`, `npm run build`, `npm run e2e`.
6. Open a PR; the badge clears only after `reviewedBy` names a musician
   from that tradition (`status: "community-reviewed"`).

## Related modules

- `audio/packs.ts` — manifest types, validation, fetch loader, def registry
- `audio/ragas.ts` — raga table, degree→note mapping, Raga Clock, meend
- `audio/rhythm.ts` — step-grid drum layer (pack grid + festival tempo)
- `audio/festivals.ts` — calendar lookup, auto-season, preset application
- `audio/samples.ts` — probe-once sample loading with synth fallback
- `audio/drone.ts` — Sa-Pa bed following baseline traffic
