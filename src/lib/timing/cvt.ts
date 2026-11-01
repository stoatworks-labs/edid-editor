import type { Timing } from './types.ts'

/**
 * VESA Coordinated Video Timings.
 *
 * Three generations live here and they are genuinely different algorithms, not
 * parameter tweaks:
 *
 *   cvt()      CVT 1.1 standard blanking. Derives blanking from a duty-cycle
 *              curve, so blanking shrinks as the line rate rises.
 *   cvtRb()    CVT 1.1 reduced blanking v1. Fixed 160-pixel horizontal blanking.
 *              This is what "RB" means on nearly every device menu.
 *   cvtRb2()   CVT 1.2 reduced blanking v2. 80-pixel horizontal blanking, fixed
 *              8-line vsync, and a 1 kHz clock step instead of 250 kHz — which
 *              is what lets it hit fractional rates exactly.
 *
 * Reference values the tests pin (all published DMT entries, so they are
 * independent of this implementation):
 *   1920x1200 @60 CVT     193.25 MHz, 2592 x 1245
 *   1920x1200 @60 CVT-RB  154.00 MHz, 2080 x 1235
 *   1680x1050 @60 CVT     146.25 MHz, 2240 x 1089
 */

const CELL_GRAN = 8
const MIN_V_PORCH = 3 // lines, front porch floor
const MIN_V_BPORCH = 6 // lines
const MIN_VSYNC_BP = 550 // µs, sync + back porch floor
const CLOCK_STEP_HZ = 250_000

// Blanking duty-cycle curve, CVT 1.1 defaults.
const C_PRIME = 30
const M_PRIME = 300

const RB_H_BLANK = 160
const RB_H_SYNC = 32
const RB_V_FPORCH = 3
const RB_MIN_V_BLANK = 460 // µs

const RB2_H_BLANK = 80
const RB2_H_SYNC = 32
const RB2_H_FRONT = 8
const RB2_V_FPORCH = 1
const RB2_V_SYNC = 8
const RB2_MIN_V_BPORCH = 6
const RB2_MIN_V_BLANK = 460 // µs
const RB2_CLOCK_STEP_HZ = 1_000

/**
 * VSync width in lines, chosen from the aspect ratio.
 *
 * This is a lookup on the EXACT integer ratio, not the nearest one — CVT is
 * explicit that an aspect it does not recognise gets 10 lines, and quietly
 * snapping 1366x768 to 16:9 would give it 5 and change the clock. Same trap as
 * a reduced fraction being the wrong answer for a person.
 */
function vSyncForAspect(hActive: number, vActive: number): number {
  if ((vActive * 4) / 3 === hActive) return 4
  if ((vActive * 16) / 9 === hActive) return 5
  if ((vActive * 16) / 10 === hActive) return 6
  if (vActive % 4 === 0 && (vActive * 5) / 4 === hActive) return 7
  if ((vActive * 15) / 9 === hActive) return 7
  return 10
}

const roundToCell = (n: number) => Math.floor(n / CELL_GRAN) * CELL_GRAN

export interface CvtOptions {
  /** Field rate in Hz for interlaced modes, frame rate otherwise. */
  refreshHz: number
  interlaced?: boolean
  /** 1.8% overscan margins, off in every real-world use. */
  margins?: boolean
}

/** CVT 1.1, standard (non-reduced) blanking. */
export function cvt(hActive: number, vActive: number, opts: CvtOptions): Timing {
  const { refreshHz, interlaced = false, margins = false } = opts

  const hPixels = roundToCell(hActive)
  const vLines = interlaced ? Math.round(vActive / 2) : vActive

  const vSync = vSyncForAspect(hPixels, vActive)
  const interlaceAdjust = interlaced ? 0.5 : 0

  const marginLines = margins ? Math.round((vLines * 18) / 1000) : 0
  const marginPixels = margins ? roundToCell((hPixels * 18) / 1000) : 0
  const totalActivePixels = hPixels + marginPixels * 2

  // Everything downstream is driven by the ESTIMATED line period, not by a
  // period recomputed against the settled vertical total. Recomputing it looks
  // like an obvious improvement and is wrong: it shifts the duty cycle and the
  // clock off the published DMT values by a few hundred kHz. The estimate is
  // the definition, not an approximation of one.
  const hPeriodEst =
    (1_000_000 / refreshHz - MIN_VSYNC_BP) /
    (vLines + marginLines * 2 + MIN_V_PORCH + interlaceAdjust)

  let vSyncBp = Math.floor(MIN_VSYNC_BP / hPeriodEst) + 1
  if (vSyncBp < vSync + MIN_V_PORCH) vSyncBp = vSync + MIN_V_PORCH

  const vBackPorch = vSyncBp - vSync

  let dutyCycle = C_PRIME - (M_PRIME * hPeriodEst) / 1000
  if (dutyCycle < 20) dutyCycle = 20

  // Floored to a DOUBLE cell (16 px), so that hBlank/2 stays cell-aligned for
  // the back porch. Rounding to a single cell puts the back porch on an odd
  // 8-pixel boundary and moves the clock.
  const hBlank =
    Math.floor(
      (totalActivePixels * dutyCycle) / (100 - dutyCycle) / (2 * CELL_GRAN),
    ) *
    (2 * CELL_GRAN)

  const hTotalPixels = totalActivePixels + hBlank
  const hSync = Math.floor((hTotalPixels * 8) / 100 / CELL_GRAN) * CELL_GRAN
  const hBackPorch = hBlank / 2 + marginPixels
  const hFrontPorch = hBlank - hSync - hBackPorch + marginPixels

  const pixelClockHz =
    Math.floor(hTotalPixels / hPeriodEst / (CLOCK_STEP_HZ / 1_000_000)) *
    CLOCK_STEP_HZ

  return {
    hActive: totalActivePixels,
    hFront: hFrontPorch,
    hSync,
    hBack: hBackPorch,
    // One field's lines when interlaced, like the porches beside it and like a DTD.
    // The frame height here, with per-field porches, is a 30 Hz mode called 1080i60.
    vActive: vLines + marginLines * 2,
    vFront: MIN_V_PORCH,
    vSync,
    vBack: vBackPorch,
    pixelClockHz,
    interlaced,
    // CVT standard blanking: hsync negative, vsync positive.
    hSyncPositive: false,
    vSyncPositive: true,
  }
}

/** CVT 1.1 reduced blanking, version 1. */
export function cvtRb(hActive: number, vActive: number, opts: CvtOptions): Timing {
  const { refreshHz, interlaced = false } = opts

  const hPixels = roundToCell(hActive)
  const vLines = interlaced ? Math.round(vActive / 2) : vActive
  const vSync = vSyncForAspect(hPixels, vActive)
  const interlaceAdjust = interlaced ? 0.5 : 0

  const hPeriod = (1_000_000 / refreshHz - RB_MIN_V_BLANK) / vLines

  let vBlankLines = Math.floor(RB_MIN_V_BLANK / hPeriod) + 1
  const minVBlank = RB_V_FPORCH + vSync + MIN_V_BPORCH
  if (vBlankLines < minVBlank) vBlankLines = minVBlank

  const vTotalLines = vLines + vBlankLines + interlaceAdjust
  const hTotalPixels = hPixels + RB_H_BLANK

  const clockRaw = refreshHz * vTotalLines * hTotalPixels
  const pixelClockHz = Math.floor(clockRaw / CLOCK_STEP_HZ) * CLOCK_STEP_HZ

  const vBack = vBlankLines - RB_V_FPORCH - vSync

  return {
    hActive: hPixels,
    // RB v1 splits its 160 pixels 48 front / 32 sync / 80 back.
    hFront: 48,
    hSync: RB_H_SYNC,
    hBack: RB_H_BLANK - 48 - RB_H_SYNC,
    vActive: vLines,
    vFront: RB_V_FPORCH,
    vSync,
    vBack,
    pixelClockHz,
    interlaced,
    // Reduced blanking inverts both polarities relative to standard CVT. This
    // is how a sink tells RB from non-RB at the same resolution.
    hSyncPositive: true,
    vSyncPositive: false,
  }
}

/**
 * CVT 1.2 reduced blanking, version 2.
 *
 * The 1 kHz clock step is the point of it: RBv1's 250 kHz step cannot land on
 * 1000/1001 rates exactly, RBv2 can.
 */
export function cvtRb2(hActive: number, vActive: number, opts: CvtOptions): Timing {
  const { refreshHz, interlaced = false } = opts

  const hPixels = roundToCell(hActive)
  const vLines = interlaced ? Math.round(vActive / 2) : vActive
  const interlaceAdjust = interlaced ? 0.5 : 0

  const hTotalPixels = hPixels + RB2_H_BLANK
  const hPeriod = (1_000_000 / refreshHz - RB2_MIN_V_BLANK) / vLines

  let vBlankLines = Math.ceil(RB2_MIN_V_BLANK / hPeriod)
  const minVBlank = RB2_V_FPORCH + RB2_V_SYNC + RB2_MIN_V_BPORCH
  if (vBlankLines < minVBlank) vBlankLines = minVBlank

  const vTotalLines = vLines + vBlankLines + interlaceAdjust
  const clockRaw = refreshHz * vTotalLines * hTotalPixels
  const pixelClockHz =
    Math.round(clockRaw / RB2_CLOCK_STEP_HZ) * RB2_CLOCK_STEP_HZ

  return {
    hActive: hPixels,
    hFront: RB2_H_FRONT,
    hSync: RB2_H_SYNC,
    hBack: RB2_H_BLANK - RB2_H_FRONT - RB2_H_SYNC,
    vActive: vLines,
    vFront: RB2_V_FPORCH,
    vSync: RB2_V_SYNC,
    vBack: vBlankLines - RB2_V_FPORCH - RB2_V_SYNC,
    pixelClockHz,
    interlaced,
    hSyncPositive: true,
    vSyncPositive: false,
  }
}
