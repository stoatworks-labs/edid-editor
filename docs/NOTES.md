# Notes

Working notes for this repo: status, decisions, and the traps that have actually bitten.
Migrated out of Claude Code's memory on 2026-08-24, so they are written in the first
person and dated by when each thing was learned — that date is usually the useful part.

Cross-cutting notes that are not specific to this repo live in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).

*Otter EDID Editor — browser EDID builder/editor with a cited per-model hardware support matrix; PUBLIC + LIVE as a beta, but no hardware has ever been fed one of its EDIDs*

**Otter EDID Editor** — `~/projects/video/otter-edid-editor`, React/TS/Vite static
SPA, MIT, v0.1.0, created 2026-08-20. Same shape as the browser-tool family
([blend calc](https://github.com/stoatworks-labs/blend-calc/blob/main/docs/NOTES.md) (`blend-calc`), [aspect calc](https://github.com/stoatworks-labs/aspect-calc/blob/main/docs/NOTES.md) (`aspect-calc`), [test card](https://github.com/stoatworks-labs/test-card/blob/main/docs/NOTES.md) (`test-card`)):
no backend, Cloudflare static-assets Worker, `otter.stoatworks-labs.com` in
`wrangler.toml`. **PUBLIC and LIVE since 2026-08-20**: `github.com/stoatworks-labs/otter-edid-editor`
(MIT, branch `main`) and **https://otter-edid.stoatworks-labs.com** — a
static-assets Worker with the custom domain declared in `wrangler.toml`, so a
fresh deploy cannot come up without the hostname. Listed on the website as a
**beta** on `/software/otter-edid-editor` and `/web-tools` (position 08, Video
group).

Named by Allan mid-build (was `edid-forge` for about an hour — any pre-rename
path is dead).

**Two modes + two answers.** Simple mode: resolution + rate + name → a whole
EDID 1.4. Advanced mode: every field, incl. CTA-861 and DisplayID 2.0. Right
column always shows (a) the minimum HDMI/DP/DVI version the mode needs and
(b) a per-model support matrix, 21 devices, Analog Way / Barco / PixelHue /
Brompton / NovaStar / disguise / Green Hippo.

**Containerised 2026-08-20**: `fleet.json` `static-build` + `unraid.json`
`hostPort` **8529**, public, in [stoatworks unraid](https://github.com/stoatworks-labs/stoatworks-unraid/blob/main/docs/NOTES.md) (`stoatworks-unraid`). Image
`ghcr.io/stoatworks-labs/otter-edid-editor` built green and verified
**anonymously pullable** (token + manifest GET — a green Actions run does not
prove it). linux/amd64, matching the rest of the fleet. CA template live at
`templates/otter-edid-editor.xml`. The generated Dockerfile runs `nginx -t`
during the build, which is the only syntax check these configs get
([no container runtime](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_no_container_runtime.md)).

**Carries the shared support footer** ([support footer](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_support_footer.md)) with
`data-repo` set, so it links its own GitHub source — which the five sibling
browser tools still do not.

**`scripts/serve-dist.py` was missing for the repo's first day.** package.json
referenced `npm run serve:dist` from the first commit because the script block
was copied from blend-calc, but the file was never brought across — so the one
way to check the CSP locally could not run. Copied in 2026-08-20. Worth checking
in any repo scaffolded the same way.

**Dependabot: all three toggles ON since 2026-08-20** — `vulnerability-alerts`,
`automated-security-fixes`, and `.github/dependabot.yml` copied verbatim from
blend-calc rather than reinvented. See [dependabot fleet config](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_dependabot_fleet_config.md).

**"Beta" on this site is carried in the tool's NAME, not its status.**
`projects.json.statuses` has no `beta` tier, and an undeclared id falls through
to the raw lowercase string with no `.status-*` colour. So: `status: "building"`
plus `"name": "Otter EDID Editor (beta)"` / `"navLabel": "Otter EDID (beta)"` in
`webtools.json`, which is how the PLAY Flasher does it. ⚠️ **`burin` really does
carry `status: "beta"` and therefore renders unstyled** — a latent bug, not a
precedent to copy.

**The features Allan added mid-build, in order:** required HDMI/DP version
readout; DSC and VRR as toggles that feed BOTH the bandwidth maths and the
emitted EDID; the Aquilon DP 1.4 port-preemption warning
([aquilon dp14 port preemption](https://github.com/stoatworks-labs/fleet-notes/blob/main/notes/reference_aquilon_dp14_port_preemption.md)).

**Three things that cost real time and are pinned by tests:**

- **CVT standard blanking must use the ESTIMATED line period throughout.**
  Recomputing it against the settled vertical total is the obvious-looking
  improvement and moves the clock off every published DMT value (1680x1050@60
  came out 146.75 instead of 146.25). The estimate IS the definition.
- **A DTD's limits are NOT just the 655.35 MHz clock.** Active and blanking are
  12-bit fields, porches 10- and 6-bit. `8192x1080@60` has an unremarkable
  551 MHz clock and still cannot be a DTD — and Analog Way advertise exactly
  that format on the Aquilon input cards. `dtdLimit()` checks every field and
  routes such modes to DisplayID Type VII. Found by a test, not by inspection.
- **Device capacity-mode inheritance must be an explicit `inheritsFrom` id.**
  Matching on `family` handed the Barco EX chassis the E2 *Gen 1* dual-cable
  answer and stated it as fact; EX takes either generation. No modes + no
  pointer now reports `unknown`.

**DisplayID 2.0 Type VII layout was verified byte-for-byte against the Linux
kernel**, not written from spec prose: `drm_displayid_internal.h` (structs +
`DATA_BLOCK_2_*` tags; Type VII = 0x22, Interface Features = 0x26) and
`drm_mode_displayid_detailed()` in `drm_edid.c`. **Every count is stored
minus one** — an off-by-one there looks like a bad cable, not a bad EDID.
git.linuxtv.org and gitlab.freedesktop.org are both behind Anubis and refuse
WebFetch; raw.githubusercontent.com + `gh api` worked.

**The honest gap: no EDID this tool produces has ever been fed to hardware,**
and the whole capability table is vendor paperwork. `devices.ts` carries a
`Confidence` of documented / inferred / unverified plus mandatory citations
(a test fails the build if a `documented` row has none). PDS-902 is a deliberate
`unverified` placeholder with no citation. README and AGENTS.md say all of this
plainly; don't let a later pass quietly upgrade it.

Primary local sources: `~/Downloads/livecore-unit-user-manual-uk.pdf` and
`~/Downloads/user-manual-pulse2.pdf` (`pdftotext -layout`). LiveCore = 165 MHz
single-link / 330 MHz dual; **that cap applies to its HDMI plug too**, not the
340 MHz HDMI 1.4 allows — using the spec limit made the tool claim a NeXtage
takes 2560x1600.

**Two JSON files next door use OPPOSITE escaping conventions**, and a
`json.dumps` with the wrong one rewrites untouched lines: `scripts/shots.json`
stores `\u2014` escapes (`ensure_ascii=True`), `src/data/webtools.json` and
`src/data/projects.json` store literal UTF-8 (`ensure_ascii=False`). Check
before rewriting either, and confirm with `git diff --numstat` that the change
is insertions-only.

**`make_screens.py` also produced four heroes nobody had ever committed** —
abomerration, burin, tilter, vectrix each had a `shots.json` entry and no image,
so their pages had been falling back to the branded thumbnail. Committed
separately. Expect more of these; the run is the only thing that surfaces them.

**A brand-new asset 404s at the Worker origin for ~30 seconds after deploy.**
Both the new thumbnail and hero returned the 404 page immediately after
`wrangler deploy` and were 200 on a retry twenty seconds later. Do not go
hunting for a missing-file bug — retry first. (This is *not* the zone-cache
trap from [stoatworks website](https://github.com/stoatworks-labs/stoatworks-website/blob/main/docs/NOTES.md) (`stoatworks-website`); it happens on the workers.dev origin.)

Sibling: [openrcs](https://github.com/stoatworks-labs/openrcs/blob/main/docs/NOTES.md) (`openrcs`) has a device-side EDID *writer* (pushes EDID to AW
input plugs). Different thing; this is a standalone editor.

**Mosaic mode landed 2026-09-23** — Allan asked for multi-plug tiled EDIDs so a Mac's
outputs are frame synced, and pointed at a reference tiled-EDID builder Allan supplied (not
named here by request). `src/lib/mosaic.ts` is **byte-identical** to it, pinned by
fixtures generated by running the reference under node with Otter's id. What its
source says it learned on the bench, and what this mode repeats:

- **Only its reference base+CTA bonded.** A PixelHue Q8 EDID, patched in six places.
  The reference's first version synthesised base+CTA and no Mac ever bonded on those files. So
  nothing in the reference is tidied, and Otter's own encoder never touches a tile —
  its CTA encoder reordered data blocks, so a decode/encode of that block changed 88
  bytes (found while checking the round-trip, not by inspection; fixed the same
  day — see below — but the bypass stays).
- **DisplayID 1.3, not 2.0.** Section version 0x12, a Type I timing (tag 0x03, 10 kHz
  clock) then Tiled Display (tag 0x12), section length declared as the full 121 with
  zero padding. Otter's decoder now keeps that declared length (`sectionLength`) —
  without it a round-trip shortened the section and moved three bytes.
- **macOS limits:** a bonded canvas is up to 6144 wide on macOS 26, up to 12288 on 27
  (12288 is also the E3's DisplayID ceiling, so 27's real limit is unknown). Only
  2 x 1 and 2 x 2 bond; 3- and 4-wide never. 2 x 2 fed by an **Encore 3 on 10.3**
  drops connector hotplug (Barco "Defect 1"). *Re-read against field reports on
  2026-10-20, below: 6144 is the 50/60 Hz figure, not a hard cap.*
- **The macOS 27 release notes say nothing about any of this.** The only related entry
  is a fix for two identical displays (same model and serial) where the second stayed
  dark. Apple's release-notes pages are JS-rendered; `developer.apple.com/tutorials/data/
  documentation/macos-release-notes/<page>.json` is the readable form.
- Tiled block layout checked against `drm_parse_tiled_block` (kernel), including the
  high count/location bits in byte 3 — which the reference leaves at zero, fine below 16.
- **Topology id is Stoatworks' own: `SWK`, product 0x4F54.** SWK is unassigned in the
  UEFI PNP registry (`uefi.org/uefi-pnp-export`, a CSV). The reference used ATV — which
  the registry assigns to Office Depot. Untested whether the Mac cares.

Still true: **Otter has not loaded any of these into a Mac itself.**

**A decoded CTA block saves back byte for byte since 2026-09-23.** The Q8 block broke
the encoder two ways: its data blocks run video, audio, HDMI Forum VSDB, HDMI VSDB,
video capability (the encoder puts HDMI before Forum and capability mid-list), and its
HDMI Forum VSDB is 7 bytes where the encoder always writes the optional 8th (the
ALLM/VRR flags byte). Either one moves the DTD offset, so every byte after it shifts.
The fix records each block's key, bytes and a canonical (sorted-key) serialisation of
the fields it decoded into, in `CtaExtension.source`; the encoder emits a block's
original bytes while its fields still serialise the same. The UI edits by spreading,
which is why the comparison ignores key order. All 12 mosaic fixture tiles (384 bytes,
base + CTA + DisplayID 1.3) failed a whole-EDID round-trip before this and pass after.
Still lossy on purpose: **editing** a block re-encodes it from the model, so bytes the
model does not carry (HDMI VSDB latency fields, reserved bits) go with that edit.
Also seen: the reference's base block claims two extensions (byte 126) for a 256-byte
blob, because mosaic appends the third; the encoder writes the count it has.

**Mosaic widths re-read against field reports, 2026-10-20.** Someone asked through the
feedback button whether an M5 could do 2 × 8192 × 2160 (stoatworks-triage#6), and Otter
refused any tile over 6144. The research turned up more than the reference had:

- **6144 is the 50/60 Hz figure before macOS 27.** BetterDisplay discussion #713 has
  7680 × 4320 @30 (two 3840 × 4320 tiles) bonding on an M2 Max (2023-10) and an M4 Max
  (2025-08), while 2 × 3840 × 2160 @60 did not; PixelHue's Mac Mosaic notes say 7680
  works "on M2 and above". The chip list is inferred from who reported it. Monterey
  bonded 7680 × 2304 @60 on an M1 Max and Ventura cut it to 6144.
- **12288 on macOS 27 was the Barco E3's ceiling, not macOS's.** Nobody has reported a
  bonded canvas wider than that, or a bonded tile wider than 6144, on any Mac.
- **Inferred, from third-party reads of M4 and M5 display firmware** (smcleod.net,
  BetterDisplay #2174): one display pipe is at most 7680 wide (`MaxSrcRectWidthForPipe`)
  and the source buffer 16384. An 8192 tile would need two pipes joined, as 8K does.
- So `mosaicErrors` no longer refuses a wide tile. `checkMosaic` warns ("Nobody has
  shown a Mac bonding tiles 8192 wide") and a canvas past 12288 is a caveat, not a "no".
- **New: a tile-clock warning.** The copied range-limits descriptor (`fd 00 17 f0 0f ff
  3c`) says 600 MHz at most, and Otter had been building 12288 × 2160 @60 (840.45 MHz a
  tile) and 2 × 8192 × 2160 @60 (1113.49) without a word. It warns past 600 now. The
  descriptor stays byte-identical, and the reference fixtures still pin it.
  2 × 8192 × 2160 @30 is 548.98 MHz, under the line.
- **Not checked:** the same descriptor's 255 kHz line-rate ceiling, which a 2160-tall
  tile passes at about 115 Hz.
- **Found, not fixed:** a 2 × 1 with tiles taller than 4095 (7680 × 4320 as 2 × 1, the
  layout in the 30 Hz reports) writes the base block's stand-in DTD with its 12-bit
  height wrapped, so it decodes as 3840 × 224. The stand-in is only ever halved for
  width. The DisplayID Type I timing, which is what a Mac bonds on, is right.

LivePremier Plus vendors the embed build, so a change here goes there too: `npm run
build:embed`, commit `dist-embed/`, then its `npm run sync:otter-edid`.
