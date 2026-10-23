# AGENTS.md — Otter EDID Editor

Onboarding for LLM agents and newcomers.

## What this is

A static browser SPA (React/TS/Vite, no backend) that builds, edits and checks
EDIDs, and reports which event-video processors will accept a given mode. Same
shape as the fleet's other browser tools — see `blend-calc`, `aspect-calc`,
`test-card`.

## Layout

```
src/lib/timing/    the timing engine — no EDID knowledge at all
  types.ts         Timing, and the derivations (totals, rates) that must
                   never be stored alongside it
  cvt.ts           CVT 1.1, CVT-RB v1, CVT 1.2 RB v2
  gtf.ts           GTF 1.1
  dmt.ts           curated VESA DMT table, transcribed from published values
  cta.ts           curated CTA-861 VIC table
src/lib/edid/      the codec — no UI, no capability knowledge
  types.ts         the model: every field in the unit a person thinks in
  tables.ts        ORDER-CRITICAL positional bit tables. Append only.
  encode.ts        model -> bytes, plus dtdLimit()
  decode.ts        bytes -> model, never throws
  decode-dtd.ts    split out to break an encode/cta861 import cycle
  cta861.ts        CTA-861 extension
  displayid.ts     DisplayID 1.3 and 2.0 extension, incl. Tiled Display Topology
src/lib/link.ts    bandwidth: what a mode costs, what carries it
src/lib/capability/
  types.ts         the device schema, including Confidence
  devices.ts       THE DATA. Citations are mandatory; see the rules in-file.
  evaluate.ts      the support matrix engine
src/lib/build.ts   simple mode: resolution + rate -> a whole EDID
src/lib/mosaic.ts  mosaic mode: canvas + grid -> one tiled EDID per plug,
                   a reference builder's bytes exactly (see below)
src/lib/zip.ts     stored zip for the mosaic download
src/components/    UI only. No arithmetic lives here.
```

## Load-bearing invariants

- **`tables.ts` is positional.** Every entry's index IS its bit position.
  Inserting anywhere but the end silently rewrites the meaning of existing
  EDIDs. Append only.
- **`vFreq()` is the FIELD rate for interlaced modes**, not the frame rate.
  `frameRate()` is the other one. Conflating them silently halves or doubles
  every bandwidth number downstream.
- **A DTD's limits are not just the clock.** `dtdLimit()` checks the 12-bit
  active/blanking fields and the 10- and 6-bit porch fields too. 8192x1080 @60
  has an unremarkable 551 MHz clock and still cannot be a DTD. This was a real
  bug, caught by a test, and Analog Way advertise exactly that format.
- **DisplayID Type VII stores every count minus one.** An off-by-one here
  shifts the picture and moves the clock by a few kHz — it looks like a bad
  cable, not a bad EDID.
- **The native flag does not exist above VIC 64**, where bit 7 is part of the
  code. Setting it turns VIC 97 into VIC 225.
- **CVT standard blanking uses the ESTIMATED line period throughout.**
  Recomputing it against the settled vertical total looks like an obvious
  improvement and moves the clock off every published DMT value. It is the
  definition, not an approximation of one.
- **Devices inherit capacity modes only via an explicit `inheritsFrom` id.**
  An earlier version matched on `family`, which handed the Barco EX chassis the
  Gen 1 dual-cable answer and stated it as fact. A device with neither modes nor
  a pointer reports `unknown`, which is the honest answer.
- **Nothing in `devices.ts` may claim `documented` without a citation.** A test
  enforces it.
- **Mosaic bytes copy a reference builder, and must stay byte-identical.** The base and
  CTA blocks are a real display's EDID verbatim; EDIDs synthesised from scratch
  never bonded on a Mac, and nobody knows which reference bytes matter. Do not
  "clean up" `mosaic.ts`, do not swap its timing for `cvt.ts`, and never pass a
  tile through `encodeEdid` — the tiles now survive a decode/encode, but the claim
  rests on the reference's bytes, not on the encoder. `mosaic.test.ts` compares
  against the reference's own output. The one departure: a tile taller than 4095
  gets its base-block stand-in halved in height as well as width. The reference
  halves only the width, so its tall tiles wrap the DTD's 12-bit height (4320
  lands as 224); none of its cases is that tall.
- **DisplayID tag numbers depend on the section version.** 1.3 (`0x12`): Type I
  timing `0x03`, tiled `0x12`. 2.0 (`0x20`): Type VII `0x22`, tiled `0x28`. Type I
  clocks are 10 kHz units, Type VII 1 kHz. A section may declare more bytes than
  its blocks use; `sectionLength` keeps that so a decode/encode does not shorten it.
- **A decoded CTA block remembers its own layout (`CtaExtension.source`).** Real
  EDIDs order data blocks their own way and carry bytes the model drops (a 7-byte
  HDMI Forum VSDB, reserved bits). While a block's fields serialise as they did at
  decode, its original bytes go back out in its original slot; an edited block is
  re-encoded in that slot; an unedited extension is written back whole. Anything
  that builds a CTA block from scratch has no `source` and gets the encoder's order.

## Verified vs assumed

**Verified against an independent reference:**

- CVT, CVT-RB v1 and GTF reproduce published VESA DMT entries exactly
  (1920x1200 @60 = 193.25 MHz on 2592x1245; RB = 154.00 on 2080x1235;
  1680x1050 @60 = 146.25 on 2240x1089). The DMT table was transcribed
  separately, so this is not circular.
- The DisplayID 2.0 section header, data block header, block tags and the Type
  VII descriptor layout are byte-for-byte from the Linux kernel
  (`drivers/gpu/drm/drm_displayid_internal.h` and
  `drm_mode_displayid_detailed` in `drm_edid.c`), read 2026-08-20.
- The Tiled Display Topology layout, including the high location/count bits in
  byte 3, against `drm_parse_tiled_block` (read 2026-09-23).
- Mosaic output is byte-identical to the reference builder's across five
  cases (2 x 1 and 2 x 2, 3840-12288 wide, 8- and 10-bit, fractional rate).
- Every EDID the tool builds round-trips encode -> decode with no loss and a
  valid checksum. A real one read in (the PixelHue Q8 CTA block, every mosaic
  fixture tile) saves back byte for byte when not edited. 129 tests.

**Assumed, and NOT verified:**

- **No EDID produced by this tool has been fed to any hardware.** Not one. The
  bytes are well-formed and self-consistent; whether a given box likes them is
  untested. Mosaic mode is second-hand evidence only: identical bytes bonded on
  macOS 26 and 27 in the reference's testing, per its source comments (with a
  different topology id — Otter's is SWK/0x4F54). The macOS widths are the
  widest reported, not limits found, and none of them is ours: 6144 at 50/60 Hz
  before macOS 27 (the reference on 26, BetterDisplay users since Ventura);
  7680 at 30 Hz on M2 to M4 Max (BetterDisplay users, PixelHue; the chip list
  is inferred from who reported it); 12288 on 27, where the Barco E3 stopped,
  not macOS. Only 2 x 1 and 2 x 2 bond. Nobody has shown a tile wider than 6144
  bonding, so one builds with a warning, not an error. Whether a Mac minds a
  tile past the copied range limits (600 MHz, 255 kHz line rate) is untested.
- **CVT-RB v2 parameters** (80-px blanking, 8-line vsync, 1 kHz clock step) are
  from the CVT 1.2 description, not checked against a reference implementation
  the way v1 was. The relative ordering (v2 < v1 < standard) is tested; the
  absolute values are not independently confirmed.
- **The HDMI Forum VSDB bit assignments** follow `edid-decode`'s reading of
  HDMI 2.1. Round-trip is tested; the mapping to real HDMI 2.1 semantics is not.
- **The whole hardware table is paperwork.** Vendor manuals and spec sheets,
  cited per claim with a read date. Several rows are marked `inferred` (a limit
  that follows from a documented one) or `unverified` (PDS-902 — a placeholder
  with no citation at all, and the UI says so).
- **DisplayPort capacity is the raw link budget after line coding.** Real
  capacity is a little lower because of per-line transfer-unit overhead. The UI
  flags anything above 98% as marginal. HDMI TMDS is a clock ceiling and is
  exact.

## Sources on this machine

`~/Downloads/livecore-unit-user-manual-uk.pdf` and
`~/Downloads/user-manual-pulse2.pdf` are the primary sources for the LiveCore
and previous-generation Midra rows. `pdftotext -layout` reads both.

## Verifying

```bash
npm test
npm run build
```

The dev server is registered in `~/.claude/launch.json` as `otter-edid-editor`
on port 5199.

LivePremier Plus vendors the editor from `dist-embed/otter-edid-embed.js`, which
is committed here. After a change under `src/`, run `npm run build:embed` and
commit `dist-embed/` with it, then `npm run sync:otter-edid -- <this checkout>`
in livepremier-plus.

## Notes

`docs/NOTES.md` carries this repo's working notes — current status, decisions
already made, and the traps that have actually bitten. Read it before changing
anything non-obvious. Cross-cutting fleet knowledge lives in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).
