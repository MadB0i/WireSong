# Axom (Bihu) pack — samples to record

No recordings ship with the repo yet: the pack plays fully through its
synthesized fallbacks today. When these recordings exist, drop them into
this directory with exactly the file names below and the player will pick
them up automatically (lazy-loaded, per-voice fallback stays for anything
still missing).

## Recording guide

- One instrument at a time, quiet room, mono.
- Leave ~50 ms of silence before each hit for clean trimming.
- Export mono MP3 (VBR ~96 kbps) or OGG Vorbis (q2). Keep each file under
  250 KB; the whole set should stay well under the 3 MB shipped-sample
  budget (estimate: 8 files x ~150 KB ≈ 1.2 MB).
- Tune to A4 = 440 Hz where the instrument allows it.

## Required files

| File | Instrument | Note to play | Duration | Notes |
|---|---|---|---|---|
| `dotora-C5.mp3` | dotora (2-string plucked lute) | C5 (523 Hz), open string | 1.5 s | single clean pluck, let it ring |
| `dotora-G5.mp3` | dotora | G5 (784 Hz), second string | 1.5 s | single clean pluck, let it ring |
| `toka.mp3` | toka (bamboo clapper) | single dry clap (unpitched) | 0.3 s | short and woody, no room echo |
| `taal.mp3` | taal (small hand cymbals) | single bright strike (unpitched) | 1.0 s | one clash, let it shimmer out |
| `baanhi-C5.mp3` | baanhi (bamboo flute) | C5, steady tone | 2.0 s | even breath, no vibrato |
| `gogona-C4.mp3` | gogona (bamboo jaw-harp reed) | C4 twang | 1.0 s | single plucked twang |
| `xutuli-G5.mp3` | xutuli (small clay whistle) | G5, soft | 1.0 s | gentle, breathy, quiet |
| `pepa-C5.mp3` | pepa (buffalo-horn reed pipe) | C5, held | 1.5 s | steady reedy tone, no phrase |

The dhol roll behind the alert is synthesized (membrane voices) and needs
no recording; the step pattern lives in `pack.json` under `rhythm`.

## Only self-recorded or CC0 samples

Do not rip audio from videos, streams, or commercial recordings. Every
file added here must be recorded by a contributor (preferred — credit in
CREDITS.md) or sourced as CC0/public-domain (record the source and license
in LICENSES.md).
