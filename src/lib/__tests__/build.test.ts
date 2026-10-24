import { describe, expect, it } from 'vitest'
import { buildEdid, edidAroundTiming, vicFor } from '../build.ts'
import type { SimpleRequest } from '../build.ts'
import { DEFAULT_SIGNAL } from '../link.ts'
import { encodeEdid } from '../edid/encode.ts'
import { decodeEdid } from '../edid/decode.ts'
import { primaryTiming } from '../primary.ts'
import { vFreq } from '../timing/types.ts'
import type { CtaExtension, DisplayIdExtension } from '../edid/types.ts'

const req = (o: Partial<SimpleRequest> = {}): SimpleRequest => ({
  name: 'Test',
  hActive: 1920,
  vActive: 1080,
  refreshHz: 60,
  standard: 'manual',
  interlaced: false,
  fractional: false,
  signal: { ...DEFAULT_SIGNAL },
  ...o,
})

/** Build, encode, decode — the only round trip that proves the whole chain. */
const roundTrip = (r: SimpleRequest) => {
  const built = buildEdid(r)
  const result = decodeEdid(encodeEdid(built.edid))
  return { built, ...result }
}

describe('simple build', () => {
  it('produces a valid EDID with no decode errors', () => {
    const { issues } = roundTrip(req())
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('picks the CTA raster for a mode that is a VIC, not a CVT re-derivation', () => {
    const { built } = roundTrip(req())
    expect(built.vic).toBe(16)
    expect(built.timing.pixelClockHz).toBe(148_500_000)
    // 2200x1125 is the CTA raster. CVT would give something else entirely.
    expect(built.timing.hActive + built.timing.hFront + built.timing.hSync + built.timing.hBack).toBe(2200)
  })

  it('writes the name where every input menu will read it', () => {
    const { edid } = roundTrip(req({ name: 'PDS4K-2160p60' }))
    expect(edid.descriptors.find((d) => d.kind === 'name')).toEqual({ kind: 'name', text: 'PDS4K-2160p60' })
  })

  it('always writes a range descriptor — an EDID 1.4 without one is malformed', () => {
    const { edid } = roundTrip(req())
    expect(edid.descriptors.some((d) => d.kind === 'range')).toBe(true)
  })

  it('gives the range descriptor a window, never a zero-width one', () => {
    const { edid } = roundTrip(req())
    const r = edid.descriptors.find((d) => d.kind === 'range') as { minVerticalHz: number; maxVerticalHz: number }
    expect(r.maxVerticalHz).toBeGreaterThan(r.minVerticalHz)
  })

  it('rounds the range clock up so the mode it exists for still fits', () => {
    const { edid } = roundTrip(req({ hActive: 3840, vActive: 2160 }))
    const r = edid.descriptors.find((d) => d.kind === 'range') as { maxPixelClockMHz: number }
    expect(r.maxPixelClockMHz).toBeGreaterThanOrEqual(594)
  })
})

describe('modes a DTD cannot hold', () => {
  it('moves 2160p120 into a DisplayID block and says so', () => {
    const { built, edid, issues } = roundTrip(req({ hActive: 3840, vActive: 2160, refreshHz: 120 }))
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(built.timing.pixelClockHz).toBe(1_188_000_000)
    expect(built.notes.join(' ')).toMatch(/above the 655\.35 MHz/)

    // No DTD anywhere claiming to be this mode...
    expect(edid.descriptors.some((d) => d.kind === 'dtd')).toBe(false)
    // ...and the real thing in a DisplayID Type VII block.
    const did = edid.extensions.find((e) => e.kind === 'displayid') as DisplayIdExtension
    expect(did).toBeDefined()
    expect(did.type7Timings[0].timing.pixelClockHz).toBe(1_188_000_000)
    expect(did.type7Timings[0].preferred).toBe(true)
  })

  it('finds that mode again as the primary timing after a round trip', () => {
    const { edid } = roundTrip(req({ hActive: 3840, vActive: 2160, refreshHz: 120 }))
    const t = primaryTiming(edid)!
    expect(t.pixelClockHz).toBe(1_188_000_000)
    expect(Math.round(vFreq(t))).toBe(120)
  })

  it('does not add a DisplayID block when a DTD would have done', () => {
    const { edid } = roundTrip(req())
    expect(edid.extensions.some((e) => e.kind === 'displayid')).toBe(false)
  })
})

describe('signal options reach the EDID', () => {
  it('DSC turns on the HDMI Forum block and states an FRL rate', () => {
    const { edid, built } = roundTrip(
      req({ hActive: 3840, vActive: 2160, refreshHz: 60, signal: { ...DEFAULT_SIGNAL, dsc: true } }),
    )
    const cta = edid.extensions.find((e) => e.kind === 'cta') as CtaExtension
    expect(cta.hdmiForumVsdb!.dscCapable).toBe(true)
    expect(cta.hdmiForumVsdb!.maxFrlRate).toBeGreaterThan(0)
    expect(built.notes.join(' ')).toMatch(/commits the link to FRL/)
  })

  it('the FRL rate it states for 4:2:2 is the one 8-bit 4:4:4 needs', () => {
    // 2160p120 is 1188 MHz: FRL at 24 bits per pixel whatever the 4:2:2
    // depth, which is 40G, not the 24G that 16 bits per pixel would claim.
    const rate = (o: Partial<typeof DEFAULT_SIGNAL>) => {
      const { edid } = roundTrip(req({ hActive: 3840, vActive: 2160, refreshHz: 120, signal: { ...DEFAULT_SIGNAL, ...o } }))
      return (edid.extensions.find((e) => e.kind === 'cta') as CtaExtension).hdmiForumVsdb!.maxFrlRate
    }
    expect(rate({})).toBe(5)
    expect(rate({ format: 'ycbcr422', bpc: 8 })).toBe(5)
    expect(rate({ format: 'ycbcr422', bpc: 12 })).toBe(5)
  })

  it('the TMDS ceiling is the rate the mode needs, rounded up to the 5 MHz step', () => {
    const cta = (o: Partial<SimpleRequest>, s: Partial<typeof DEFAULT_SIGNAL> = {}) =>
      roundTrip(req({ ...o, signal: { ...DEFAULT_SIGNAL, ...s } })).edid.extensions.find(
        (e) => e.kind === 'cta',
      ) as CtaExtension
    const uhd30 = { hActive: 3840, vActive: 2160, refreshHz: 30 }
    const uhd60 = { hActive: 3840, vActive: 2160, refreshHz: 60 }

    // 4K30 is 297 MHz. Rounded to the nearest step it went out as 295, below
    // the mode the EDID describes.
    expect(cta(uhd30).hdmiVsdb!.maxTmdsClockMHz).toBe(300)
    expect(cta({}).hdmiVsdb!.maxTmdsClockMHz).toBe(150)
    expect(cta({}, { bpc: 10 }).hdmiVsdb!.maxTmdsClockMHz).toBe(190)

    // 4:2:2 is clocked at the pixel clock whatever the depth: 1080p60 12-bit
    // needs 148.5 MHz, not the 222.75 that 12-bit 4:4:4 would.
    expect(cta({}, { format: 'ycbcr422', bpc: 12 }).hdmiVsdb!.maxTmdsClockMHz).toBe(150)
    // And 4K30 12-bit 4:2:2 is 297 MHz, which needs no scrambling, so no Forum block.
    const deep422 = cta(uhd30, { format: 'ycbcr422', bpc: 12 })
    expect(deep422.hdmiVsdb!.maxTmdsClockMHz).toBe(300)
    expect(deep422.hdmiForumVsdb).toBeUndefined()

    // 4:2:0 halves the clock but deep colour still multiplies it: 4K60 10-bit
    // is 371.25 MHz. Its Forum block, and its 10-bit 4:2:0 flag, stay.
    const deep420 = cta(uhd60, { format: 'ycbcr420', bpc: 10 })
    expect(deep420.hdmiVsdb!.maxTmdsClockMHz).toBe(375)
    expect(deep420.hdmiForumVsdb!.maxTmdsCharacterRateMHz).toBe(375)
    expect(deep420.hdmiForumVsdb!.deepColor420_30).toBe(true)
    expect(cta(uhd60, { format: 'ycbcr420' }).hdmiVsdb!.maxTmdsClockMHz).toBe(300)
  })

  it('VRR writes the window it was given, and survives the round trip', () => {
    const { edid } = roundTrip(
      req({ signal: { ...DEFAULT_SIGNAL, vrr: true, vrrMinHz: 48, vrrMaxHz: 144 } }),
    )
    const cta = edid.extensions.find((e) => e.kind === 'cta') as CtaExtension
    expect(cta.hdmiForumVsdb!.vrrMin).toBe(48)
    expect(cta.hdmiForumVsdb!.vrrMax).toBe(144)
    expect(cta.hdmiForumVsdb!.allmSupported).toBe(true)
  })

  it('a VRR maximum above 255 still round-trips — the field is 10 bits, not 8', () => {
    const { edid } = roundTrip(req({ signal: { ...DEFAULT_SIGNAL, vrr: true, vrrMinHz: 24, vrrMaxHz: 480 } }))
    const cta = edid.extensions.find((e) => e.kind === 'cta') as CtaExtension
    expect(cta.hdmiForumVsdb!.vrrMax).toBe(480)
  })

  it('4:2:0 states the VIC in the Y420 block only, never in both', () => {
    const { edid } = roundTrip(
      req({ hActive: 3840, vActive: 2160, refreshHz: 60, signal: { ...DEFAULT_SIGNAL, format: 'ycbcr420' } }),
    )
    const cta = edid.extensions.find((e) => e.kind === 'cta') as CtaExtension
    expect(cta.ycbcr420OnlyVics).toEqual([97])
    // Listing it in the ordinary VDB too would claim full-bandwidth support.
    expect(cta.videoDescriptors.map((v) => v.vic)).not.toContain(97)
  })

  it('deep colour sets the matching HDMI VSDB bits', () => {
    const { edid } = roundTrip(req({ signal: { ...DEFAULT_SIGNAL, bpc: 12 } }))
    const cta = edid.extensions.find((e) => e.kind === 'cta') as CtaExtension
    expect(cta.hdmiVsdb!.deepColor30).toBe(true)
    expect(cta.hdmiVsdb!.deepColor36).toBe(true)
    expect(cta.hdmiVsdb!.deepColor48).toBe(false)
  })
})

describe('fractional rates', () => {
  it('divides the clock by 1.001 and leaves the raster alone', () => {
    const whole = buildEdid(req()).timing
    const frac = buildEdid(req({ fractional: true })).timing
    expect(frac.hActive).toBe(whole.hActive)
    expect(frac.hFront).toBe(whole.hFront)
    expect(frac.pixelClockHz).toBeCloseTo((whole.pixelClockHz * 1000) / 1001, 0)
    expect(vFreq(frac)).toBeCloseTo(59.94, 2)
  })
})

describe('non-standard rasters', () => {
  it('builds an 8192x1080 wide format — the limit is the 12-bit field, not the clock', () => {
    const { built, edid, issues } = roundTrip(req({ hActive: 8192, vActive: 1080, refreshHz: 60 }))
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(built.vic).toBeUndefined()
    expect(built.timing.hActive).toBe(8192)
    // The clock is an unremarkable ~600 MHz; it is the 4095-pixel field that
    // forces this into DisplayID. Analog Way advertise exactly this format.
    expect(built.timing.pixelClockHz).toBeLessThan(655_350_000)
    expect(built.notes.join(' ')).toMatch(/12-bit field/)
    const did = edid.extensions.find((e) => e.kind === 'displayid')
    expect(did).toBeDefined()
  })

  it('warns when a requested standard cannot express the mode', () => {
    const { built } = roundTrip(req({ hActive: 5120, vActive: 1440, refreshHz: 75, standard: 'cta' }))
    expect(built.notes.join(' ')).toMatch(/not a CTA-861 VIC/)
    expect(built.resolvedStandard).toBe('cvt-rb2')
  })

  it('marks continuous frequency for a generated timing, but not for a table lookup', () => {
    expect(buildEdid(req({ standard: 'cvt-rb2' })).edid.features.continuousFrequency).toBe(true)
    expect(buildEdid(req({ standard: 'cta' })).edid.features.continuousFrequency).toBe(false)
  })
})

describe('edidAroundTiming — a timing somebody already chose', () => {
  // A switcher custom format: CVT-ish blanking nobody would re-derive the same way.
  const custom = {
    hActive: 2560, hFront: 48, hSync: 32, hBack: 80,
    vActive: 1440, vFront: 3, vSync: 5, vBack: 33,
    pixelClockHz: 241_500_000, interlaced: false, hSyncPositive: true, vSyncPositive: false,
  }

  it('keeps every porch and the clock (to the EDID 10 kHz step)', () => {
    const r = edidAroundTiming(custom, { name: 'CF1', signal: { ...DEFAULT_SIGNAL }, standard: 'manual' })
    const back = primaryTiming(decodeEdid(encodeEdid(r.edid)).edid)!
    expect({ ...back, pixelClockHz: 0 }).toEqual({ ...custom, pixelClockHz: 0 })
    expect(Math.abs(back.pixelClockHz - custom.pixelClockHz)).toBeLessThan(10_000)
  })

  it('is what buildEdid produces for the same solved timing', () => {
    const a = buildEdid(req())
    const b = edidAroundTiming(a.timing, { name: 'Test', signal: { ...DEFAULT_SIGNAL }, standard: a.resolvedStandard, vic: a.vic })
    expect([...encodeEdid(b.edid)]).toEqual([...encodeEdid(a.edid)])
  })
})

describe('vicFor', () => {
  const vic16 = buildEdid(req()).timing
  it('finds the VIC for its exact raster, whole or 1000/1001', () => {
    expect(vicFor(vic16)).toBe(16)
    expect(vicFor({ ...vic16, pixelClockHz: (vic16.pixelClockHz * 1000) / 1001 })).toBe(16)
  })
  it('does not call a same-size raster with other blanking a VIC', () => {
    expect(vicFor({ ...vic16, hFront: vic16.hFront + 8, hBack: vic16.hBack - 8 })).toBeUndefined()
  })
})
