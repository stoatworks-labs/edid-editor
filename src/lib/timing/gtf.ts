import type { Timing } from './types.ts'

/**
 * VESA Generalized Timing Formula 1.1, refresh-rate variant.
 *
 * Superseded by CVT everywhere that matters, but LiveCore and the older Midra
 * generation still list GTF 1.1 as an accepted input standard, so a person
 * feeding those boxes needs to be able to produce it.
 *
 * Defaults are the published ones: C=40%, M=600 kHz/%, K=128, J=20%.
 */

const CELL_GRAN = 8
const MIN_PORCH = 1
const V_SYNC_RQD = 3
const H_SYNC_PERCENT = 8
const MIN_VSYNC_BP = 550 // µs

const C = 40
const M = 600
const K = 128
const J = 20

const C_PRIME = ((C - J) * K) / 256 + J // 30
const M_PRIME = (K / 256) * M // 300

export interface GtfOptions {
  /** Field rate for interlaced, frame rate otherwise. */
  refreshHz: number
  interlaced?: boolean
}

export function gtf(hActive: number, vActive: number, opts: GtfOptions): Timing {
  const { refreshHz, interlaced = false } = opts

  const hPixels = Math.round(hActive / CELL_GRAN) * CELL_GRAN
  const vLines = interlaced ? Math.round(vActive / 2) : vActive
  const interlaceAdjust = interlaced ? 0.5 : 0

  // Estimate the line period from the requested field rate...
  const hPeriodEst =
    ((1 / refreshHz - MIN_VSYNC_BP / 1_000_000) /
      (vLines + MIN_PORCH + interlaceAdjust)) *
    1_000_000

  const vSyncBp = Math.round(MIN_VSYNC_BP / hPeriodEst)
  const vBackPorch = vSyncBp - V_SYNC_RQD
  const totalVLines = vLines + vSyncBp + interlaceAdjust + MIN_PORCH

  // ...then correct it against the vertical total that fell out.
  const vFieldRateEst = 1_000_000 / hPeriodEst / totalVLines
  const hPeriod = (hPeriodEst * vFieldRateEst) / refreshHz

  let dutyCycle = C_PRIME - (M_PRIME * hPeriod) / 1000
  if (dutyCycle < 20) dutyCycle = 20

  // GTF rounds horizontal blanking to a DOUBLE cell (16px), not a single one,
  // so that hblank/2 lands on a cell boundary for the back porch.
  const hBlank =
    Math.round((hPixels * dutyCycle) / (100 - dutyCycle) / (2 * CELL_GRAN)) *
    (2 * CELL_GRAN)
  const totalPixels = hPixels + hBlank

  const pixelClockHz = Math.round((totalPixels / hPeriod) * 1_000_000)

  const hSync =
    Math.round((H_SYNC_PERCENT / 100) * totalPixels / CELL_GRAN) * CELL_GRAN
  const hBack = hBlank / 2
  const hFront = hBlank - hSync - hBack

  return {
    hActive: hPixels,
    hFront,
    hSync,
    hBack,
    // One field's lines when interlaced, as in cvt.ts.
    vActive: vLines,
    vFront: MIN_PORCH,
    vSync: V_SYNC_RQD,
    vBack: vBackPorch,
    pixelClockHz,
    interlaced,
    hSyncPositive: false,
    vSyncPositive: true,
  }
}
