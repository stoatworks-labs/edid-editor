import type {
  AudioDescriptor,
  Colorimetry,
  CtaBlockKey,
  CtaExtension,
  DetailedTimingDescriptor,
  HdmiForumVsdb,
  HdmiVsdb,
  HdrStaticMetadata,
  VideoCapability,
} from './types.ts'
import { checksum, encodeDtd } from './encode.ts'
import { decodeDtd } from './decode-dtd.ts'
import { CTA_AUDIO_RATES } from './tables.ts'

/**
 * CTA-861 extension block (tag 0x02).
 *
 * Layout: a four-byte header, then a data block collection, then detailed
 * timings, then padding, then the checksum. Header byte 2 is the offset at
 * which the timings start, which means the data block collection's total size
 * is not stated anywhere — it is inferred from that offset. Get it wrong and
 * a sink reads the first DTD as a data block header.
 *
 * The HDMI Forum VSDB bit assignments below follow edid-decode's reading of
 * HDMI 2.1. They are NOT verified against a device here; see AGENTS.md.
 */

const HDMI_OUI = [0x03, 0x0c, 0x00] // 00-0C-03, little-endian on the wire
const HDMI_FORUM_OUI = [0xd8, 0x5d, 0xc4] // C4-5D-D8

// ------------------------------------------------------------------- encode

function block(tag: number, payload: number[]): number[] {
  if (payload.length > 31) {
    throw new Error(`CTA data block tag ${tag}: ${payload.length} bytes exceeds the 31-byte maximum`)
  }
  return [(tag << 5) | payload.length, ...payload]
}

const extBlock = (extTag: number, payload: number[]) => block(7, [extTag, ...payload])

function encodeAudioDescriptor(a: AudioDescriptor): number[] {
  let rateBits = 0
  for (const r of a.rates) {
    const i = CTA_AUDIO_RATES.indexOf(r as never)
    if (i >= 0) rateBits |= 1 << i
  }
  let third = 0
  if (a.format === 1) {
    // LPCM's third byte is a bit depth map; everything else states a bitrate.
    for (const d of a.lpcmDepths ?? []) {
      if (d === 16) third |= 0x01
      if (d === 20) third |= 0x02
      if (d === 24) third |= 0x04
    }
  } else {
    third = Math.round((a.maxBitrateKbps ?? 0) / 8)
  }
  return [((a.format & 0x0f) << 3) | ((a.channels - 1) & 0x07), rateBits, third]
}

function encodeHdmiVsdb(v: HdmiVsdb): number[] {
  const [a, b, c, d] = v.physicalAddress
  const payload = [
    ...HDMI_OUI,
    ((a & 0xf) << 4) | (b & 0xf),
    ((c & 0xf) << 4) | (d & 0xf),
    (v.supportsAi ? 0x80 : 0) |
      (v.deepColor48 ? 0x40 : 0) |
      (v.deepColor36 ? 0x20 : 0) |
      (v.deepColor30 ? 0x10 : 0) |
      (v.deepColorY444 ? 0x08 : 0) |
      (v.dviDual ? 0x01 : 0),
  ]
  // The max-TMDS byte is optional, and omitting it is NOT the same as writing
  // zero — a source reads a missing byte as "165 MHz" and a zero as "unknown".
  if (v.maxTmdsClockMHz > 0) payload.push(Math.round(v.maxTmdsClockMHz / 5))
  return block(3, payload)
}

function encodeHdmiForumVsdb(v: HdmiForumVsdb): number[] {
  const payload = [
    ...HDMI_FORUM_OUI,
    v.version & 0xff,
    Math.round(v.maxTmdsCharacterRateMHz / 5),
    (v.scdcPresent ? 0x80 : 0) |
      (v.rrCapable ? 0x40 : 0) |
      (v.lte340ScrambleSupported ? 0x08 : 0),
    ((v.maxFrlRate & 0x0f) << 4) |
      (v.deepColor420_48 ? 0x04 : 0) |
      (v.deepColor420_36 ? 0x02 : 0) |
      (v.deepColor420_30 ? 0x01 : 0),
    (v.allmSupported ? 0x08 : 0) |
      (v.fvaSupported ? 0x10 : 0) |
      (v.cnmVrr ? 0x20 : 0) |
      (v.cinemaVrr ? 0x40 : 0) |
      (v.mDelta ? 0x80 : 0),
  ]

  const needsVrr = v.vrrMin > 0 || v.vrrMax > 0
  const needsDsc = v.dscCapable
  if (needsVrr || needsDsc || v.qmsSupported) {
    payload.push(((v.vrrMax >> 8) & 0x03) << 6 | (v.vrrMin & 0x3f))
    payload.push(v.vrrMax & 0xff)
  }
  if (needsDsc || v.qmsSupported) {
    payload.push(
      (v.dscCapable ? 0x80 : 0) |
        (v.dscNative420 ? 0x40 : 0) |
        (v.qmsSupported ? 0x20 : 0) |
        (v.dscAllBpp ? 0x10 : 0) |
        (v.dsc12bpc ? 0x04 : 0) |
        (v.dsc10bpc ? 0x02 : 0),
    )
    payload.push(((v.dscMaxFrlRate & 0x0f) << 4) | (v.dscMaxSlices & 0x0f))
    payload.push(v.dscTotalChunkKBytes & 0x3f)
  }
  return block(3, payload)
}

function encodeHdr(h: HdrStaticMetadata): number[] {
  const payload = [
    (h.eotfSdr ? 0x01 : 0) |
      (h.eotfHdr ? 0x02 : 0) |
      (h.eotfSmpte2084 ? 0x04 : 0) |
      (h.eotfHlg ? 0x08 : 0),
    h.staticMetadataType1 ? 0x01 : 0,
  ]
  // The three luminance bytes are individually optional and strictly ordered:
  // you cannot state min without also stating max and frame-average.
  if (h.maxLuminance !== undefined) payload.push(h.maxLuminance & 0xff)
  if (h.maxFrameAverageLuminance !== undefined) payload.push(h.maxFrameAverageLuminance & 0xff)
  if (h.minLuminance !== undefined) payload.push(h.minLuminance & 0xff)
  return extBlock(6, payload)
}

function encodeColorimetry(c: Colorimetry): number[] {
  return extBlock(5, [
    (c.xvYCC601 ? 0x01 : 0) |
      (c.xvYCC709 ? 0x02 : 0) |
      (c.sYCC601 ? 0x04 : 0) |
      (c.opYCC601 ? 0x08 : 0) |
      (c.opRGB ? 0x10 : 0) |
      (c.bt2020cYCC ? 0x20 : 0) |
      (c.bt2020YCC ? 0x40 : 0) |
      (c.bt2020RGB ? 0x80 : 0),
    (c.dciP3 ? 0x80 : 0) |
      (c.md[0] ? 0x01 : 0) |
      (c.md[1] ? 0x02 : 0) |
      (c.md[2] ? 0x04 : 0) |
      (c.md[3] ? 0x08 : 0),
  ])
}

function encodeVideoCapability(v: VideoCapability): number[] {
  return extBlock(0, [
    (v.qySelectableYcc ? 0x80 : 0) |
      (v.qsSelectableRgb ? 0x40 : 0) |
      ((v.ptScan & 3) << 4) |
      ((v.itScan & 3) << 2) |
      (v.ceScan & 3),
  ])
}

/**
 * A canonical serialisation: sorted keys, undefined dropped. The UI edits by
 * spreading, so key order is not something to compare on.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** The model fields each data block decodes into — what an edit changes. */
const FIELDS: Record<Exclude<CtaBlockKey, 'unknown'>, (e: CtaExtension) => unknown> = {
  video: (e) => e.videoDescriptors,
  audio: (e) => e.audioDescriptors,
  speaker: (e) => e.speakerAllocation,
  hdmi: (e) => e.hdmiVsdb,
  videoCapability: (e) => e.videoCapability,
  colorimetry: (e) => e.colorimetry,
  hdr: (e) => e.hdrStaticMetadata,
  ycbcr420Only: (e) => e.ycbcr420OnlyVics,
  ycbcr420Also: (e) => e.ycbcr420AlsoVics,
  hdmiForum: (e) => e.hdmiForumVsdb,
}

const modelOf = (e: CtaExtension, key: Exclude<CtaBlockKey, 'unknown'>) => canonical(FIELDS[key](e))
const wholeModelOf = (e: CtaExtension) => canonical({ ...e, source: undefined })

/** Each modelled block from scratch, or null when there is nothing to say.
 *  The object's key order is the order a block built here is written in. */
function freshBlocks(ext: CtaExtension): Record<Exclude<CtaBlockKey, 'unknown'>, number[] | null> {
  return {
    video: ext.videoDescriptors.length
      ? block(
          2,
          ext.videoDescriptors.map((v) =>
            // The native flag only exists for VICs 1-64; for 65-127 bit 7 is part
            // of the code itself, so setting it there would change the mode.
            v.vic <= 64 && v.native ? v.vic | 0x80 : v.vic & 0xff,
          ),
        )
      : null,
    audio: ext.audioDescriptors.length
      ? block(1, ext.audioDescriptors.flatMap(encodeAudioDescriptor))
      : null,
    speaker: ext.speakerAllocation !== undefined ? block(4, [ext.speakerAllocation & 0xff, 0, 0]) : null,
    hdmi: ext.hdmiVsdb ? encodeHdmiVsdb(ext.hdmiVsdb) : null,
    videoCapability: ext.videoCapability ? encodeVideoCapability(ext.videoCapability) : null,
    colorimetry: ext.colorimetry ? encodeColorimetry(ext.colorimetry) : null,
    hdr: ext.hdrStaticMetadata ? encodeHdr(ext.hdrStaticMetadata) : null,
    ycbcr420Only: ext.ycbcr420OnlyVics.length
      ? extBlock(14, ext.ycbcr420OnlyVics.map((v) => v & 0xff))
      : null,
    ycbcr420Also: ext.ycbcr420AlsoVics.length ? encodeYcbcr420Map(ext.ycbcr420AlsoVics) : null,
    hdmiForum: ext.hdmiForumVsdb ? encodeHdmiForumVsdb(ext.hdmiForumVsdb) : null,
  }
}

function encodeYcbcr420Map(indices: number[]): number[] {
  // A capability MAP, indexed by position in the video data block — not a
  // list of VICs. Bit N set means SVD N also works as 4:2:0.
  const bytes: number[] = []
  for (const idx of indices) {
    const byte = idx >> 3
    while (bytes.length <= byte) bytes.push(0)
    bytes[byte] |= 1 << (idx & 7)
  }
  return extBlock(15, bytes)
}

/**
 * The data block collection. A decoded block keeps its original order, and
 * each block whose fields are unedited goes back out as the bytes it came in
 * as. A field that has been edited is re-encoded where its block was; one the
 * decoded EDID never had is appended, in this encoder's own order.
 */
function encodeDataBlocks(ext: CtaExtension): number[] {
  const fresh = freshBlocks(ext)
  const dbc: number[] = []
  const done = new Set<CtaBlockKey>()
  let unknown = 0

  for (const b of ext.source?.blocks ?? []) {
    if (b.key === 'unknown') {
      // Unmodelled blocks are their own model: take them in turn, so one
      // removed from the list drops out rather than shifting the rest.
      if (unknown < ext.unknownBlocks.length) dbc.push(...ext.unknownBlocks[unknown++])
      continue
    }
    const now = fresh[b.key]
    if (!now) continue
    if (modelOf(ext, b.key) === b.model) {
      // Unedited: every block of this kind goes back verbatim, where it was.
      dbc.push(...b.bytes)
    } else if (!done.has(b.key)) {
      // Edited: one fresh block in the first one's place, the rest dropped
      // (the decoder merged them into this one field).
      dbc.push(...now)
    }
    done.add(b.key)
  }

  for (const [key, bytes] of Object.entries(fresh) as [CtaBlockKey, number[] | null][]) {
    if (bytes && !done.has(key)) dbc.push(...bytes)
  }
  for (; unknown < ext.unknownBlocks.length; unknown++) dbc.push(...ext.unknownBlocks[unknown])
  return dbc
}

export function encodeCta(ext: CtaExtension): number[] {
  // Nothing edited at all: the original block, down to its padding.
  if (ext.source && wholeModelOf(ext) === ext.source.model) {
    return [...ext.source.bytes, checksum(ext.source.bytes)]
  }

  const dbc = encodeDataBlocks(ext)

  const dtds = ext.detailedTimings.flatMap(encodeDtd)
  const dtdOffset = 4 + dbc.length

  if (dtdOffset + dtds.length > 127) {
    throw new Error(
      `CTA extension overflows: ${dbc.length} bytes of data blocks plus ` +
        `${ext.detailedTimings.length} detailed timings needs ${dtdOffset + dtds.length} of 127 bytes. ` +
        `Drop a timing, or move it to a DisplayID block.`,
    )
  }

  const nativeDtds = Math.min(ext.detailedTimings.length, ext.source?.nativeDtds ?? 15, 15)
  const out = [
    0x02,
    ext.revision,
    // Byte 2 is where the timings start, and so where the data blocks end:
    // it is owed whenever there are blocks, timings or not. Zero means no
    // timings AND no data blocks (CTA-861-H 7.3.3), and Linux
    // (`cea_db_collection_size`) and edid-decode read no blocks behind it, so
    // a VIC-only block written with 0 reached a Linux source as a DVI sink.
    // A block with neither keeps 0, the spec's own spelling of empty.
    dtds.length || dbc.length ? dtdOffset : 0,
    (ext.underscanIt ? 0x80 : 0) |
      (ext.basicAudio ? 0x40 : 0) |
      (ext.ycbcr444 ? 0x20 : 0) |
      (ext.ycbcr422 ? 0x10 : 0) |
      nativeDtds,
    ...dbc,
    ...dtds,
  ]
  while (out.length < 127) out.push(0)
  out.push(checksum(out))
  return out
}

// ------------------------------------------------------------------- decode

function decodeAudioDescriptor(b: number[]): AudioDescriptor {
  const format = (b[0] >> 3) & 0x0f
  const a: AudioDescriptor = {
    format,
    channels: (b[0] & 0x07) + 1,
    rates: CTA_AUDIO_RATES.filter((_, i) => b[1] & (1 << i)) as unknown as number[],
  }
  if (format === 1) {
    a.lpcmDepths = [16, 20, 24].filter((_, i) => b[2] & (1 << i))
  } else {
    a.maxBitrateKbps = b[2] * 8
  }
  return a
}

export function decodeCta(bytes: number[]): CtaExtension {
  const ext: CtaExtension = {
    kind: 'cta',
    revision: bytes[1],
    underscanIt: !!(bytes[3] & 0x80),
    basicAudio: !!(bytes[3] & 0x40),
    ycbcr444: !!(bytes[3] & 0x20),
    ycbcr422: !!(bytes[3] & 0x10),
    videoDescriptors: [],
    audioDescriptors: [],
    ycbcr420OnlyVics: [],
    ycbcr420AlsoVics: [],
    detailedTimings: [],
    unknownBlocks: [],
  }

  const dtdOffset = bytes[2]
  // Offset 0 means "no detailed timings", NOT "timings start at byte 0". By
  // the spec it means no data blocks either, but blocks written behind a 0 are
  // read anyway, up to the padding: Otter itself wrote VIC-only blocks that
  // way until 2026-10-24, and they should open to be fixed. decode.ts warns.
  const dbcEnd = dtdOffset === 0 ? 127 : dtdOffset

  const read: { key: CtaBlockKey; bytes: number[] }[] = []
  let i = 4
  while (i < dbcEnd && i < 127) {
    const tag = bytes[i] >> 5
    const len = bytes[i] & 0x1f
    if (len === 0 && tag === 0) break // padding
    const payload = bytes.slice(i + 1, i + 1 + len)
    const whole = bytes.slice(i, i + 1 + len)
    let key: CtaBlockKey = 'unknown'

    switch (tag) {
      case 1:
        key = 'audio'
        for (let k = 0; k + 2 < payload.length + 1 && k + 3 <= payload.length; k += 3) {
          ext.audioDescriptors.push(decodeAudioDescriptor(payload.slice(k, k + 3)))
        }
        break
      case 2:
        key = 'video'
        for (const v of payload) {
          // Bit 7 is a native flag only up to VIC 64; above that it is data.
          const vic = v & 0x7f
          ext.videoDescriptors.push(
            vic <= 64 ? { vic, native: !!(v & 0x80) } : { vic: v, native: false },
          )
        }
        break
      case 3:
        if (payload[0] === 0x03 && payload[1] === 0x0c && payload[2] === 0x00) {
          const v: HdmiVsdb = {
            physicalAddress: [payload[3] >> 4, payload[3] & 0xf, payload[4] >> 4, payload[4] & 0xf],
            supportsAi: !!(payload[5] & 0x80),
            deepColor48: !!(payload[5] & 0x40),
            deepColor36: !!(payload[5] & 0x20),
            deepColor30: !!(payload[5] & 0x10),
            deepColorY444: !!(payload[5] & 0x08),
            dviDual: !!(payload[5] & 0x01),
            maxTmdsClockMHz: payload.length > 6 ? payload[6] * 5 : 0,
          }
          ext.hdmiVsdb = v
          key = 'hdmi'
        } else if (payload[0] === 0xd8 && payload[1] === 0x5d && payload[2] === 0xc4) {
          const p = payload.slice(3)
          const v: HdmiForumVsdb = {
            version: p[0],
            maxTmdsCharacterRateMHz: (p[1] ?? 0) * 5,
            scdcPresent: !!(p[2] & 0x80),
            rrCapable: !!(p[2] & 0x40),
            lte340ScrambleSupported: !!(p[2] & 0x08),
            maxFrlRate: (p[3] >> 4) & 0x0f,
            deepColor420_48: !!(p[3] & 0x04),
            deepColor420_36: !!(p[3] & 0x02),
            deepColor420_30: !!(p[3] & 0x01),
            mDelta: !!(p[4] & 0x80),
            cinemaVrr: !!(p[4] & 0x40),
            cnmVrr: !!(p[4] & 0x20),
            fvaSupported: !!(p[4] & 0x10),
            allmSupported: !!(p[4] & 0x08),
            vrrMin: p.length > 5 ? p[5] & 0x3f : 0,
            vrrMax: p.length > 6 ? (((p[5] >> 6) & 0x03) << 8) | p[6] : 0,
            dscCapable: p.length > 7 ? !!(p[7] & 0x80) : false,
            dscNative420: p.length > 7 ? !!(p[7] & 0x40) : false,
            qmsSupported: p.length > 7 ? !!(p[7] & 0x20) : false,
            dscAllBpp: p.length > 7 ? !!(p[7] & 0x10) : false,
            dsc12bpc: p.length > 7 ? !!(p[7] & 0x04) : false,
            dsc10bpc: p.length > 7 ? !!(p[7] & 0x02) : false,
            dscMaxFrlRate: p.length > 8 ? (p[8] >> 4) & 0x0f : 0,
            dscMaxSlices: p.length > 8 ? p[8] & 0x0f : 0,
            dscTotalChunkKBytes: p.length > 9 ? p[9] & 0x3f : 0,
            qmsTfrMin: false,
            qmsTfrMax: false,
          }
          ext.hdmiForumVsdb = v
          key = 'hdmiForum'
        } else {
          ext.unknownBlocks.push(whole)
        }
        break
      case 4:
        ext.speakerAllocation = payload[0]
        key = 'speaker'
        break
      case 7: {
        const et = payload[0]
        const body = payload.slice(1)
        if (et === 0) {
          key = 'videoCapability'
          ext.videoCapability = {
            qySelectableYcc: !!(body[0] & 0x80),
            qsSelectableRgb: !!(body[0] & 0x40),
            ptScan: ((body[0] >> 4) & 3) as 0 | 1 | 2 | 3,
            itScan: ((body[0] >> 2) & 3) as 0 | 1 | 2 | 3,
            ceScan: (body[0] & 3) as 0 | 1 | 2 | 3,
          }
        } else if (et === 5) {
          key = 'colorimetry'
          ext.colorimetry = {
            xvYCC601: !!(body[0] & 0x01),
            xvYCC709: !!(body[0] & 0x02),
            sYCC601: !!(body[0] & 0x04),
            opYCC601: !!(body[0] & 0x08),
            opRGB: !!(body[0] & 0x10),
            bt2020cYCC: !!(body[0] & 0x20),
            bt2020YCC: !!(body[0] & 0x40),
            bt2020RGB: !!(body[0] & 0x80),
            dciP3: !!(body[1] & 0x80),
            md: [!!(body[1] & 1), !!(body[1] & 2), !!(body[1] & 4), !!(body[1] & 8)],
          }
        } else if (et === 6) {
          key = 'hdr'
          const h: HdrStaticMetadata = {
            eotfSdr: !!(body[0] & 0x01),
            eotfHdr: !!(body[0] & 0x02),
            eotfSmpte2084: !!(body[0] & 0x04),
            eotfHlg: !!(body[0] & 0x08),
            staticMetadataType1: !!(body[1] & 0x01),
          }
          if (body.length > 2) h.maxLuminance = body[2]
          if (body.length > 3) h.maxFrameAverageLuminance = body[3]
          if (body.length > 4) h.minLuminance = body[4]
          ext.hdrStaticMetadata = h
        } else if (et === 14) {
          key = 'ycbcr420Only'
          ext.ycbcr420OnlyVics = body.slice()
        } else if (et === 15) {
          key = 'ycbcr420Also'
          body.forEach((byte, bi) => {
            for (let bit = 0; bit < 8; bit++) {
              if (byte & (1 << bit)) ext.ycbcr420AlsoVics.push(bi * 8 + bit)
            }
          })
        } else {
          ext.unknownBlocks.push(whole)
        }
        break
      }
      default:
        ext.unknownBlocks.push(whole)
    }
    read.push({ key, bytes: whole })
    i += 1 + len
  }

  if (dtdOffset >= 4) {
    for (let p = dtdOffset; p + 18 <= 127; p += 18) {
      const chunk = bytes.slice(p, p + 18)
      if (chunk[0] === 0 && chunk[1] === 0) break // padding or a display descriptor
      const dtd = decodeDtd(chunk)
      if (dtd) ext.detailedTimings.push(dtd as DetailedTimingDescriptor)
    }
  }

  ext.source = {
    bytes: bytes.slice(0, 127),
    model: wholeModelOf(ext),
    blocks: read.map(({ key, bytes }) => ({
      key,
      bytes,
      model: key === 'unknown' ? '' : modelOf(ext, key),
    })),
    nativeDtds: bytes[3] & 0x0f,
  }
  return ext
}
