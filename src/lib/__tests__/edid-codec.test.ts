import { describe, expect, it } from 'vitest'
import { blankEdid, emptyCta } from '../edid/defaults.ts'
import { checksum, encodeDtd, encodeEdid, encodeManufacturer, EncodeError } from '../edid/encode.ts'
import { decodeCta, encodeCta } from '../edid/cta861.ts'
import tiles from './fixtures/reference-tiles.json'
import { decodeEdid, parseEdidFile } from '../edid/decode.ts'
import { decodeDtd } from '../edid/decode-dtd.ts'
import { decodeType7Timing, encodeType7Timing } from '../edid/displayid.ts'
import { ctaByVic } from '../timing/cta.ts'
import { cvtRb } from '../timing/cvt.ts'
import { linuxDataBlocks, linuxHdmiVsdb } from './linux-cta.ts'
import type { CtaExtension, DetailedTimingDescriptor, DisplayIdExtension } from '../edid/types.ts'

const dtdOf = (t: ReturnType<typeof cvtRb>): DetailedTimingDescriptor => ({
  kind: 'dtd',
  timing: t,
  hSizeMm: 0,
  vSizeMm: 0,
  hBorder: 0,
  vBorder: 0,
  syncType: 'digital-separate',
  stereo: 'none',
})

describe('structure', () => {
  it('produces a 128-byte block with a valid checksum', () => {
    const bytes = encodeEdid(blankEdid())
    expect(bytes.length).toBe(128)
    expect(bytes.reduce((a, b) => a + b, 0) % 256).toBe(0)
  })

  it('writes the fixed header', () => {
    const b = encodeEdid(blankEdid())
    expect([...b.slice(0, 8)]).toEqual([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00])
  })

  it('grows by exactly one block per extension and records the count at byte 126', () => {
    const e = blankEdid()
    e.extensions.push(emptyCta())
    const b = encodeEdid(e)
    expect(b.length).toBe(256)
    expect(b[126]).toBe(1)
    expect(b.slice(128).reduce((a, x) => a + x, 0) % 256).toBe(0)
  })
})

describe('manufacturer id', () => {
  it('packs three 5-bit letters big-endian with A = 1', () => {
    // 'ABC' -> 1,2,3 -> 0b00001_00010_00011 -> 0x0443
    expect(encodeManufacturer('ABC')).toEqual([0x04, 0x43])
  })

  it('round-trips through the decoder', () => {
    for (const id of ['ABC', 'ZZZ', 'AAA', 'OTR', 'DEL']) {
      const e = blankEdid()
      e.manufacturerId = id
      expect(decodeEdid(encodeEdid(e)).edid.manufacturerId).toBe(id)
    }
  })

  it('refuses anything that is not three letters, rather than silently truncating', () => {
    expect(() => encodeManufacturer('AB')).toThrow(EncodeError)
    expect(() => encodeManufacturer('AB1')).toThrow(EncodeError)
    expect(() => encodeManufacturer('ABCD')).toThrow(EncodeError)
  })
})

describe('detailed timing descriptors', () => {
  it('round-trips a reduced-blanking mode byte for byte', () => {
    const d = dtdOf(cvtRb(1920, 1200, { refreshHz: 60 }))
    const back = decodeDtd(encodeDtd(d))!
    expect(back.timing).toEqual(d.timing)
  })

  it('round-trips every CTA mode a DTD can hold', () => {
    for (const t of [ctaByVic(16)!, ctaByVic(31)!, ctaByVic(97)!, ctaByVic(4)!]) {
      const back = decodeDtd(encodeDtd(dtdOf(t)))!
      expect(back.timing.hActive).toBe(t.hActive)
      expect(back.timing.vActive).toBe(t.vActive)
      expect(back.timing.pixelClockHz).toBe(t.pixelClockHz)
      expect(back.timing.hSyncPositive).toBe(t.hSyncPositive)
      expect(back.timing.vSyncPositive).toBe(t.vSyncPositive)
    }
  })

  it('refuses a clock above 655.35 MHz instead of wrapping it', () => {
    // 2160p120 is 1188 MHz — the classic case where a DTD simply cannot help.
    const d = dtdOf({ ...ctaByVic(118)! })
    expect(() => encodeDtd(d)).toThrow(/DisplayID/)
  })

  it('keeps sync polarity out of the flags for analog sync types', () => {
    const d = dtdOf(cvtRb(1280, 720, { refreshHz: 60 }))
    d.syncType = 'analog-composite'
    const back = decodeDtd(encodeDtd(d))!
    expect(back.syncType).toBe('analog-composite')
    expect(back.timing.hSyncPositive).toBe(false)
  })
})

describe('DisplayID Type VII', () => {
  it('round-trips 2160p120, which no DTD can express', () => {
    const t = ctaByVic(118)!
    const enc = encodeType7Timing({ timing: t, preferred: true, aspect: '16:9', fractional: false })
    expect(enc.length).toBe(20)
    const back = decodeType7Timing(enc)
    expect(back.timing.pixelClockHz).toBe(1_188_000_000)
    expect(back.timing.hActive).toBe(3840)
    expect(back.timing.vActive).toBe(2160)
    expect(back.timing.hFront).toBe(t.hFront)
    expect(back.timing.vSync).toBe(t.vSync)
    expect(back.preferred).toBe(true)
  })

  it('stores every count minus one — an off-by-one here shifts the whole picture', () => {
    const t = ctaByVic(97)!
    const enc = encodeType7Timing({ timing: t, preferred: false, aspect: '16:9', fractional: false })
    // hActive 3840 is stored as 3839 = 0x0EFF, little-endian.
    expect(enc[4]).toBe(0xff)
    expect(enc[5]).toBe(0x0e)
  })

  it('survives a whole-EDID round trip inside an extension block', () => {
    const e = blankEdid()
    const ext: DisplayIdExtension = {
      kind: 'displayid',
      version: 0x20,
      primaryUseCase: 3,
      extensionCount: 0,
      type7Timings: [{ timing: ctaByVic(118)!, preferred: true, aspect: '16:9', fractional: false }],
      unknownBlocks: [],
    }
    e.extensions.push(ext)
    const back = decodeEdid(encodeEdid(e))
    const got = back.edid.extensions[0] as DisplayIdExtension
    expect(back.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(got.kind).toBe('displayid')
    expect(got.type7Timings[0].timing.pixelClockHz).toBe(1_188_000_000)
  })
})

describe('CTA extension', () => {
  it('round-trips video descriptors, audio, HDR and the HDMI VSDBs', () => {
    const e = blankEdid()
    const cta = emptyCta()
    cta.videoDescriptors = [
      { vic: 97, native: false },
      { vic: 16, native: true },
      { vic: 96, native: false },
    ]
    cta.basicAudio = true
    cta.audioDescriptors = [{ format: 1, channels: 2, rates: [32, 44.1, 48], lpcmDepths: [16, 20, 24] }]
    cta.hdmiVsdb = {
      physicalAddress: [1, 0, 0, 0],
      supportsAi: false,
      deepColor30: true,
      deepColor36: true,
      deepColor48: false,
      deepColorY444: true,
      dviDual: false,
      maxTmdsClockMHz: 600,
    }
    cta.hdmiForumVsdb = {
      version: 1,
      maxTmdsCharacterRateMHz: 600,
      scdcPresent: true,
      rrCapable: true,
      lte340ScrambleSupported: true,
      deepColor420_30: true,
      deepColor420_36: false,
      deepColor420_48: false,
      maxFrlRate: 6,
      dscCapable: true,
      dsc10bpc: true,
      dsc12bpc: true,
      dscNative420: false,
      dscAllBpp: true,
      dscMaxFrlRate: 6,
      dscMaxSlices: 8,
      dscTotalChunkKBytes: 4,
      vrrMin: 24,
      vrrMax: 120,
      qmsSupported: true,
      qmsTfrMin: false,
      qmsTfrMax: false,
      allmSupported: true,
      fvaSupported: false,
      cnmVrr: false,
      cinemaVrr: false,
      mDelta: false,
    }
    cta.hdrStaticMetadata = {
      eotfSdr: true,
      eotfHdr: false,
      eotfSmpte2084: true,
      eotfHlg: true,
      staticMetadataType1: true,
      maxLuminance: 116,
      maxFrameAverageLuminance: 100,
      minLuminance: 12,
    }
    e.extensions.push(cta)

    const { edid, issues } = decodeEdid(encodeEdid(e))
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    const got = edid.extensions[0] as typeof cta

    expect(got.videoDescriptors).toEqual(cta.videoDescriptors)
    expect(got.audioDescriptors[0].rates).toEqual([32, 44.1, 48])
    expect(got.hdmiVsdb!.maxTmdsClockMHz).toBe(600)
    expect(got.hdmiForumVsdb!.maxFrlRate).toBe(6)
    expect(got.hdmiForumVsdb!.vrrMin).toBe(24)
    expect(got.hdmiForumVsdb!.vrrMax).toBe(120)
    expect(got.hdmiForumVsdb!.dscCapable).toBe(true)
    expect(got.hdrStaticMetadata!.eotfSmpte2084).toBe(true)
    expect(got.hdrStaticMetadata!.minLuminance).toBe(12)
  })

  it('does not set the native flag on VICs above 64, where bit 7 is data', () => {
    const e = blankEdid()
    const cta = emptyCta()
    // Asking for native on VIC 97 is not representable: bit 7 is part of the
    // code there. It must come back as 97-not-native, NOT as VIC 225.
    cta.videoDescriptors = [{ vic: 97, native: true }]
    e.extensions.push(cta)
    const got = decodeEdid(encodeEdid(e)).edid.extensions[0] as typeof cta
    expect(got.videoDescriptors[0]).toEqual({ vic: 97, native: false })
  })

  it('reports an overflow rather than writing past the block', () => {
    const e = blankEdid()
    const cta = emptyCta()
    cta.detailedTimings = new Array(8).fill(dtdOf(cvtRb(1920, 1080, { refreshHz: 60 })))
    e.extensions.push(cta)
    expect(() => encodeEdid(e)).toThrow(/overflows/)
  })
})

// A real device's EDID: the PixelHue Q8 base + CTA that mosaic.ts carries as
// REFERENCE_B64 (the same bytes, copied so a mosaic change cannot move this
// test). Its CTA block lays its data blocks out in an order the encoder would
// not choose (HDMI Forum VSDB before HDMI VSDB, video capability last) and
// its HDMI Forum VSDB stops a byte short of the one the encoder writes.
const PIXELHUE_Q8 = Uint8Array.from(
  atob(
    'AP///////wA59l7kAQEBAQIfAQTFAAB4GjExpVVOoSYMUFQlTwDRwLMAlQCBgIFAgcABAQEBTdAAoPBwPoAwIDUAX1khAAAY' +
      'AAAA/QAX8A//PAAKICAgICAgAAAA/ABsZWZ0CiAgICAgICAgAAAAEQAAAAAAAAAAAAAAAAAAAnICAyV0SWtakB8iZmVkYyMP' +
      'Bwdn2F3EAXiAAGcDDAAAADhE4gBPKGgAoPBwPoAwIDUAX1khAAAY72gAoKBALmAwIDYA4A4RAAAYNTyAoHCwI0AwIDYA4A4R' +
      'AAAYAjqAGHE4LUBYLEUA4A4RAAAYAAAAAAAAAAAAAAAAAAAAAAAA9A==',
  ),
  (c) => c.charCodeAt(0),
)
const q8Cta = () => [...PIXELHUE_Q8.slice(128)]
const ctaOf = (bytes: number[]) => decodeCta(bytes)
const reencode = (ext: CtaExtension) => encodeCta(ext)
/** The data block collection as a list of blocks, headers included. */
function dataBlocks(b: number[]): number[][] {
  const out: number[][] = []
  // Offset 0 means no timings, so the blocks run until the zero padding.
  const end = b[2] || 127
  for (let i = 4; i < end && b[i]; i += 1 + (b[i] & 0x1f)) out.push(b.slice(i, i + 1 + (b[i] & 0x1f)))
  return out
}

describe('decoding a real CTA block and saving it back', () => {
  it('reproduces an unedited PixelHue Q8 CTA block byte for byte', () => {
    const { edid } = decodeEdid(PIXELHUE_Q8)
    // Only the CTA block: this copy's base block claims a second extension it
    // does not carry, and the encoder writes the count it actually has.
    expect([...encodeEdid(edid).slice(128)]).toEqual(q8Cta())
  })

  // Mosaic mode never re-encodes its tiles, but an imported one must survive
  // the editor all the same: base, this CTA block, and the DisplayID block.
  for (const c of tiles.cases) {
    for (const t of c.tiles) {
      it(`reproduces the mosaic tile ${t.file} whole`, () => {
        const b = Uint8Array.from(t.hex.match(/../g)!.map((x) => parseInt(x, 16)))
        expect([...encodeEdid(decodeEdid(b).edid)]).toEqual([...b])
      })
    }
  }

  it('keeps every untouched data block where it was when one header flag changes', () => {
    const ext = ctaOf(q8Cta())
    ext.basicAudio = false
    const out = reencode(ext)
    const want = q8Cta()
    want[3] &= ~0x40
    want[127] = checksum(want.slice(0, 127))
    expect(out).toEqual(want)
  })

  it('re-encodes an edited block in its own slot and leaves the others alone', () => {
    const orig = q8Cta()
    const ext = ctaOf(orig)
    ext.hdmiForumVsdb = { ...ext.hdmiForumVsdb!, maxTmdsCharacterRateMHz: 340 }
    const before = dataBlocks(orig)
    const after = dataBlocks(reencode(ext))
    expect(after.map((b) => b[0] >> 5)).toEqual(before.map((b) => b[0] >> 5))
    expect(after[2].slice(1, 4)).toEqual([0xd8, 0x5d, 0xc4])
    expect(after[2][5]).toBe(340 / 5)
    for (const k of [0, 1, 3, 4]) expect(after[k]).toEqual(before[k])
    expect(decodeCta(reencode(ext)).detailedTimings).toEqual(ext.detailedTimings)
  })

  it('drops a removed block and appends a new one after the originals', () => {
    const orig = q8Cta()
    const ext = ctaOf(orig)
    ext.audioDescriptors = []
    ext.hdrStaticMetadata = {
      eotfSdr: true,
      eotfHdr: false,
      eotfSmpte2084: true,
      eotfHlg: false,
      staticMetadataType1: true,
    }
    const before = dataBlocks(orig)
    const after = dataBlocks(reencode(ext))
    expect(after.slice(0, 4)).toEqual([before[0], ...before.slice(2)])
    expect(after[4].slice(0, 2)).toEqual([0xe3, 6])
  })

  it('keeps an unmodelled block in place, and lets it be removed', () => {
    const e = blankEdid()
    const cta = emptyCta()
    cta.videoDescriptors = [{ vic: 16, native: true }]
    cta.unknownBlocks = [[0x62, 0xaa, 0xbb]] // a tag-3 VSDB with an OUI nobody models
    e.extensions.push(cta)
    const built = [...encodeEdid(e).slice(128)]
    // Move the unknown block in front, as a device might have it.
    const hand = [...built]
    hand.splice(4, 5, 0x62, 0xaa, 0xbb, 0x41, 0x90)
    hand[127] = checksum(hand.slice(0, 127))
    const ext = ctaOf(hand)
    expect(reencode(ext)).toEqual(hand)
    ext.speakerAllocation = 1
    expect(dataBlocks(reencode(ext))[0]).toEqual([0x62, 0xaa, 0xbb])
    ext.unknownBlocks = []
    expect(dataBlocks(reencode(ext)).map((b) => b[0] >> 5)).toEqual([2, 4])
  })
})

describe('the data block offset, byte 2', () => {
  // What a VIC-only build wrote before 2026-10-24, LivePremier Plus's 1080p60
  // 12-bit among them: video, HDMI VSDB and colorimetry blocks behind a zero.
  const legacy = () => {
    const b = [0x02, 0x03, 0x00, 0xb0, 0x41, 0x90, 0x67, 0x03, 0x0c, 0x00, 0x10, 0x00, 0x38, 0x2d, 0xe3, 0x05, 0xc0, 0x00]
    while (b.length < 127) b.push(0)
    return [...b, checksum(b)]
  }
  const withCta = (cta: CtaExtension) => {
    const e = blankEdid()
    e.extensions.push(cta)
    return encodeEdid(e)
  }

  it('is 4 plus the data blocks with or without timings, and 0 only when there is neither', () => {
    const cta = emptyCta()
    expect(reencode(cta)[2]).toBe(0)
    cta.detailedTimings = [dtdOf(cvtRb(1920, 1080, { refreshHz: 60 }))]
    expect(reencode(cta)[2]).toBe(4)
    cta.videoDescriptors = [{ vic: 16, native: true }]
    expect(reencode(cta)[2]).toBe(6)
    cta.detailedTimings = []
    expect(reencode(cta)[2]).toBe(6)
    expect(linuxDataBlocks(reencode(cta))).toEqual([[0x41, 0x90]])
  })

  it('still reads an old block with data blocks behind a zero, and says Linux will not', () => {
    expect(linuxDataBlocks(legacy())).toEqual([])
    const { edid, issues } = decodeEdid(withCta(ctaOf(legacy())))
    const got = edid.extensions[0] as CtaExtension
    expect(got.videoDescriptors).toEqual([{ vic: 16, native: true }])
    expect(got.hdmiVsdb!.maxTmdsClockMHz).toBe(225)
    expect(got.colorimetry!.bt2020RGB).toBe(true)
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/byte 2 is 0.*3 follow/) }))
  })

  it('does not warn about a zero on a block that really is empty', () => {
    expect(decodeEdid(withCta(emptyCta())).issues).toEqual([])
  })

  it('saves an old block back unedited as it came, and fixes it on any edit', () => {
    const ext = ctaOf(legacy())
    expect(reencode(ext)).toEqual(legacy())
    ext.basicAudio = true
    const fixed = reencode(ext)
    expect(fixed[2]).toBe(18)
    expect(fixed.slice(4, 18)).toEqual(legacy().slice(4, 18))
    expect(linuxHdmiVsdb(fixed)).toEqual({ maxTmdsClockMHz: 225 })
  })
})

describe('base block fields', () => {
  it('round-trips descriptors, gamma, established and standard timings', () => {
    const e = blankEdid()
    e.gamma = 2.4
    e.screenWidthCm = 160
    e.screenHeightCm = 90
    e.established['1024x768 @60'] = true
    e.established['800x600 @60'] = true
    e.standardTimings[0] = { hActive: 1920, aspect: '16:9', refreshHz: 60 }
    e.standardTimings[1] = { hActive: 1280, aspect: '4:3', refreshHz: 75 }
    e.descriptors = [
      dtdOf(cvtRb(1920, 1080, { refreshHz: 60 })),
      { kind: 'name', text: 'Otter Test' },
      {
        kind: 'range',
        minVerticalHz: 24,
        maxVerticalHz: 120,
        minHorizontalKHz: 15,
        maxHorizontalKHz: 200,
        maxPixelClockMHz: 600,
        support: 'cvt',
        cvt: {
          version: 0x11,
          maxActivePixelsPerLine: 3840,
          supportedAspects: ['16:9', '16:10'],
          preferredAspect: '16:9',
          reducedBlanking: true,
          standardBlanking: false,
          scalingHorizontalShrink: false,
          scalingHorizontalStretch: false,
          scalingVerticalShrink: false,
          scalingVerticalStretch: false,
          preferredRefreshHz: 60,
        },
      },
      { kind: 'established-iii', modes: ['1920x1200 @60 RB', '1600x1200 @60'] },
    ]

    const { edid } = decodeEdid(encodeEdid(e))
    expect(edid.gamma).toBeCloseTo(2.4, 2)
    expect(edid.screenWidthCm).toBe(160)
    expect(edid.established['1024x768 @60']).toBe(true)
    expect(edid.established['640x480 @60']).toBeUndefined()
    expect(edid.standardTimings[0]).toEqual({ hActive: 1920, aspect: '16:9', refreshHz: 60 })
    expect(edid.standardTimings[1]).toEqual({ hActive: 1280, aspect: '4:3', refreshHz: 75 })
    expect(edid.standardTimings[2]).toBeNull()
    expect(edid.descriptors[1]).toEqual({ kind: 'name', text: 'Otter Test' })

    const range = edid.descriptors[2] as { kind: 'range'; maxPixelClockMHz: number; cvt?: { maxActivePixelsPerLine: number } }
    expect(range.maxPixelClockMHz).toBe(600)
    expect(range.cvt!.maxActivePixelsPerLine).toBe(3840)

    // A bitmap has no order: the decoder always reports bit order, whatever
    // order the modes were listed in. Compare as a set.
    const est3 = edid.descriptors[3] as { kind: 'established-iii'; modes: string[] }
    expect([...est3.modes].sort()).toEqual(['1600x1200 @60', '1920x1200 @60 RB'])
  })

  it('rounds the range descriptor pixel clock UP, never down', () => {
    const e = blankEdid()
    e.descriptors[0] = {
      kind: 'range',
      minVerticalHz: 24,
      maxVerticalHz: 60,
      minHorizontalKHz: 15,
      maxHorizontalKHz: 100,
      maxPixelClockMHz: 594,
      support: 'range-limits-only',
    }
    const back = decodeEdid(encodeEdid(e)).edid.descriptors[0] as { maxPixelClockMHz: number }
    // 594 is not a multiple of 10; advertising 590 would lose 2160p60.
    expect(back.maxPixelClockMHz).toBe(600)
  })

  it('uses the +255 offset flags for rates that overflow a byte', () => {
    const e = blankEdid()
    e.descriptors[0] = {
      kind: 'range',
      minVerticalHz: 48,
      maxVerticalHz: 360,
      minHorizontalKHz: 200,
      maxHorizontalKHz: 400,
      maxPixelClockMHz: 1200,
      support: 'range-limits-only',
    }
    const back = decodeEdid(encodeEdid(e)).edid.descriptors[0] as {
      maxVerticalHz: number
      minVerticalHz: number
      maxHorizontalKHz: number
    }
    expect(back.maxVerticalHz).toBe(360)
    expect(back.minVerticalHz).toBe(48)
    expect(back.maxHorizontalKHz).toBe(400)
  })
})

describe('reading files', () => {
  it('flags a bad checksum instead of refusing the file', () => {
    const bytes = Array.from(encodeEdid(blankEdid()))
    bytes[127] = (bytes[127] + 1) & 0xff
    const { issues, edid } = decodeEdid(bytes)
    expect(issues.some((i) => i.severity === 'error' && /checksum/.test(i.message))).toBe(true)
    expect(edid.manufacturerId).toBe('OTR') // still parsed
  })

  it('accepts a hex dump in any of the usual shapings', () => {
    const bytes = encodeEdid(blankEdid())
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    const spaced = [...bytes].map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')
    const xxd = [...bytes]
      .reduce<string[]>((acc, b, i) => {
        if (i % 16 === 0) acc.push(`${(i).toString(16).padStart(8, '0')}: `)
        acc[acc.length - 1] += b.toString(16).padStart(2, '0') + ' '
        return acc
      }, [])
      .join('\n')

    for (const text of [hex, spaced, xxd]) {
      const r = parseEdidFile(text)
      expect(r.edid.manufacturerId).toBe('OTR')
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([])
    }
  })
})

describe('checksum', () => {
  it('is the value that makes the block sum to zero', () => {
    const b = new Array(127).fill(1)
    const c = checksum(b)
    expect(([...b, c].reduce((a, x) => a + x, 0)) % 256).toBe(0)
  })
})
