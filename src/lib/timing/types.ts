/**
 * One video mode, stated the way an EDID detailed timing states it: active
 * pixels, the three blanking intervals on each axis, and an exact pixel clock.
 *
 * Everything else a person wants to see (totals, line rate, refresh, bandwidth)
 * is derived from these — never stored alongside them, so the two can't drift.
 *
 * An interlaced mode states ONE FIELD, as a DTD does: 1080i is vActive 540, with
 * the porches of each field. Every field also carries half a line that no field
 * can state — 1080i's 1125-line frame is two fields of 562.5, stored as 562. The
 * half line is implied by `interlaced`, and `fieldLines` is where it comes back.
 */
export interface Timing {
  hActive: number
  hFront: number
  hSync: number
  hBack: number
  vActive: number
  vFront: number
  vSync: number
  vBack: number
  /** Exact, in Hz. EDID can only carry a multiple of 10 kHz; that rounding is
   *  applied at encode time, not here, so the modelled mode stays truthful. */
  pixelClockHz: number
  interlaced: boolean
  hSyncPositive: boolean
  vSyncPositive: boolean
}

export type TimingStandard =
  | 'dmt'
  | 'cta'
  | 'cvt'
  | 'cvt-rb'
  | 'cvt-rb2'
  | 'gtf'
  | 'manual'

export interface NamedTiming extends Timing {
  name: string
  standard: TimingStandard
  /** DMT ID (e.g. 0x45) or CTA VIC, where the mode comes from a table. */
  code?: number
  /** True where the vertical rate is the 1000/1001 variant of a whole number. */
  fractional?: boolean
}

export const hTotal = (t: Timing) => t.hActive + t.hFront + t.hSync + t.hBack
/** The vertical total as stored: for an interlaced mode, one field less its half line. */
export const vTotal = (t: Timing) => t.vActive + t.vFront + t.vSync + t.vBack

/** Lines a field really takes: 562.5 for 1080i, where `vTotal` says 562. */
export const fieldLines = (t: Timing) => vTotal(t) + (t.interlaced ? 0.5 : 0)

/** Picture height: 1080 for 1080i, where `vActive` holds the field's 540. */
export const frameHeight = (t: Timing) => (t.interlaced ? t.vActive * 2 : t.vActive)

/** Lines a frame takes, blanking included: 1125 for 1080i, as CTA-861 lists it. */
export const frameLines = (t: Timing) => (t.interlaced ? fieldLines(t) * 2 : vTotal(t))

/** Line rate in Hz. */
export const hFreq = (t: Timing) => t.pixelClockHz / hTotal(t)

/**
 * Refresh in Hz.
 *
 * For an interlaced mode this is the FIELD rate, which is what every EDID field,
 * every spec sheet and every operator means by "1080i60". The frame rate is half
 * of it. Getting this backwards silently halves or doubles every bandwidth
 * number downstream, so the two are never conflated.
 *
 * It divides by `fieldLines`, half line included. Divide by `vTotal` and VIC 5,
 * which is exactly 60 fields a second, comes out 60.053 and is labelled 60.05.
 */
export const vFreq = (t: Timing) => hFreq(t) / fieldLines(t)

/** Frames per second — half the field rate when interlaced. */
export const frameRate = (t: Timing) => (t.interlaced ? vFreq(t) / 2 : vFreq(t))

/** Total pixels shifted per second, blanking included. This, not the active
 *  pixel count, is what a link has to carry. */
export const pixelRate = (t: Timing) => t.pixelClockHz

export function timingEquals(a: Timing, b: Timing): boolean {
  return (
    a.hActive === b.hActive &&
    a.hFront === b.hFront &&
    a.hSync === b.hSync &&
    a.hBack === b.hBack &&
    a.vActive === b.vActive &&
    a.vFront === b.vFront &&
    a.vSync === b.vSync &&
    a.vBack === b.vBack &&
    a.interlaced === b.interlaced &&
    Math.abs(a.pixelClockHz - b.pixelClockHz) < 1
  )
}

/** A short human label: "1920x1080p60" / "1920x1080i59.94". */
export function timingLabel(t: Timing): string {
  const r = vFreq(t)
  const whole = Math.round(r)
  // 59.94 and friends are 1000/1001 of a whole rate; show two decimals only
  // when the mode really is fractional, not because of float noise.
  const text = Math.abs(r - whole) < 0.01 ? String(whole) : r.toFixed(2)
  return `${t.hActive}x${frameHeight(t)}${t.interlaced ? 'i' : 'p'}${text}`
}
