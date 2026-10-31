import type {
  Chromaticity,
  Descriptor,
  DetailedTimingDescriptor,
  Edid,
  RangeLimitsDescriptor,
  StandardTiming,
} from './types.ts'
import {
  BIT_DEPTHS,
  DIGITAL_INTERFACES,
  ESTABLISHED_EXTRA,
  ESTABLISHED_I_II,
  ESTABLISHED_III_MODES,
  STD_ASPECTS,
} from './tables.ts'
import type { Timing } from '../timing/types.ts'
import { hTotal, vTotal } from '../timing/types.ts'
import { encodeCta } from './cta861.ts'
import { encodeDisplayId } from './displayid.ts'

export class EncodeError extends Error {
  // A declared field, not a `public` parameter property: Node's type stripping
  // refuses those, and the MCP server runs this file straight from source.
  field: string
  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.field = field
    this.name = 'EncodeError'
  }
}

function u8(field: string, v: number): number {
  const n = Math.round(v)
  if (n < 0 || n > 255) throw new EncodeError(field, `${v} does not fit in a byte`)
  return n
}

/** Sum of the block must be 0 mod 256; the last byte carries the difference. */
export function checksum(block: number[]): number {
  const sum = block.slice(0, 127).reduce((a, b) => a + b, 0)
  return (256 - (sum % 256)) % 256
}

/**
 * Manufacturer ID: three 5-bit letters packed big-endian into two bytes, A = 1.
 *
 * The high bit is reserved and must be zero, which is why only 15 of the 16
 * bits carry data and why 'ZZZ' is legal but '\0AA' is not.
 */
export function encodeManufacturer(id: string): [number, number] {
  const s = id.toUpperCase().trim()
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new EncodeError('manufacturerId', `"${id}" must be exactly three letters A-Z`)
  }
  const n =
    ((s.charCodeAt(0) - 64) << 10) |
    ((s.charCodeAt(1) - 64) << 5) |
    (s.charCodeAt(2) - 64)
  return [(n >> 8) & 0xff, n & 0xff]
}

/** 10-bit CIE 1931 fraction. 0.640 becomes 655. */
const chromaValue = (field: string, v: number): number => {
  if (v < 0 || v >= 1) throw new EncodeError(field, `${v} must be in [0, 1)`)
  return Math.round(v * 1024)
}

export function encodeChromaticity(c: Chromaticity): number[] {
  const rx = chromaValue('redX', c.redX)
  const ry = chromaValue('redY', c.redY)
  const gx = chromaValue('greenX', c.greenX)
  const gy = chromaValue('greenY', c.greenY)
  const bx = chromaValue('blueX', c.blueX)
  const by = chromaValue('blueY', c.blueY)
  const wx = chromaValue('whiteX', c.whiteX)
  const wy = chromaValue('whiteY', c.whiteY)

  // The two low bits of all eight coordinates are gathered into the first two
  // bytes so the remaining eight can each hold a clean high byte.
  const lowRg = ((rx & 3) << 6) | ((ry & 3) << 4) | ((gx & 3) << 2) | (gy & 3)
  const lowBw = ((bx & 3) << 6) | ((by & 3) << 4) | ((wx & 3) << 2) | (wy & 3)

  return [
    lowRg,
    lowBw,
    rx >> 2,
    ry >> 2,
    gx >> 2,
    gy >> 2,
    bx >> 2,
    by >> 2,
    wx >> 2,
    wy >> 2,
  ]
}

export function encodeStandardTiming(st: StandardTiming | null): [number, number] {
  if (!st) return [0x01, 0x01] // the "unused" sentinel, not 0x00
  const code = st.hActive / 8 - 31
  if (!Number.isInteger(code) || code < 1 || code > 255) {
    throw new EncodeError(
      'standardTiming',
      `${st.hActive} px is not expressible — must be a multiple of 8 from 256 to 2288`,
    )
  }
  const aspect = STD_ASPECTS.indexOf(st.aspect)
  if (aspect < 0) throw new EncodeError('standardTiming', `unknown aspect ${st.aspect}`)
  const rr = Math.round(st.refreshHz) - 60
  if (rr < 0 || rr > 63) {
    throw new EncodeError(
      'standardTiming',
      `${st.refreshHz} Hz is out of range — a standard timing can only say 60-123 Hz`,
    )
  }
  return [code, (aspect << 6) | rr]
}

/**
 * An 18-byte Detailed Timing Descriptor.
 *
 * The pixel clock field is 10 kHz units, so an exact clock that is not a
 * multiple of 10 kHz cannot be represented — 25.175 MHz becomes 25.18. That
 * loss is real and is reported by `dtdClockError`, not hidden.
 */
export function encodeDtd(d: DetailedTimingDescriptor): number[] {
  const t = d.timing
  const clock10k = Math.round(t.pixelClockHz / 10000)
  if (clock10k < 1 || clock10k > 65535) {
    throw new EncodeError(
      'pixelClock',
      `${(t.pixelClockHz / 1e6).toFixed(3)} MHz is outside what a DTD can state (0.01-655.35 MHz). ` +
        `Above 655.35 MHz the timing has to live in a DisplayID Type VII block instead.`,
    )
  }

  const hBlank = t.hFront + t.hSync + t.hBack
  const vBlank = t.vFront + t.vSync + t.vBack

  if (t.hActive > 4095) throw new EncodeError('hActive', `${t.hActive} exceeds the 12-bit field (4095)`)
  if (hBlank > 4095) throw new EncodeError('hBlank', `${hBlank} exceeds the 12-bit field (4095)`)
  if (t.vActive > 4095) throw new EncodeError('vActive', `${t.vActive} exceeds the 12-bit field (4095)`)
  if (vBlank > 4095) throw new EncodeError('vBlank', `${vBlank} exceeds the 12-bit field (4095)`)
  if (t.hFront > 1023) throw new EncodeError('hFront', `${t.hFront} exceeds the 10-bit field (1023)`)
  if (t.hSync > 1023) throw new EncodeError('hSync', `${t.hSync} exceeds the 10-bit field (1023)`)
  if (t.vFront > 63) throw new EncodeError('vFront', `${t.vFront} exceeds the 6-bit field (63)`)
  if (t.vSync > 63) throw new EncodeError('vSync', `${t.vSync} exceeds the 6-bit field (63)`)

  const syncBits = { 'analog-composite': 0, 'bipolar-analog': 1, 'digital-composite': 2, 'digital-separate': 3 }[d.syncType]
  const stereoIdx = ['none', 'field-right', 'field-left', 'interleaved-right', 'interleaved-left', 'interleaved-4way', 'side-by-side'].indexOf(d.stereo)
  // Stereo occupies bits 6-5 plus bit 0 — a three-bit field split across the
  // byte, because bit 0 was allocated to something else first.
  const stereoHi = stereoIdx <= 0 ? 0 : (stereoIdx + 1) >> 1
  const stereoLo = stereoIdx <= 0 ? 0 : (stereoIdx + 1) & 1

  let flags = (t.interlaced ? 0x80 : 0) | ((stereoHi & 3) << 5) | (syncBits << 3) | stereoLo
  if (syncBits === 3) {
    flags |= (t.vSyncPositive ? 0x04 : 0) | (t.hSyncPositive ? 0x02 : 0)
  }

  return [
    clock10k & 0xff,
    (clock10k >> 8) & 0xff,
    t.hActive & 0xff,
    hBlank & 0xff,
    ((t.hActive >> 8) << 4) | (hBlank >> 8),
    t.vActive & 0xff,
    vBlank & 0xff,
    ((t.vActive >> 8) << 4) | (vBlank >> 8),
    t.hFront & 0xff,
    t.hSync & 0xff,
    ((t.vFront & 0x0f) << 4) | (t.vSync & 0x0f),
    ((t.hFront >> 8) << 6) | ((t.hSync >> 8) << 4) | ((t.vFront >> 4) << 2) | (t.vSync >> 4),
    u8('hSizeMm', d.hSizeMm & 0xff),
    u8('vSizeMm', d.vSizeMm & 0xff),
    ((d.hSizeMm >> 8) << 4) | (d.vSizeMm >> 8),
    u8('hBorder', d.hBorder),
    u8('vBorder', d.vBorder),
    flags,
  ]
}

/**
 * Why this timing will not fit an 18-byte detailed timing descriptor, or null
 * if it does fit.
 *
 * The clock ceiling is the famous one, but it is NOT the only limit and often
 * not the one that bites first: active and blanking are 12-bit fields, so
 * anything wider than 4095 pixels is out no matter how slow it is. An
 * 8192x1080 @60 wide format — which Analog Way advertise on the Aquilon input
 * cards — has a perfectly ordinary 594 MHz clock and still cannot be a DTD.
 */
export function dtdLimit(t: Timing): string | null {
  const hBlank = t.hFront + t.hSync + t.hBack
  const vBlank = t.vFront + t.vSync + t.vBack
  const clock10k = Math.round(t.pixelClockHz / 10000)

  if (clock10k > 65535) {
    return `a ${(t.pixelClockHz / 1e6).toFixed(2)} MHz pixel clock is above the 655.35 MHz a detailed timing descriptor can state`
  }
  if (t.hActive > 4095) return `${t.hActive} active pixels exceeds the descriptor's 12-bit field (4095 max)`
  if (t.vActive > 4095) return `${t.vActive} active lines exceeds the descriptor's 12-bit field (4095 max)`
  if (hBlank > 4095) return `${hBlank} pixels of horizontal blanking exceeds the descriptor's 12-bit field`
  if (vBlank > 4095) return `${vBlank} lines of vertical blanking exceeds the descriptor's 12-bit field`
  if (t.hFront > 1023) return `a ${t.hFront} pixel front porch exceeds the descriptor's 10-bit field`
  if (t.hSync > 1023) return `a ${t.hSync} pixel sync width exceeds the descriptor's 10-bit field`
  if (t.vFront > 63) return `a ${t.vFront} line front porch exceeds the descriptor's 6-bit field`
  if (t.vSync > 63) return `a ${t.vSync} line sync width exceeds the descriptor's 6-bit field`
  return null
}

/** How much the DTD's 10 kHz grid moved the clock, in Hz. */
export function dtdClockError(t: { pixelClockHz: number }): number {
  return Math.round(t.pixelClockHz / 10000) * 10000 - t.pixelClockHz
}

function textDescriptor(tag: number, text: string): number[] {
  const bytes = [0, 0, 0, tag, 0]
  const chars = [...text].slice(0, 13)
  for (const ch of chars) {
    const c = ch.codePointAt(0) ?? 32
    // The descriptor is single-byte ASCII. A character outside it would be
    // truncated to nonsense, so it becomes a space rather than a mojibake byte.
    bytes.push(c > 0 && c < 127 ? c : 32)
  }
  if (chars.length < 13) {
    bytes.push(0x0a) // terminator, only when there is room for it
    while (bytes.length < 18) bytes.push(0x20)
  }
  return bytes.slice(0, 18)
}

function encodeRange(d: RangeLimitsDescriptor): number[] {
  let vMin = Math.round(d.minVerticalHz)
  let vMax = Math.round(d.maxVerticalHz)
  let hMin = Math.round(d.minHorizontalKHz)
  let hMax = Math.round(d.maxHorizontalKHz)

  // Rates above 255 use the +255 offset flags rather than overflowing. A
  // 240 Hz panel fits without them; a 480 Hz one does not.
  let offsets = 0
  if (vMax > 255) {
    offsets |= vMin > 255 ? 0b11 : 0b10
    vMax -= 255
    if (vMin > 255) vMin -= 255
  }
  if (hMax > 255) {
    offsets |= hMin > 255 ? 0b1100 : 0b1000
    hMax -= 255
    if (hMin > 255) hMin -= 255
  }

  if (vMax > 255 || hMax > 255) {
    throw new EncodeError('rangeLimits', 'rates above 510 Hz / 510 kHz cannot be stated in a range descriptor')
  }

  // 10 MHz steps, rounded UP: rounding down would advertise less headroom than
  // the display really has and can lose the mode the EDID exists to carry.
  const clock = Math.ceil(d.maxPixelClockMHz / 10)
  if (clock > 255) throw new EncodeError('maxPixelClockMHz', `${d.maxPixelClockMHz} MHz exceeds the 2550 MHz field maximum`)

  const support = { 'default-gtf': 0x00, 'range-limits-only': 0x01, 'secondary-gtf': 0x02, cvt: 0x04 }[d.support]

  const head = [0, 0, 0, 0xfd, offsets, vMin, vMax, hMin, hMax, clock, support]

  if (d.support === 'cvt' && d.cvt) {
    const c = d.cvt
    const maxPx = Math.round(c.maxActivePixelsPerLine / 8)
    const aspectBits =
      (c.supportedAspects.includes('4:3') ? 0x80 : 0) |
      (c.supportedAspects.includes('16:9') ? 0x40 : 0) |
      (c.supportedAspects.includes('16:10') ? 0x20 : 0) |
      (c.supportedAspects.includes('5:4') ? 0x10 : 0)
    const prefIdx = { '4:3': 0, '16:9': 1, '16:10': 2, '5:4': 3 }[c.preferredAspect] ?? 0
    return [
      ...head,
      c.version,
      maxPx >> 8,
      maxPx & 0xff,
      aspectBits,
      (prefIdx << 5) | (c.reducedBlanking ? 0x10 : 0) | (c.standardBlanking ? 0x08 : 0),
      (c.scalingHorizontalShrink ? 0x80 : 0) |
        (c.scalingHorizontalStretch ? 0x40 : 0) |
        (c.scalingVerticalShrink ? 0x20 : 0) |
        (c.scalingVerticalStretch ? 0x10 : 0),
      Math.round(c.preferredRefreshHz),
    ]
  }

  return [...head, 0x0a, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]
}

export function encodeDescriptor(d: Descriptor): number[] {
  switch (d.kind) {
    case 'dtd':
      return encodeDtd(d)
    case 'name':
      return textDescriptor(0xfc, d.text)
    case 'serial':
      return textDescriptor(0xff, d.text)
    case 'text':
      return textDescriptor(0xfe, d.text)
    case 'range':
      return encodeRange(d)
    case 'established-iii': {
      const bytes = [0, 0, 0, 0xf7, 0x0a, ...new Array(12).fill(0), 0]
      for (const mode of d.modes) {
        const idx = (ESTABLISHED_III_MODES as readonly string[]).indexOf(mode)
        if (idx < 0) continue
        bytes[5 + (idx >> 3)] |= 0x80 >> (idx & 7)
      }
      return bytes.slice(0, 18)
    }
    case 'dummy':
      return [0, 0, 0, 0x10, 0, ...new Array(13).fill(0)]
    case 'raw': {
      const b = d.bytes.slice(0, 18)
      while (b.length < 18) b.push(0)
      return b
    }
  }
}

/** The 128-byte base block, checksum included. */
export function encodeBaseBlock(e: Edid): number[] {
  const b: number[] = []

  b.push(0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00)
  b.push(...encodeManufacturer(e.manufacturerId))
  b.push(e.productCode & 0xff, (e.productCode >> 8) & 0xff)
  b.push(
    e.serialNumber & 0xff,
    (e.serialNumber >> 8) & 0xff,
    (e.serialNumber >> 16) & 0xff,
    (e.serialNumber >>> 24) & 0xff,
  )

  b.push(e.isModelYear ? 0xff : u8('week', e.week))
  const yearByte = e.year - 1990
  if (yearByte < 0 || yearByte > 255) {
    throw new EncodeError('year', `${e.year} is outside 1990-2245`)
  }
  b.push(yearByte)

  b.push(u8('version', e.version), u8('revision', e.revision))

  if (e.input.kind === 'digital') {
    const depth = BIT_DEPTHS.indexOf(e.input.bitDepth as never)
    const iface = DIGITAL_INTERFACES.indexOf(e.input.interface as never)
    if (depth < 0) throw new EncodeError('bitDepth', `unknown depth ${e.input.bitDepth}`)
    if (iface < 0) throw new EncodeError('interface', `unknown interface ${e.input.interface}`)
    b.push(0x80 | (depth << 4) | iface)
  } else {
    const a = e.input
    b.push(
      (a.levels << 5) |
        (a.blankToBlackSetup ? 0x10 : 0) |
        (a.separateSyncSupported ? 0x08 : 0) |
        (a.compositeSyncSupported ? 0x04 : 0) |
        (a.syncOnGreenSupported ? 0x02 : 0) |
        (a.vsyncSerrated ? 0x01 : 0),
    )
  }

  b.push(u8('screenWidthCm', e.screenWidthCm), u8('screenHeightCm', e.screenHeightCm))

  if (e.gamma === null) {
    b.push(0xff) // "defined in an extension" — EDID 1.4 only
  } else {
    const g = Math.round(e.gamma * 100) - 100
    if (g < 0 || g > 254) throw new EncodeError('gamma', `${e.gamma} is outside 1.00-3.54`)
    b.push(g)
  }

  const f = e.features
  const enc = ['rgb444', 'rgb444-ycrcb444', 'rgb444-ycrcb422', 'rgb444-ycrcb444-ycrcb422'].indexOf(f.colorEncoding)
  b.push(
    (f.standby ? 0x80 : 0) |
      (f.suspend ? 0x40 : 0) |
      (f.activeOff ? 0x20 : 0) |
      (enc << 3) |
      (f.srgbDefault ? 0x04 : 0) |
      (f.preferredTimingIsNative ? 0x02 : 0) |
      (f.continuousFrequency ? 0x01 : 0),
  )

  b.push(...encodeChromaticity(e.chromaticity))

  let est0 = 0
  let est1 = 0
  ESTABLISHED_I_II.forEach((mode, i) => {
    if (!e.established[mode]) return
    if (i < 8) est0 |= 0x80 >> i
    else est1 |= 0x80 >> (i - 8)
  })
  b.push(est0, est1, e.established[ESTABLISHED_EXTRA] ? 0x80 : 0x00)

  for (let i = 0; i < 8; i++) b.push(...encodeStandardTiming(e.standardTimings[i] ?? null))

  for (let i = 0; i < 4; i++) {
    const d = e.descriptors[i] ?? { kind: 'dummy' as const }
    b.push(...encodeDescriptor(d))
  }

  b.push(e.extensions.length)
  b.push(checksum(b))

  if (b.length !== 128) {
    throw new EncodeError('base', `produced ${b.length} bytes, expected 128 — this is a bug`)
  }
  return b
}

/** The whole EDID: base block plus every extension, each 128 bytes. */
export function encodeEdid(e: Edid): Uint8Array {
  const out = [...encodeBaseBlock(e)]
  for (const ext of e.extensions) {
    switch (ext.kind) {
      case 'cta':
        out.push(...encodeCta(ext))
        break
      case 'displayid':
        out.push(...encodeDisplayId(ext))
        break
      case 'raw': {
        const bl = ext.bytes.slice(0, 128)
        while (bl.length < 127) bl.push(0)
        bl[127] = checksum(bl)
        out.push(...bl)
        break
      }
    }
  }
  return Uint8Array.from(out)
}

export { hTotal, vTotal }
