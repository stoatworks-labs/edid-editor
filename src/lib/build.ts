import type { Edid, CtaExtension, DetailedTimingDescriptor, DisplayIdExtension } from './edid/types.ts'
import { blankEdid, emptyCta } from './edid/defaults.ts'
import { dtdLimit } from './edid/encode.ts'
import type { SignalOptions } from './link.ts'
import { FRL_EFFICIENCY, bitsPerPixel, tmdsCharacterRateHz } from './link.ts'
import { cvt, cvtRb, cvtRb2 } from './timing/cvt.ts'
import { gtf } from './timing/gtf.ts'
import { CTA_TIMINGS } from './timing/cta.ts'
import { DMT_TIMINGS } from './timing/dmt.ts'
import type { Timing, TimingStandard } from './timing/types.ts'
import { hFreq, hTotal, timingLabel, vFreq } from './timing/types.ts'

export interface SimpleRequest {
  name: string
  hActive: number
  vActive: number
  refreshHz: number
  standard: TimingStandard
  interlaced: boolean
  /** Use the 1000/1001 rate — 59.94 rather than 60. */
  fractional: boolean
  signal: SignalOptions
}

export interface BuildResult {
  edid: Edid
  timing: Timing
  /** Where the timing came from, once resolved. */
  resolvedStandard: TimingStandard
  /** A matching CTA VIC, when the mode is one. */
  vic?: number
  notes: string[]
}

const DTD = (t: Timing): DetailedTimingDescriptor => ({
  kind: 'dtd',
  timing: t,
  hSizeMm: 0,
  vSizeMm: 0,
  hBorder: 0,
  vBorder: 0,
  syncType: 'digital-separate',
  stereo: 'none',
})

/** Does a table entry match the request, allowing for the fractional variant? */
function matchesRate(entryRate: number, wanted: number): boolean {
  return Math.abs(entryRate - wanted) < 0.5
}

/**
 * Turn a resolution and a refresh rate into a timing.
 *
 * Order matters: a mode that IS a CTA VIC should be generated as that VIC, not
 * re-derived from CVT, because the two differ (1080p60 is 2200x1125 in CTA and
 * something else entirely under CVT) and every sink in this trade expects the
 * CTA raster. 'auto' therefore looks in the standard tables first.
 */
export function solveTiming(req: SimpleRequest): { timing: Timing; standard: TimingStandard; vic?: number; notes: string[] } {
  const notes: string[] = []
  const { hActive, vActive, refreshHz, interlaced, standard } = req

  const applyFraction = (t: Timing): Timing =>
    req.fractional ? { ...t, pixelClockHz: (t.pixelClockHz * 1000) / 1001 } : t

  if (standard === 'cta' || standard === 'manual') {
    const hit = CTA_TIMINGS.find(
      (c) =>
        c.hActive === hActive &&
        (c.interlaced ? c.vActive * 2 : c.vActive) === vActive &&
        c.interlaced === interlaced &&
        matchesRate(vFreq(c), refreshHz),
    )
    if (hit) {
      if (req.fractional && !hit.hasFractional) {
        notes.push(
          `VIC ${hit.vic} has no 1000/1001 variant in CTA-861 — the fractional rate is written as a detailed timing only.`,
        )
      }
      return { timing: applyFraction(hit), standard: 'cta', vic: hit.vic, notes }
    }
    if (standard === 'cta') {
      notes.push(
        `${hActive}x${vActive}@${refreshHz} is not a CTA-861 VIC. Fell back to CVT reduced blanking v2; ` +
          'a consumer HDMI source may ignore it, because many only act on VICs.',
      )
      return { timing: applyFraction(cvtRb2(hActive, vActive, { refreshHz, interlaced })), standard: 'cvt-rb2', notes }
    }
  }

  if (standard === 'dmt' || standard === 'manual') {
    const hit = DMT_TIMINGS.find(
      (d) => d.hActive === hActive && d.vActive === vActive && matchesRate(vFreq(d), refreshHz),
    )
    if (hit) return { timing: applyFraction(hit), standard: 'dmt', notes }
    if (standard === 'dmt') {
      notes.push(`${hActive}x${vActive}@${refreshHz} is not in the DMT table. Fell back to CVT.`)
      return { timing: applyFraction(cvt(hActive, vActive, { refreshHz, interlaced })), standard: 'cvt', notes }
    }
  }

  switch (standard) {
    case 'cvt':
      return { timing: applyFraction(cvt(hActive, vActive, { refreshHz, interlaced })), standard: 'cvt', notes }
    case 'cvt-rb':
      return { timing: applyFraction(cvtRb(hActive, vActive, { refreshHz, interlaced })), standard: 'cvt-rb', notes }
    case 'cvt-rb2':
      return { timing: applyFraction(cvtRb2(hActive, vActive, { refreshHz, interlaced })), standard: 'cvt-rb2', notes }
    case 'gtf':
      return { timing: applyFraction(gtf(hActive, vActive, { refreshHz, interlaced })), standard: 'gtf', notes }
    default:
      notes.push('No standard timing matched; used CVT reduced blanking v2 as the cheapest legal raster.')
      return { timing: applyFraction(cvtRb2(hActive, vActive, { refreshHz, interlaced })), standard: 'cvt-rb2', notes }
  }
}

/**
 * Build a complete EDID around one mode.
 *
 * The shape is deliberate and is what makes an EDID actually work on a mixed
 * fleet, rather than merely parse:
 *
 *  - Descriptor 1 is the mode, as a DTD, flagged native.
 *  - Descriptor 2 is a range-limits descriptor sized to the mode. Without one,
 *    EDID 1.4 is malformed, and a processor with continuous-frequency output
 *    has nothing to legalise a custom raster against.
 *  - Descriptor 3 is the name. It is what appears in every device's input menu,
 *    so it is worth being specific: "PDS4K-2160p60", not "Display".
 *  - A CTA extension carries the VIC when the mode has one, because consumer
 *    sources act on VICs and routinely ignore DTDs.
 *  - A DisplayID extension appears only when the clock exceeds what a DTD can
 *    state (655.35 MHz), because a needless extension is another block for a
 *    fussy sink to choke on.
 */
export function buildEdid(req: SimpleRequest): BuildResult {
  const { timing, standard, vic, notes } = solveTiming(req)
  return edidAroundTiming(timing, { name: req.name, signal: req.signal, standard, vic, fractional: req.fractional, notes })
}

export interface TimingEdidOptions {
  name: string
  signal: SignalOptions
  /** Where the timing came from; CVT and GTF make the range descriptor say so. */
  standard: TimingStandard
  /** The CTA VIC the timing is, when it is one — `vicFor` finds it. */
  vic?: number
  fractional?: boolean
  notes?: string[]
}

/**
 * The CTA VIC whose raster this timing is exactly, if any.
 *
 * Exact, not "same resolution and rate": a 1080p60 at CVT blanking is not
 * VIC 16, and claiming it is would tell a source to send a raster the sink was
 * never built around. The 1000/1001 variant of a VIC counts as the VIC.
 */
export function vicFor(t: Timing): number | undefined {
  for (const c of CTA_TIMINGS) {
    const whole: Timing = c
    const fraction = { ...c, pixelClockHz: (c.pixelClockHz * 1000) / 1001 }
    const sameRaster = (x: Timing) =>
      x.hActive === t.hActive && x.hFront === t.hFront && x.hSync === t.hSync && x.hBack === t.hBack &&
      x.vActive === t.vActive && x.vFront === t.vFront && x.vSync === t.vSync && x.vBack === t.vBack &&
      x.interlaced === t.interlaced
    // Within 0.1 %: a switcher states its clock to the kHz, a VIC to the Hz.
    const close = (x: Timing) => Math.abs(x.pixelClockHz - t.pixelClockHz) <= x.pixelClockHz * 0.001
    if (sameRaster(whole) && (close(whole) || (c.hasFractional && close(fraction)))) return c.vic
  }
  return undefined
}

/**
 * Build a complete EDID around a timing that is already decided — a switcher's
 * custom format, say, whose every porch was chosen by somebody on purpose and
 * must not be re-derived. `buildEdid` is this after `solveTiming`.
 */
export function edidAroundTiming(timing: Timing, opts: TimingEdidOptions): BuildResult {
  const { standard, vic } = opts
  const notes = opts.notes ? [...opts.notes] : []
  const req = { name: opts.name, signal: opts.signal, fractional: !!opts.fractional }
  const e = blankEdid()

  const rate = vFreq(timing)
  const lineKHz = hFreq(timing) / 1000
  const clockMHz = timing.pixelClockHz / 1e6

  e.features.continuousFrequency = standard.startsWith('cvt') || standard === 'gtf'
  e.features.preferredTimingIsNative = true

  // Not just the clock: active and blanking are 12-bit fields, so a wide
  // format like 8192x1080 is out of reach of a DTD at an ordinary clock.
  const dtdBlocker = dtdLimit(timing)
  const tooFastForDtd = dtdBlocker !== null

  e.descriptors = [
    tooFastForDtd ? { kind: 'dummy' } : DTD(timing),
    {
      kind: 'range',
      // A window around the mode, not the mode itself: a range that exactly
      // equals one rate tells a source it has no freedom at all, and some
      // refuse the mode rather than accept a zero-width window.
      minVerticalHz: Math.max(1, Math.floor(rate) - 1),
      maxVerticalHz: Math.ceil(rate) + 1,
      minHorizontalKHz: Math.max(1, Math.floor(lineKHz) - 1),
      maxHorizontalKHz: Math.ceil(lineKHz) + 1,
      maxPixelClockMHz: clockMHz,
      support: e.features.continuousFrequency ? 'cvt' : 'range-limits-only',
      ...(e.features.continuousFrequency
        ? {
            cvt: {
              version: 0x11,
              maxActivePixelsPerLine: hTotal(timing),
              supportedAspects: ['16:9', '16:10'] as const,
              preferredAspect: '16:9' as const,
              reducedBlanking: standard === 'cvt-rb' || standard === 'cvt-rb2',
              standardBlanking: standard === 'cvt',
              scalingHorizontalShrink: false,
              scalingHorizontalStretch: false,
              scalingVerticalShrink: false,
              scalingVerticalStretch: false,
              preferredRefreshHz: Math.round(rate),
            },
          }
        : {}),
    },
    { kind: 'name', text: (req.name || timingLabel(timing)).slice(0, 13) },
    { kind: 'dummy' },
  ]

  if (dtdBlocker) {
    notes.push(
      `This mode cannot be a detailed timing descriptor: ${dtdBlocker}. ` +
        'It is carried in a DisplayID Type VII block instead, whose fields are wide enough, and descriptor 1 is left empty.',
    )
  }

  // ------------------------------------------------------------ CTA block
  const s = req.signal
  const needsCta = vic !== undefined || s.format !== 'rgb444' || s.dsc || s.vrr || s.bpc > 8
  if (needsCta) {
    const cta: CtaExtension = emptyCta()
    cta.ycbcr444 = s.format === 'ycbcr444' || s.format === 'rgb444'
    cta.ycbcr422 = true

    if (vic !== undefined) {
      cta.videoDescriptors = [{ vic, native: vic <= 64 }]
      if (s.format === 'ycbcr420') {
        // A 4:2:0-only sink states the VIC in the Y420 block, NOT the ordinary
        // video data block — listing it in both claims full-bandwidth support
        // it does not have.
        cta.videoDescriptors = []
        cta.ycbcr420OnlyVics = [vic]
      }
    }

    if (!tooFastForDtd && vic === undefined) cta.detailedTimings = [DTD(timing)]

    // The TMDS rate the mode needs (4:2:2 at the pixel clock, 4:2:0 at half of
    // it times the depth), rounded UP to the field's 5 MHz step: to the nearest
    // step, 4K30's 297 MHz went out as 295, below the mode itself. DSC never
    // rides TMDS; it states the rate the mode would need uncompressed.
    const tmdsMHz = Math.min(600, Math.ceil(tmdsCharacterRateHz(timing, { ...s, dsc: false }) / 5e6) * 5)
    cta.hdmiVsdb = {
      physicalAddress: [1, 0, 0, 0],
      supportsAi: false,
      deepColor30: s.bpc >= 10,
      deepColor36: s.bpc >= 12,
      deepColor48: s.bpc >= 16,
      deepColorY444: s.bpc > 8,
      dviDual: false,
      maxTmdsClockMHz: tmdsMHz,
    }

    // 4:2:2 is clocked at the pixel clock whatever its depth, so deep 4:2:2
    // below 340 MHz needs no scrambling and no Forum block.
    const needsForum = s.dsc || s.vrr || (s.format === 'ycbcr422' ? clockMHz : clockMHz * (s.bpc / 8)) > 340
    if (needsForum) {
      cta.hdmiForumVsdb = {
        version: 1,
        maxTmdsCharacterRateMHz: tmdsMHz,
        scdcPresent: true,
        rrCapable: true,
        lte340ScrambleSupported: true,
        deepColor420_30: s.bpc >= 10,
        deepColor420_36: s.bpc >= 12,
        deepColor420_48: false,
        // Advertise the FRL rate the mode actually needs, not the maximum —
        // claiming 48G on a device that cannot train it is how a link ends up
        // negotiating down to nothing.
        maxFrlRate: frlRateFor(timing.pixelClockHz, s),
        dscCapable: s.dsc,
        dsc10bpc: s.dsc && s.bpc >= 10,
        dsc12bpc: s.dsc && s.bpc >= 12,
        dscNative420: s.dsc && s.format === 'ycbcr420',
        dscAllBpp: s.dsc,
        dscMaxFrlRate: s.dsc ? frlRateFor(timing.pixelClockHz, s) : 0,
        dscMaxSlices: s.dsc ? 8 : 0,
        dscTotalChunkKBytes: s.dsc ? 4 : 0,
        vrrMin: s.vrr ? Math.round(s.vrrMinHz) : 0,
        vrrMax: s.vrr ? Math.round(s.vrrMaxHz) : 0,
        qmsSupported: false,
        qmsTfrMin: false,
        qmsTfrMax: false,
        allmSupported: s.vrr,
        fvaSupported: false,
        cnmVrr: false,
        cinemaVrr: false,
        mDelta: false,
      }
      if (s.vrr) {
        notes.push(
          `Variable refresh is advertised as a ${Math.round(s.vrrMinHz)}–${Math.round(s.vrrMaxHz)} Hz window in the HDMI Forum block. ` +
            'Nothing in the Analog Way, Barco or PixelHue ranges here is documented to act on it — it is for the source’s benefit.',
        )
      }
      if (s.dsc) {
        notes.push(
          'DSC is advertised, which commits the link to FRL: an HDMI 2.0 or earlier input will not negotiate it at all.',
        )
      }
    }

    if (s.bpc > 8) {
      cta.colorimetry = {
        xvYCC601: false,
        xvYCC709: false,
        sYCC601: false,
        opYCC601: false,
        opRGB: false,
        bt2020cYCC: false,
        bt2020YCC: true,
        bt2020RGB: true,
        dciP3: false,
        md: [false, false, false, false],
      }
    }

    e.extensions.push(cta)
  }

  // ------------------------------------------------------- DisplayID block
  if (tooFastForDtd) {
    const did: DisplayIdExtension = {
      kind: 'displayid',
      version: 0x20,
      primaryUseCase: 3, // presentation / large format
      extensionCount: 0,
      type7Timings: [{ timing, preferred: true, aspect: aspectFor(timing), fractional: req.fractional }],
      unknownBlocks: [],
    }
    e.extensions.push(did)
  }

  return { edid: e, timing, resolvedStandard: standard, vic, notes }
}

function aspectFor(t: Timing): string {
  const r = t.hActive / t.vActive
  const table: [number, string][] = [
    [1, '1:1'],
    [5 / 4, '5:4'],
    [4 / 3, '4:3'],
    [15 / 9, '15:9'],
    [16 / 9, '16:9'],
    [16 / 10, '16:10'],
    [64 / 27, '64:27'],
    [256 / 135, '256:135'],
  ]
  let best = table[0]
  for (const row of table) if (Math.abs(row[0] - r) < Math.abs(best[0] - r)) best = row
  return best[1]
}

/** Smallest FRL rate index (1-6) that carries the mode. */
function frlRateFor(clockHz: number, s: SignalOptions): number {
  const payload = clockHz * bitsPerPixel(s, 'hdmi')
  const rates = [9e9, 18e9, 24e9, 32e9, 40e9, 48e9]
  for (let i = 0; i < rates.length; i++) {
    if (payload <= rates[i] * FRL_EFFICIENCY) return i + 1
  }
  return 6
}
