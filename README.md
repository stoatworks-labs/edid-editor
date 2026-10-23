> **AI-assisted project.** This codebase was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author.
> The timing engine is checked against published VESA DMT values and the DisplayID Type VII layout
> against the Linux kernel's own parser. **No EDID this tool produced has ever been loaded into a
> display, a source or a processor**, and the twenty-three-model compatibility table is vendor
> paperwork, cited per claim but never tried against the hardware it describes. Mosaic mode
> reproduces another tool's Mac-tested files byte for byte, but Otter hasn't tested them itself.
> Its macOS widths are the widest other people have reported, and **nobody has shown a Mac bonding
> a tile wider than 6144**, though Otter will build one. See
> [What is verified, and what is not](#what-is-verified-and-what-is-not).

# Otter EDID Editor

**Live at [otter-edid.stoatworks-labs.com](https://otter-edid.stoatworks-labs.com)**, with nothing to install.

A browser EDID editor for event video. Build an EDID from a resolution and a
refresh rate, or edit every field by hand, then see which processors will
actually take it, and in which mode.

Nothing's uploaded. There's no backend to upload it to.

![Otter EDID Editor building an 8192 × 1080 @ 60 EDID: the raster it needed, the signal cost, and the per-processor support table](docs/screenshots/otter-edid-editor.png)

<sub>An 8192 × 1080 @ 60 EDID built in Simple mode: the CVT-RB v2 raster it needed, a 551 MHz pixel clock that puts it past HDMI 1.4, the minimum interface per standard, and the per-processor table saying which will take it. Every row comes from the vendor's own documents, and none of it has been tried against hardware.</sub>

## Three modes

**Simple.** Type a resolution and a refresh rate, name it, press Calculate. You
get a complete, valid EDID 1.4: the mode as a detailed timing, a range-limits
descriptor sized to it, the name where every input menu will read it, and a
CTA-861 extension carrying the VIC when the mode has one.

**Advanced.** Every field. Identity, video input definition, chromaticity,
established and standard timings, all four descriptors, the CTA-861 extension
(video and audio descriptors, HDMI and HDMI Forum vendor blocks, HDR static
metadata, colorimetry, 4:2:0 maps) and a DisplayID 2.0 extension.

**Mosaic.** One canvas split across two or four plugs, for frame-synced
multi-output from a Mac. You give the whole canvas, the grid (2 × 1 or 2 × 2) and
the rate; you get one EDID per plug, each carrying a DisplayID Tiled Display
Topology block. A Mac that reads matching blocks on several connectors joins them
into one display and drives them as one, so the seams can't tear. Download them
one by one or as a zip. Alongside that you get what macOS will make of the canvas, and
the cost and hardware table for the per-plug mode.

The widths it quotes are the widest anyone has reported bonding, which isn't the same as a
limit anyone has found. Before macOS 27 that's 6144 wide at 50 or 60 Hz, and 7680 at 30 Hz on
M2 to M4 Max (which chips manage it is inferred from who reported it). On macOS 27 the
reference files bonded two 6144 tiles, 12288 wide, and stopped there because the Barco E3 in
the test did, not macOS. Only 2 × 1 and 2 × 2 bond. Otter builds a tile wider than 6144 with a
warning rather than refusing it, since nobody has shown a Mac bonding one and somebody ought to
try. It also warns when a plug's clock goes past the 600 MHz that the copied range-limits
descriptor allows: 12288 × 2160 at 60 needs 840 MHz a plug, and nobody knows yet whether a Mac
minds. The same descriptor stops the line rate at 255 kHz, which two 3840 × 4320 plugs at 60 Hz
go past, so that gets a warning too.

The mosaic layout isn't Otter's invention. It reproduces, byte for byte, a
reference builder whose files have bonded on macOS 26 and 27. Its base and CTA
blocks are a real display's EDID, because EDIDs built from scratch never bonded
(macOS, it turns out, has opinions).
A test pins the match against the reference's own output. The topology id is
Stoatworks Labs' own (`SWK`). One deliberate difference: a plug taller than 4095 lines gets
its base-block fallback halved in height as well as width. The reference only halves the
width, so its tall plugs wrap the 12-bit height field (4320 comes out as 224), and none of
the files that bonded were that tall.

All three modes name the EDID, and all three show the same two answers on the right.

## The two answers

**What the mode costs, and the smallest interface that carries it.** Pixel
clock, raster, line rate and payload, and then the minimum HDMI version (1.0–1.2,
1.3/1.4, 2.0, or which FRL rate), the minimum DisplayPort rate at 4 and 2 lanes,
and whether DVI needs one link or two.

**Which hardware takes it.** Twenty-three models across Analog Way, Barco,
PixelHue, Brompton, NovaStar, disguise and Green Hippo, each answering yes /
conditional / no, and where the answer is conditional, the capacity mode you
have to configure to get it:

- A **LiveCore** dual-link input costs you the neighbouring input.
- A **Barco E2 Gen 1** does 4K60 only across two cables.
- A **Barco E2 Gen 2** quad card is four WQXGA inputs or two UHD60 ones.
- An **Aquilon DisplayPort card** is four DP 1.2 ports or two DP 1.4 ports,
  and DP 1.4 preempts ports 2 and 4.

Every device carries its sources, quoted, with the date they were read.

## DSC and variable refresh

Both are toggles, and both actually do something: they change the bandwidth arithmetic, they
change which interface version is required, and they get written into the EDID
(DSC capability and the VRRmin/VRRmax window in the HDMI Forum block). Turning
DSC on correctly makes every HDMI 2.0 and earlier input say no, because DSC
travels only over a fixed-rate link.

## Import

Open a `.bin`, or paste a hex dump from anywhere: `xrandr`, `edid-decode`,
`xxd`, a C header, a bare hex string. A bad checksum is reported, not refused:
the dump off a misbehaving device is the one you most need to look at.

## Running it

```bash
npm install
npm run dev
```

`npm test` runs the suite. `npm run build` produces `dist/`, which deploys as a
Cloudflare static-assets Worker.

## What is verified, and what is not

The timing engine is checked against published VESA DMT values, and the
DisplayID Type VII and Tiled Display Topology layouts against the Linux kernel's
parser. The hardware table is vendor paperwork, cited per claim, and has **not**
been tried against any hardware. See `AGENTS.md` for the full breakdown.

Mosaic mode is the one exception to "never on hardware", and only at second hand:
its layout is byte-identical to reference files reported bonding on macOS 26 and
27. Otter hasn't loaded its own files into a Mac. The macOS widths it quotes come
from that testing and from other people's field reports (BetterDisplay users,
PixelHue), not mine, and anything in them about particular chips is inferred.

Not affiliated with Analog Way, Barco, PixelHue, Brompton, NovaStar, disguise or
Green Hippo. Product names appear only to state compatibility.

MIT.

<!-- selfhost:start -->
## Run your own copy

Otter EDID Editor is a static page, so hosting it yourself is one container serving
the built files — the same files the hosted copy serves, running somewhere that
still works when the venue has no internet.

**Docker.** The image is built by this repo's `docker.yml` workflow on every
push and published as `ghcr.io/stoatworks-labs/otter-edid-editor`:

```bash
docker run -d --name otter-edid-editor --restart unless-stopped -p 8529:80 ghcr.io/stoatworks-labs/otter-edid-editor:latest
```

Or `docker compose up -d` with the [`docker-compose.yml`](docker-compose.yml)
in this repo, which maps the same port. Either way it is then at
`http://localhost:8529/`.

**Unraid.** Search Community Applications for *Otter EDID Editor* — the template is
[`templates/otter-edid-editor.xml`](https://github.com/stoatworks-labs/stoatworks-unraid/blob/main/templates/otter-edid-editor.xml)
in [stoatworks-unraid](https://github.com/stoatworks-labs/stoatworks-unraid), which is what the CA feed reads.

**Stoatworks Burrow** lists it under *Self-hosted*, with the compose file a
click away.

The `Dockerfile`, `docker-compose.yml`, `docker/` and the workflow are
generated from `fleet.json` in stoatworks-unraid. Change them there and
regenerate rather than editing them here.
<!-- selfhost:end -->
