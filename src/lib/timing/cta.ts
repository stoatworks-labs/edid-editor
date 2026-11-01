import { frameHeight, vFreq, type NamedTiming } from './types.ts'

/**
 * CTA-861 Video Identification Codes.
 *
 * These are the modes a sink advertises in a CTA extension's Video Data Block,
 * and they are the ONLY way to say "I take 2160p60" to an HDMI source in a form
 * every source understands — a detailed timing descriptor saying the same thing
 * is routinely ignored by consumer sources. That asymmetry is the whole reason
 * the CTA extension exists, and it is why the simple mode writes both.
 *
 * Curated to the broadcast/event set. Interlaced entries state vActive as the
 * FIELD height and the porches per field, which is how a DTD encodes them.
 *
 * Fractional (1000/1001) variants are not separate VICs: a VIC covers both the
 * whole rate and its /1.001 sibling, and the source picks between them. They are
 * generated on demand rather than listed twice.
 */

interface Row {
  vic: number
  h: number
  hf: number
  hs: number
  hb: number
  v: number
  vf: number
  vs: number
  vb: number
  /** kHz */
  clk: number
  i?: boolean
  hp: boolean
  vp: boolean
  /** Picture aspect ratio, as CTA states it. */
  par: string
  /** True where the mode also has a 1000/1001 variant in real use. */
  frac?: boolean
}

const ROWS: Row[] = [
  { vic: 1, h: 640, hf: 16, hs: 96, hb: 48, v: 480, vf: 10, vs: 2, vb: 33, clk: 25175, hp: false, vp: false, par: '4:3', frac: true },
  { vic: 2, h: 720, hf: 16, hs: 62, hb: 60, v: 480, vf: 9, vs: 6, vb: 30, clk: 27000, hp: false, vp: false, par: '4:3', frac: true },
  { vic: 3, h: 720, hf: 16, hs: 62, hb: 60, v: 480, vf: 9, vs: 6, vb: 30, clk: 27000, hp: false, vp: false, par: '16:9', frac: true },
  { vic: 4, h: 1280, hf: 110, hs: 40, hb: 220, v: 720, vf: 5, vs: 5, vb: 20, clk: 74250, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 5, h: 1920, hf: 88, hs: 44, hb: 148, v: 540, vf: 2, vs: 5, vb: 15, clk: 74250, i: true, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 16, h: 1920, hf: 88, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 148500, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 17, h: 720, hf: 12, hs: 64, hb: 68, v: 576, vf: 5, vs: 5, vb: 39, clk: 27000, hp: false, vp: false, par: '4:3' },
  { vic: 18, h: 720, hf: 12, hs: 64, hb: 68, v: 576, vf: 5, vs: 5, vb: 39, clk: 27000, hp: false, vp: false, par: '16:9' },
  { vic: 19, h: 1280, hf: 440, hs: 40, hb: 220, v: 720, vf: 5, vs: 5, vb: 20, clk: 74250, hp: true, vp: true, par: '16:9' },
  { vic: 20, h: 1920, hf: 528, hs: 44, hb: 148, v: 540, vf: 2, vs: 5, vb: 15, clk: 74250, i: true, hp: true, vp: true, par: '16:9' },
  { vic: 31, h: 1920, hf: 528, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 148500, hp: true, vp: true, par: '16:9' },
  { vic: 32, h: 1920, hf: 638, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 74250, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 33, h: 1920, hf: 528, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 74250, hp: true, vp: true, par: '16:9' },
  { vic: 34, h: 1920, hf: 88, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 74250, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 63, h: 1920, hf: 88, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 297000, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 64, h: 1920, hf: 528, hs: 44, hb: 148, v: 1080, vf: 4, vs: 5, vb: 36, clk: 297000, hp: true, vp: true, par: '16:9' },
  { vic: 93, h: 3840, hf: 1276, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 297000, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 94, h: 3840, hf: 1056, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 297000, hp: true, vp: true, par: '16:9' },
  { vic: 95, h: 3840, hf: 176, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 297000, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 96, h: 3840, hf: 1056, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 594000, hp: true, vp: true, par: '16:9' },
  { vic: 97, h: 3840, hf: 176, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 594000, hp: true, vp: true, par: '16:9', frac: true },
  { vic: 98, h: 4096, hf: 1020, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 297000, hp: true, vp: true, par: '256:135', frac: true },
  { vic: 99, h: 4096, hf: 968, hs: 88, hb: 128, v: 2160, vf: 8, vs: 10, vb: 72, clk: 297000, hp: true, vp: true, par: '256:135' },
  { vic: 100, h: 4096, hf: 88, hs: 88, hb: 128, v: 2160, vf: 8, vs: 10, vb: 72, clk: 297000, hp: true, vp: true, par: '256:135', frac: true },
  { vic: 101, h: 4096, hf: 968, hs: 88, hb: 128, v: 2160, vf: 8, vs: 10, vb: 72, clk: 594000, hp: true, vp: true, par: '256:135' },
  { vic: 102, h: 4096, hf: 88, hs: 88, hb: 128, v: 2160, vf: 8, vs: 10, vb: 72, clk: 594000, hp: true, vp: true, par: '256:135', frac: true },
  { vic: 117, h: 3840, hf: 1056, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 1188000, hp: true, vp: true, par: '16:9' },
  { vic: 118, h: 3840, hf: 176, hs: 88, hb: 296, v: 2160, vf: 8, vs: 10, vb: 72, clk: 1188000, hp: true, vp: true, par: '16:9', frac: true },
]

export interface CtaTiming extends NamedTiming {
  vic: number
  aspect: string
  /** The mode also exists at 1000/1001 of the stated rate. */
  hasFractional: boolean
}

function build(r: Row): CtaTiming {
  const t: CtaTiming = {
    name: '',
    standard: 'cta',
    code: r.vic,
    vic: r.vic,
    aspect: r.par,
    hasFractional: r.frac === true,
    hActive: r.h,
    hFront: r.hf,
    hSync: r.hs,
    hBack: r.hb,
    vActive: r.v,
    vFront: r.vf,
    vSync: r.vs,
    vBack: r.vb,
    pixelClockHz: r.clk * 1000,
    interlaced: r.i === true,
    hSyncPositive: r.hp,
    vSyncPositive: r.vp,
  }
  t.name = `VIC ${r.vic} — ${r.h}x${frameHeight(t)}${r.i ? 'i' : 'p'}${Math.round(vFreq(t))} ${r.par}`
  return t
}

export const CTA_TIMINGS: CtaTiming[] = ROWS.map(build)

export function ctaByVic(vic: number): CtaTiming | undefined {
  return CTA_TIMINGS.find((t) => t.vic === vic)
}

/**
 * The 1000/1001 sibling of a CTA mode.
 *
 * The pixel clock divides, the totals do not — that is what makes 59.94 a
 * different clock at the same 2200x1125 rather than a different mode.
 */
export function fractionalVariant(t: CtaTiming): CtaTiming {
  return {
    ...t,
    pixelClockHz: (t.pixelClockHz * 1000) / 1001,
    fractional: true,
    name: t.name.replace(/(\d+)( |$)/, (m) => m),
  }
}
