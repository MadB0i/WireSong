# Bodo folk pack — status: skeleton / unverified

This pack is a proof-of-generality skeleton: it shows that festival
calendars, folk instrument voices, and season auto-selection all come from
pack data, not from shared code. The synthesis fallbacks work today; no
recordings are bundled.

## Unverified instrument list

The mapping below reflects a first reading, not field knowledge, and must
be reviewed by Bodo musicians before this pack loses its "placeholder"
badge:

| Event | Voice | Basis for the guess |
|---|---|---|
| `tcp_syn` / `udp` | kham (drum) | dance-season pulse |
| `tcp_synack` | kham, high head | answering drum |
| `tcp_rst` | jotha (small cymbals) | short, quiet tick |
| `dns_query` / `icmp` | siphung (flute) | breathy single notes |
| `http_data` | serja (bowed lute) | sustain follows payload size |
| `port_scan_alert` | serja phrase + kham roll | loudest in the mix |

If you play these instruments: the pattern, tunings, festival calendar
(`bwisagu` in `pack.json`), and local-script labels are all open for
correction — please open an issue or PR.

## Samples

None yet. When recordings exist, document them here the way the Axom
pack's `samples/README.md` does (file, note, duration) and add matching
`sample` entries to the manifest. Only self-recorded or CC0 files.
