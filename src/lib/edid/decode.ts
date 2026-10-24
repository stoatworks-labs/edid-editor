import type {
  Descriptor,
  Edid,
  EstablishedTimings,
  Extension,
  StandardTiming,
  TimingSupportFlag,
} from './types.ts'
import {
  BIT_DEPTHS,
  DIGITAL_INTERFACES,
  ESTABLISHED_EXTRA,
  ESTABLISHED_I_II,
  ESTABLISHED_III_MODES,
  STD_ASPECTS,
} from './tables.ts'
import { decodeDtd } from './decode-dtd.ts'
import { decodeCta } from './cta861.ts'
import { decodeDisplayId } from './displayid.ts'

export interface DecodeIssue {
  severity: 'error' | 'warning'
  where: string
  message: string
}

export interface DecodeResult {
  edid: Edid
  issues: DecodeIssue[]
}

const HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]

function decodeText(b: number[]): string {
  // Everything from byte 5 up to the 0x0A terminator; trailing 0x20 padding is
  // not part of the value even when there is no terminator.
  let s = ''
  for (let i = 5; i < 18; i++) {
    if (b[i] === 0x0a) break
    s += String.fromCharCode(b[i])
  }
  return s.replace(/\s+$/, '')
}

function decodeDescriptor(b: number[], issues: DecodeIssue[], idx: number): Descriptor {
  const dtd = decodeDtd(b)
  if (dtd) return dtd

  const tag = b[3]
  switch (tag) {
    case 0xfc:
      return { kind: 'name', text: decodeText(b) }
    case 0xff:
      return { kind: 'serial', text: decodeText(b) }
    case 0xfe:
      return { kind: 'text', text: decodeText(b) }
    case 0x10:
      return { kind: 'dummy' }
    case 0xf7: {
      const modes: string[] = []
      ESTABLISHED_III_MODES.forEach((mode, i) => {
        if (b[5 + (i >> 3)] & (0x80 >> (i & 7))) modes.push(mode)
      })
      return { kind: 'established-iii', modes }
    }
    case 0xfd: {
      const offsets = b[4]
      const vOff = offsets & 0x03
      const hOff = (offsets >> 2) & 0x03
      const support = ({ 0: 'default-gtf', 1: 'range-limits-only', 2: 'secondary-gtf', 4: 'cvt' } as Record<number, TimingSupportFlag>)[b[10]] ?? 'range-limits-only'

      const d: Descriptor = {
        kind: 'range',
        minVerticalHz: b[5] + (vOff === 0b11 ? 255 : 0),
        maxVerticalHz: b[6] + (vOff >= 0b10 ? 255 : 0),
        minHorizontalKHz: b[7] + (hOff === 0b11 ? 255 : 0),
        maxHorizontalKHz: b[8] + (hOff >= 0b10 ? 255 : 0),
        maxPixelClockMHz: b[9] * 10,
        support,
      }
      if (support === 'cvt') {
        const prefIdx = (b[15] >> 5) & 0x07
        d.cvt = {
          version: b[11],
          maxActivePixelsPerLine: (((b[12] & 0x03) << 8) | b[13]) * 8,
          supportedAspects: [
            ...(b[14] & 0x80 ? (['4:3'] as const) : []),
            ...(b[14] & 0x40 ? (['16:9'] as const) : []),
            ...(b[14] & 0x20 ? (['16:10'] as const) : []),
            ...(b[14] & 0x10 ? (['5:4'] as const) : []),
          ],
          preferredAspect: (['4:3', '16:9', '16:10', '5:4'] as const)[prefIdx] ?? '16:9',
          reducedBlanking: !!(b[15] & 0x10),
          standardBlanking: !!(b[15] & 0x08),
          scalingHorizontalShrink: !!(b[16] & 0x80),
          scalingHorizontalStretch: !!(b[16] & 0x40),
          scalingVerticalShrink: !!(b[16] & 0x20),
          scalingVerticalStretch: !!(b[16] & 0x10),
          preferredRefreshHz: b[17],
        }
      }
      return d
    }
    default:
      issues.push({
        severity: 'warning',
        where: `descriptor ${idx + 1}`,
        message: `unrecognised display descriptor tag 0x${tag.toString(16).padStart(2, '0')} — kept as raw bytes`,
      })
      return { kind: 'raw', bytes: b.slice() }
  }
}

/**
 * Parse an EDID.
 *
 * Never throws on malformed input: a bad checksum, a wrong header or a short
 * block become issues, and the parse continues on whatever is there. Refusing
 * to open a broken EDID would make the tool useless for exactly the case a
 * person reaches for it — the dump off a device that is misbehaving.
 */
export function decodeEdid(data: Uint8Array | number[]): DecodeResult {
  const bytes = Array.from(data)
  const issues: DecodeIssue[] = []

  if (bytes.length < 128) {
    issues.push({ severity: 'error', where: 'file', message: `only ${bytes.length} bytes — an EDID base block is 128` })
    while (bytes.length < 128) bytes.push(0)
  }

  if (!HEADER.every((v, i) => bytes[i] === v)) {
    issues.push({
      severity: 'error',
      where: 'header',
      message: 'the 00 FF FF FF FF FF FF 00 header is missing — this may not be an EDID, or may be offset',
    })
  }

  const sum = bytes.slice(0, 128).reduce((a, b) => a + b, 0) % 256
  if (sum !== 0) {
    issues.push({
      severity: 'error',
      where: 'base block',
      message: `checksum is wrong (bytes sum to ${sum}, should be 0). Re-saving will correct it.`,
    })
  }

  const mfg = (bytes[8] << 8) | bytes[9]
  const manufacturerId =
    String.fromCharCode(64 + ((mfg >> 10) & 0x1f)) +
    String.fromCharCode(64 + ((mfg >> 5) & 0x1f)) +
    String.fromCharCode(64 + (mfg & 0x1f))

  const digital = !!(bytes[20] & 0x80)
  const input = digital
    ? {
        kind: 'digital' as const,
        bitDepth: BIT_DEPTHS[(bytes[20] >> 4) & 0x07] ?? 'undefined',
        interface: DIGITAL_INTERFACES[bytes[20] & 0x0f] ?? 'undefined',
      }
    : {
        kind: 'analog' as const,
        levels: ((bytes[20] >> 5) & 0x03) as 0 | 1 | 2 | 3,
        blankToBlackSetup: !!(bytes[20] & 0x10),
        separateSyncSupported: !!(bytes[20] & 0x08),
        compositeSyncSupported: !!(bytes[20] & 0x04),
        syncOnGreenSupported: !!(bytes[20] & 0x02),
        vsyncSerrated: !!(bytes[20] & 0x01),
      }

  const chroma = (hi: number, lowByte: number, shift: number) =>
    (((bytes[hi] << 2) | ((bytes[lowByte] >> shift) & 0x03)) / 1024)

  const established: EstablishedTimings = {}
  ESTABLISHED_I_II.forEach((mode, i) => {
    const byte = i < 8 ? bytes[35] : bytes[36]
    const bit = 0x80 >> (i < 8 ? i : i - 8)
    if (byte & bit) established[mode] = true
  })
  if (bytes[37] & 0x80) established[ESTABLISHED_EXTRA] = true

  const standardTimings: (StandardTiming | null)[] = []
  for (let i = 0; i < 8; i++) {
    const a = bytes[38 + i * 2]
    const b = bytes[39 + i * 2]
    // 0x01 0x01 is "unused". 0x00 0x00 is technically invalid but appears in
    // the wild, so it is treated the same rather than decoded as 248x186.
    if ((a === 0x01 && b === 0x01) || (a === 0x00 && b === 0x00)) {
      standardTimings.push(null)
      continue
    }
    standardTimings.push({
      hActive: (a + 31) * 8,
      aspect: STD_ASPECTS[(b >> 6) & 0x03],
      refreshHz: (b & 0x3f) + 60,
    })
  }

  const descriptors: Descriptor[] = []
  for (let i = 0; i < 4; i++) {
    descriptors.push(decodeDescriptor(bytes.slice(54 + i * 18, 72 + i * 18), issues, i))
  }

  const extCount = bytes[126]
  const extensions: Extension[] = []
  const available = Math.floor((bytes.length - 128) / 128)
  if (available < extCount) {
    issues.push({
      severity: 'warning',
      where: 'extensions',
      message: `the base block declares ${extCount} extension block(s) but the file holds ${available}`,
    })
  }

  for (let i = 0; i < Math.min(extCount, available); i++) {
    const block = bytes.slice(128 + i * 128, 256 + i * 128)
    const s = block.reduce((a, b) => a + b, 0) % 256
    if (s !== 0) {
      issues.push({ severity: 'error', where: `extension ${i + 1}`, message: `checksum is wrong (sums to ${s})` })
    }
    switch (block[0]) {
      case 0x02: {
        const cta = decodeCta(block)
        const blocks = cta.source?.blocks.length ?? 0
        if (block[2] === 0 && blocks) {
          issues.push({
            severity: 'warning',
            where: `extension ${i + 1}`,
            message:
              `byte 2 is 0, which says there are no data blocks, but ${blocks} follow it: Linux and edid-decode ` +
              'skip them all, so a source sees no VICs and no HDMI block. Saved unedited it stays that way; ' +
              'any edit to this extension writes the right offset',
          })
        }
        extensions.push(cta)
        break
      }
      case 0x70:
        extensions.push(decodeDisplayId(block))
        break
      default:
        issues.push({
          severity: 'warning',
          where: `extension ${i + 1}`,
          message: `tag 0x${block[0].toString(16).padStart(2, '0')} is not modelled — kept byte-for-byte`,
        })
        extensions.push({ kind: 'raw', tag: block[0], bytes: block })
    }
  }

  const revision = bytes[19]
  const gammaByte = bytes[23]
  if (gammaByte === 0xff && revision < 4) {
    issues.push({
      severity: 'warning',
      where: 'gamma',
      message: 'gamma 0xFF means "defined in an extension", which only EDID 1.4 allows',
    })
  }

  const edid: Edid = {
    manufacturerId,
    productCode: bytes[10] | (bytes[11] << 8),
    serialNumber: (bytes[12] | (bytes[13] << 8) | (bytes[14] << 16) | (bytes[15] << 24)) >>> 0,
    week: bytes[16] === 0xff ? 0 : bytes[16],
    year: bytes[17] + 1990,
    isModelYear: bytes[16] === 0xff,
    version: bytes[18],
    revision,
    input,
    screenWidthCm: bytes[21],
    screenHeightCm: bytes[22],
    gamma: gammaByte === 0xff ? null : (gammaByte + 100) / 100,
    features: {
      standby: !!(bytes[24] & 0x80),
      suspend: !!(bytes[24] & 0x40),
      activeOff: !!(bytes[24] & 0x20),
      colorEncoding: (['rgb444', 'rgb444-ycrcb444', 'rgb444-ycrcb422', 'rgb444-ycrcb444-ycrcb422'] as const)[(bytes[24] >> 3) & 0x03],
      srgbDefault: !!(bytes[24] & 0x04),
      preferredTimingIsNative: !!(bytes[24] & 0x02),
      continuousFrequency: !!(bytes[24] & 0x01),
    },
    chromaticity: {
      redX: chroma(27, 25, 6),
      redY: chroma(28, 25, 4),
      greenX: chroma(29, 25, 2),
      greenY: chroma(30, 25, 0),
      blueX: chroma(31, 26, 6),
      blueY: chroma(32, 26, 4),
      whiteX: chroma(33, 26, 2),
      whiteY: chroma(34, 26, 0),
    },
    established,
    standardTimings,
    descriptors,
    extensions,
  }

  return { edid, issues }
}

/** Accepts a raw binary, or a hex dump in any of the common shapings. */
export function parseEdidFile(input: Uint8Array | string): DecodeResult {
  if (typeof input !== 'string') return decodeEdid(input)

  // Strip C-array syntax, 0x prefixes, addresses and separators, then take
  // whatever hex pairs remain. This handles xrandr, edid-decode, `xxd`, a .c
  // header and a bare hex string without needing to know which it is.
  const cleaned = input
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/0x/gi, ' ')
    .replace(/^[0-9a-f]{4,8}:/gim, ' ')
    .replace(/[^0-9a-fA-F]/g, '')

  const bytes: number[] = []
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16))
  }
  return decodeEdid(bytes)
}
