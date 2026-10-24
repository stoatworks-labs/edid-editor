import type { Timing } from './timing/types.ts'
import { hFreq } from './timing/types.ts'
import { checksum } from './edid/encode.ts'
import { encodeTiledTopology, encodeType1Timing } from './edid/displayid.ts'

/**
 * Mosaic mode: one canvas split across several connectors, one EDID per plug,
 * each carrying a DisplayID Tiled Display Topology block so the source treats
 * the plugs as ONE display. On a Mac that is what makes the outputs frame
 * synced — macOS bonds the tiles into a single display and scans them out as
 * one, so the seams cannot tear.
 *
 * This reproduces a reference tiled-EDID builder BYTE FOR BYTE — a test pins
 * it against that builder's own output. The point of copying rather than
 * composing from the editor's own encoder is that the reference's files have
 * bonded on real Macs (macOS 26 and 27) and synthetic ones did not:
 *
 *   The base and CTA blocks are a PixelHue Q8's EDID verbatim, patched only
 *   where a tile must differ (vendor, product, bit depth, preferred DTD,
 *   name). The reference's first version synthesised them from scratch — the
 *   DisplayID block matched the reference exactly, base+CTA did not — and no
 *   Mac was ever seen bonding on those files.
 *
 * Nobody isolated WHICH reference bytes matter, so none of them are "tidied".
 * The editor's own CTA encoder does not reproduce this CTA block byte for byte,
 * which is why a mosaic is carried as raw bytes and never re-encoded.
 *
 * Layout, 384 bytes per tile:
 *   block 0  EDID 1.4 base — a DTD at a representable size (the tile, each
 *            axis halved until it fits 4095), the monitor name, the reference
 *            range limits (23-240 Hz, 15-255 kHz, up to 600 MHz)
 *   block 1  the reference CTA-861 extension, untouched
 *   block 2  DisplayID 1.3: a Type I timing (the real tile mode, preferred)
 *            and the Tiled Display Topology block
 */

// Base + CTA of the Mac-bonding reference, verbatim.
const REFERENCE_B64 =
  'AP///////wA59l7kAQEBAQIfAQTFAAB4GjExpVVOoSYMUFQlTwDRwLMAlQCBgIFAgcABAQEBTdAAoPBwPoAwIDUAX1khAAAYAAAA/QAX8A//PAAKICAgICAgAAAA/ABsZWZ0CiAgICAgICAgAAAAEQAAAAAAAAAAAAAAAAAAAnICAyV0SWtakB8iZmVkYyMPBwdn2F3EAXiAAGcDDAAAADhE4gBPKGgAoPBwPoAwIDUAX1khAAAY72gAoKBALmAwIDYA4A4RAAAYNTyAoHCwI0AwIDYA4A4RAAAYAjqAGHE4LUBYLEUA4A4RAAAYAAAAAAAAAAAAAAAAAAAAAAAA9A=='

let reference: Uint8Array | null = null
const ref = () => (reference ??= Uint8Array.from(atob(REFERENCE_B64), (c) => c.charCodeAt(0)))

/**
 * The widest anyone has reported bonding, from the reference's bench testing
 * and other people's field reports (read 2026-10-20). Not the editor's own tests,
 * and on macOS 27 nobody has found the edge yet.
 *
 *   6144   the widest canvas reported at 50 or 60 Hz before macOS 27: the
 *          reference on macOS 26, BetterDisplay users since Ventura.
 *   7680   at 30 Hz, before macOS 27: two 3840 x 4320 tiles, reported on M2
 *          Max and M4 Max (BetterDisplay #713) and by PixelHue ("M2 and
 *          above"). That it takes one of those chips is inferred from who
 *          reported it.
 *   12288  on macOS 27, two 6144 tiles, in the reference's testing. That was
 *          the Barco E3's DisplayID ceiling, not macOS's; nobody has tried
 *          wider.
 *   6144   is also the widest TILE reported bonding. Wider builds, with a
 *          warning, so someone can try it.
 */
export const MAC_ANY_VERSION_MAX_WIDTH = 6144
export const MAC_30HZ_MAX_WIDTH = 7680
export const MAC_27_MAX_WIDTH = 12288
export const MAX_TILE_WIDTH = 6144
/** Inferred from third-party reads of M4 and M5 display firmware
 *  (MaxSrcRectWidthForPipe): one display pipe scans out at most 7680 wide. */
export const PIPE_MAX_WIDTH = 7680
/** The copied range-limits descriptor (base block, bytes 72-89) allows 600
 *  MHz at most: byte 81 is 0x3c, in 10 MHz steps. A test pins this to the
 *  bytes. The descriptor itself is never edited. */
export const RANGE_LIMIT_MAX_MHZ = 600
/** The same descriptor's line-rate ceiling: byte 80 is 0xff, in kHz. */
export const RANGE_LIMIT_MAX_KHZ = 255

export const MOSAIC_GRIDS = [
  { cols: 2, rows: 1, label: '2 × 1 — side by side' },
  { cols: 2, rows: 2, label: '2 × 2' },
] as const

export interface MosaicRequest {
  /** The whole canvas. */
  width: number
  height: number
  cols: number
  rows: number
  refreshHz: number
  /** Monitor name, the same on every tile — the Mac sees one display. */
  name: string
  bitDepth: 8 | 10
  /** Three-letter PNP id. Lands in the base block AND the topology id. */
  vendor: string
  product: number
  /** Middle byte of the topology id's serial. Two mosaics on one Mac need two
   *  numbers: a host groups tiles by that id. */
  group: number
}

export const DEFAULT_MOSAIC: MosaicRequest = {
  width: 6144,
  height: 2160,
  cols: 2,
  rows: 1,
  refreshHz: 60,
  name: 'Mosaic',
  bitDepth: 10,
  // Stoatworks Labs. SWK is unassigned in the UEFI PNP registry (checked
  // 2026-09-23); 0x4F54 is "OT", for Otter, the editor's first name, kept so that the rename
  // (2026-10-24) changed no bytes. The bonded reference files carried
  // a different id — nothing suggests the Mac cares which, but this one is
  // untested.
  vendor: 'SWK',
  product: 0x4f54,
  group: 1,
}

/**
 * The reference's timing: fixed 160-pixel horizontal blanking (48/32/80), VFP 3,
 * VSync 10, and at least 460 µs of vertical blanking. Close to CVT-RB but NOT
 * CVT-RB, and deliberately not swapped for the editor's CVT engine: these are the
 * timings the bonded files carried. The clock is rounded to 10 kHz, the unit
 * both descriptors store.
 */
export interface MosaicTiming {
  hActive: number
  hBlank: number
  hFront: number
  hSync: number
  vActive: number
  vBlank: number
  vFront: number
  vSync: number
  /** In MHz, unrounded. */
  pixelClockMHz: number
}

export function mosaicTiming(w: number, h: number, hz: number): MosaicTiming {
  const hBlank = 160
  const hFront = 48
  const hSync = 32
  const hTotal = w + hBlank
  const vFront = 3
  const vSync = 10
  const vTotalMin = h + vFront + vSync + 6
  let vTotal = vTotalMin
  // The blanking needed depends on the line time, which depends on the clock,
  // which depends on the blanking — four passes settles it.
  for (let i = 0; i < 4; i++) {
    const lineUs = (hTotal / (hTotal * vTotal * hz)) * 1e6
    vTotal = Math.max(vTotalMin, h + Math.ceil(460 / lineUs))
  }
  return {
    hActive: w,
    hBlank,
    hFront,
    hSync,
    vActive: h,
    vBlank: vTotal - h,
    vFront,
    vSync,
    pixelClockMHz: (hTotal * vTotal * hz) / 1e6,
  }
}

/** As the tile's EDID states it: 10 kHz clock, H sync positive, V negative. */
export function toTiming(m: MosaicTiming): Timing {
  return {
    hActive: m.hActive,
    hFront: m.hFront,
    hSync: m.hSync,
    hBack: m.hBlank - m.hFront - m.hSync,
    vActive: m.vActive,
    vFront: m.vFront,
    vSync: m.vSync,
    vBack: m.vBlank - m.vFront - m.vSync,
    pixelClockHz: Math.round(m.pixelClockMHz * 100) * 10_000,
    interlaced: false,
    hSyncPositive: true,
    vSyncPositive: false,
  }
}

function pnpBytes(pnp: string): [number, number] {
  const c = (i: number) => (pnp.charCodeAt(i) - 64) & 0x1f
  const v = (c(0) << 10) | (c(1) << 5) | c(2)
  return [(v >> 8) & 0xff, v & 0xff]
}

function baseDtd(m: MosaicTiming): number[] {
  const clk = Math.round(m.pixelClockMHz * 100)
  if (clk > 0xffff) throw new Error(`the base block's stand-in mode needs ${(clk / 100).toFixed(2)} MHz — past the 655.35 MHz a DTD can state`)
  // The active and blanking fields are 12 bits, and past that the top bits wrap
  // rather than fail. buildMosaic halves the stand-in to fit; this is the backstop.
  if (Math.max(m.hActive, m.hBlank, m.vActive, m.vBlank) > 4095) throw new Error(`the base block's stand-in mode, ${m.hActive} x ${m.vActive}, does not fit a DTD's 12-bit fields`)
  const b = new Array(18).fill(0)
  b[0] = clk & 0xff
  b[1] = (clk >> 8) & 0xff
  b[2] = m.hActive & 0xff
  b[3] = m.hBlank & 0xff
  b[4] = ((m.hActive >> 8) << 4) | (m.hBlank >> 8)
  b[5] = m.vActive & 0xff
  b[6] = m.vBlank & 0xff
  b[7] = ((m.vActive >> 8) << 4) | (m.vBlank >> 8)
  b[8] = m.hFront & 0xff
  b[9] = m.hSync & 0xff
  b[10] = ((m.vFront & 0x0f) << 4) | (m.vSync & 0x0f)
  b[11] = ((m.hFront >> 8) << 6) | ((m.hSync >> 8) << 4) | ((m.vFront >> 4) << 2) | (m.vSync >> 4)
  // The reference display's 607 x 345 mm. Both Mac-bonding references carry a
  // real size; 0 x 0 is legal but abnormal.
  b[12] = 0x5f
  b[13] = 0x59
  b[14] = 0x21
  b[17] = 0x1e
  return b
}

function nameDescriptor(s: string): number[] {
  const b = new Array(18).fill(0)
  b[3] = 0xfc
  let t = s.slice(0, 13)
  if (t.length < 13) t += '\n'
  t = t.padEnd(13, ' ')
  for (let i = 0; i < 13; i++) b[5 + i] = t.charCodeAt(i) & 0x7f
  return b
}

export interface MosaicTile {
  col: number
  row: number
  /** left.bin / right.bin for 2 x 1, tile_r1_c1.bin otherwise — the reference's names. */
  file: string
  label: string
  bytes: Uint8Array
}

export interface MosaicResult {
  tileWidth: number
  tileHeight: number
  /** The mode each plug carries. */
  tileTiming: Timing
  /** The smaller stand-in in the base block, for hosts that never read DisplayID. */
  baseTiming: Timing
  tiles: MosaicTile[]
}

export function tileLabel(cols: number, rows: number, col: number, row: number): string {
  if (cols === 2 && rows === 1) return col === 0 ? 'left' : 'right'
  return `r${row + 1}c${col + 1}`
}

export function tileFile(cols: number, rows: number, col: number, row: number): string {
  if (cols === 2 && rows === 1) return col === 0 ? 'left.bin' : 'right.bin'
  return `tile_r${row + 1}_c${col + 1}.bin`
}

/** Errors that make the set unbuildable — as opposed to checkMosaic's advice. */
export function mosaicErrors(r: MosaicRequest): string[] {
  const out: string[] = []
  if (!(r.width > 0 && r.height > 0 && r.refreshHz > 0)) out.push('Width, height and rate must all be above zero.')
  if (!(r.cols >= 1 && r.rows >= 1)) out.push('The grid needs at least one column and one row.')
  if (out.length) return out
  if (r.width % r.cols) out.push(`${r.width} does not divide into ${r.cols} equal columns.`)
  if (r.height % r.rows) out.push(`${r.height} does not divide into ${r.rows} equal rows.`)
  if (r.width % 8) out.push(`The canvas width must be a multiple of 8 — ${r.width} is not.`)
  // A tile wider than MAX_TILE_WIDTH is checkMosaic's warning, not an error:
  // nobody has shown one bonding, and nobody has shown one failing either.
  if (r.cols > 16 || r.rows > 16) out.push('More than 16 tiles on an axis needs the high location bits, which this layout leaves at zero.')
  if (!/^[A-Z]{3}$/.test(r.vendor)) out.push('The vendor id is three capital letters, A-Z.')
  if (!(r.product >= 0 && r.product <= 0xffff)) out.push('The product code is 0-65535.')
  if (!(r.group >= 0 && r.group <= 255)) out.push('The mosaic number is 0-255.')
  return out
}

/** Vendor letters, product (high byte first), then a serial of 00 nn 00 01
 *  where nn is the mosaic number — the reference's layout. */
export function mosaicTopologyId(r: MosaicRequest): number[] {
  const vendor = [...r.vendor.padEnd(3, '?')].slice(0, 3).map((c) => c.charCodeAt(0))
  return [...vendor, (r.product >> 8) & 0xff, r.product & 0xff, 0x00, r.group & 0xff, 0x00, 0x01]
}

/** Build every tile's EDID. Throws on anything mosaicErrors reports. */
export function buildMosaic(r: MosaicRequest, nameFor?: (col: number, row: number) => string): MosaicResult {
  const errors = mosaicErrors(r)
  if (errors.length) throw new Error(errors[0])

  const tileW = r.width / r.cols
  const tileH = r.height / r.rows
  const tile = mosaicTiming(tileW, tileH, r.refreshHz)

  // The base block's DTD holds 4095 at most on each axis, so its stand-in is the
  // tile halved until it fits. The reference halves only the width, and its
  // tiles taller than 4095 wrap (4320 lands as 224). None of its cases is that
  // tall, so halving the height too changes no byte it pins.
  let safeW = tileW
  while (safeW > 4095) safeW = Math.ceil(safeW / 2)
  let safeH = tileH
  while (safeH > 4095) safeH = Math.ceil(safeH / 2)
  const stand = mosaicTiming(safeW, safeH, r.refreshHz)

  const topologyId = mosaicTopologyId(r)

  const tiles: MosaicTile[] = []
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < r.cols; col++) {
      const base = [...ref().slice(0, 128)]
      const [m0, m1] = pnpBytes(r.vendor)
      base[8] = m0
      base[9] = m1
      base[10] = r.product & 0xff
      base[11] = (r.product >> 8) & 0xff
      base[20] = r.bitDepth === 10 ? 0xc5 : 0xb5 // digital, bit depth, DisplayPort
      base.splice(54, 18, ...baseDtd(stand))
      base.splice(90, 18, ...nameDescriptor(nameFor ? nameFor(col, row) : r.name))
      base[127] = checksum(base)

      const cta = [...ref().slice(128, 256)]

      const timingBlock = encodeType1Timing({ timing: toTiming(tile), preferred: true, aspect: 'undefined', fractional: false })
      const tiledBlock = encodeTiledTopology({
        capabilities: 0x0a,
        hTiles: r.cols,
        vTiles: r.rows,
        hLocation: col,
        vLocation: row,
        tileWidth: tileW,
        tileHeight: tileH,
        bezel: [0, 0, 0, 0, 0],
        topologyId,
      })
      // Section header: DisplayID 1.3, 121 declared bytes (the whole block),
      // use case 0, no further sections.
      const blocks = [0x03, 0x01, 0x14, ...timingBlock, 0x12, 0x00, 0x16, ...tiledBlock]
      while (blocks.length < 121) blocks.push(0)
      const section = [0x12, 121, 0x00, 0x00, ...blocks]
      const sum = section.reduce((a, b) => a + b, 0)
      const did = [0x70, ...section, (256 - (sum % 256)) % 256]
      did.push(checksum(did))

      tiles.push({
        col,
        row,
        file: tileFile(r.cols, r.rows, col, row),
        label: tileLabel(r.cols, r.rows, col, row),
        bytes: Uint8Array.from([...base, ...cta, ...did]),
      })
    }
  }

  return { tileWidth: tileW, tileHeight: tileH, tileTiming: toTiming(tile), baseTiming: toTiming(stand), tiles }
}

export type Verdict = 'ok' | 'warn' | 'bad'

export interface MosaicCheck {
  level: Verdict
  what: string
  detail: string
}

/**
 * What a Mac will do with the set, per bench results with the reference files on macOS 26
 * and 27, the BetterDisplay field reports and PixelHue's notes. Advice, not a build error.
 * Which chips manage what is inferred from who reported it.
 */
export function checkMosaic(r: MosaicRequest): MosaicCheck[] {
  const out: MosaicCheck[] = []
  const grid = `${r.cols} × ${r.rows}`
  if (r.cols === 2 && r.rows === 1) {
    out.push({ level: 'ok', what: '2 × 1 bonds on macOS', detail: 'Two plugs, side by side, become one display.' })
  } else if (r.cols === 2 && r.rows === 2) {
    out.push({
      level: 'warn',
      what: '2 × 2 bonds on macOS 27',
      detail:
        'The Mac side works. On an Encore 3 running 10.3, a two-row tile file with DisplayID on drops the connector’s hotplug, so a 2 × 2 fed by an E3 is two 2 × 1 inputs until Barco fix it.',
    })
  } else {
    out.push({
      level: 'bad',
      what: `${grid} does not bond on a Mac`,
      detail: 'Only 2 × 1 and 2 × 2 have ever bonded. Three and four across never have, and stacked tiles failed in the field reports.',
    })
  }

  if (r.width <= MAC_ANY_VERSION_MAX_WIDTH) {
    out.push({
      level: 'ok',
      what: `${r.width} wide works on any recent macOS`,
      detail: `${MAC_ANY_VERSION_MAX_WIDTH} is the widest bonded canvas reported at 50 or 60 Hz before macOS 27: the reference files on macOS 26, and BetterDisplay users since Ventura.`,
    })
  } else if (r.width <= MAC_30HZ_MAX_WIDTH && r.refreshHz <= 30) {
    out.push({
      level: 'warn',
      what: `Up to ${MAC_30HZ_MAX_WIDTH} wide at 30 Hz has bonded on M2 to M4 Max`,
      detail: `Before macOS 27, BetterDisplay users report ${MAC_30HZ_MAX_WIDTH} wide bonding at 30 Hz on M2 Max and M4 Max, and PixelHue say M2 and above. Which chips manage it is inferred from who reported it. At 50 or 60 Hz nothing wider than ${MAC_ANY_VERSION_MAX_WIDTH} has bonded before 27.`,
    })
  } else if (r.width <= MAC_27_MAX_WIDTH) {
    out.push({
      level: 'warn',
      what: `${r.width} wide needs macOS 27`,
      detail: `Before 27 the widest bonded canvas reported is ${MAC_ANY_VERSION_MAX_WIDTH} at 50 or 60 Hz, or ${MAC_30HZ_MAX_WIDTH} at 30 Hz. On macOS 27 the reference files bonded two ${MAX_TILE_WIDTH} tiles, ${MAC_27_MAX_WIDTH} wide.`,
    })
  } else {
    out.push({
      level: 'warn',
      what: `${r.width} wide has never been shown bonding`,
      detail: `${MAC_27_MAX_WIDTH} is the widest bonded canvas anyone has reported, on macOS 27, and it stopped there because the Barco E3 in that test did, not macOS. Nobody has tried wider, so nobody knows. If it has to work on the night, split it across two Macs.`,
    })
  }

  const tileW = r.width / r.cols
  if (tileW > MAX_TILE_WIDTH) {
    out.push({
      level: 'warn',
      what: `Nobody has shown a Mac bonding tiles ${tileW} wide`,
      detail:
        `${MAX_TILE_WIDTH} is the widest tile reported bonding: two of them, ${MAC_27_MAX_WIDTH} wide, on macOS 27. This builds so you can try it, and I’d like to hear how it goes.` +
        (tileW > PIPE_MAX_WIDTH
          ? ` Inferred from third-party reads of M4 and M5 display firmware: one display pipe scans out at most ${PIPE_MAX_WIDTH} wide, so a tile this wide would need two pipes joined, the way a Mac drives 8K.`
          : ''),
    })
  }

  if (r.width > 0 && r.height > 0 && r.refreshHz > 0 && r.cols >= 1 && r.rows >= 1) {
    // The mode the tile's EDID states, its clock rounded to 10 kHz like the Type I timing.
    const t = toTiming(mosaicTiming(tileW, r.height / r.rows, r.refreshHz))
    const mhz = t.pixelClockHz / 1e6
    if (mhz > RANGE_LIMIT_MAX_MHZ) {
      out.push({
        level: 'warn',
        what: `${mhz.toFixed(2)} MHz per plug is past the ${RANGE_LIMIT_MAX_MHZ} MHz its EDID allows`,
        detail: `The base block is a real display’s EDID, copied byte for byte, and its range-limits descriptor says ${RANGE_LIMIT_MAX_MHZ} MHz at most. This tile mode needs more, so each file contradicts itself. Whether a Mac minds is untested. A lower rate brings it down.`,
      })
    }
    const khz = hFreq(t) / 1000
    if (khz > RANGE_LIMIT_MAX_KHZ) {
      out.push({
        level: 'warn',
        what: `${khz.toFixed(2)} kHz line rate per plug is past the ${RANGE_LIMIT_MAX_KHZ} kHz its EDID allows`,
        detail: `The same copied range-limits descriptor says ${RANGE_LIMIT_MAX_KHZ} kHz at most. A tile ${t.vActive} lines tall at ${r.refreshHz} Hz scans more lines a second than that, so each file contradicts itself. Whether a Mac minds is untested. A lower rate brings it down.`,
      })
    }
  }

  out.push({
    level: 'ok',
    what: 'Frame sync comes from bonding',
    detail:
      'Bonded tiles are one display, so the Mac scans them out together. If the Mac shows the plugs as separate displays, they are not bonded and not synced.',
  })
  return out
}
