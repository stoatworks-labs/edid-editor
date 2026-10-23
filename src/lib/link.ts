import type { Timing } from './timing/types.ts'

/**
 * What a mode costs a link, and the smallest interface version that carries it.
 *
 * The one relation everything here turns on:
 *
 *     payload bit rate = pixel clock x bits per pixel
 *
 * and every interface then states how much payload it can move, which is its
 * raw signalling rate times its line-code efficiency. HDMI and DisplayPort
 * differ in BOTH terms, which is why "will it fit?" has no single answer and a
 * mode can be legal on one and not the other at the same resolution.
 *
 * Caveat stated once, and repeated in the UI: DisplayPort's usable payload is
 * slightly below the figure computed here because the stream is packed into
 * transfer units with per-line overhead that depends on the blanking. A mode
 * landing within ~2% of a DP rate boundary should be treated as marginal, not
 * as a pass. HDMI TMDS has no such slack — its limit is a clock ceiling and is
 * exact.
 */

export type ColorFormat = 'rgb444' | 'ycbcr444' | 'ycbcr422' | 'ycbcr420'

export interface SignalOptions {
  format: ColorFormat
  /** Bits per component: 8, 10, 12, 16. */
  bpc: 8 | 10 | 12 | 16
  /** Display Stream Compression on, and its target bits per PIXEL (not per
   *  component). 12 bpp is the usual visually-lossless target for 4:4:4. */
  dsc: boolean
  dscTargetBpp: number
  /** Variable refresh rate (VRR / VFR). Costs no bandwidth at the stated rate —
   *  it is a capability the sink advertises and the link must support, not a
   *  higher clock — so it gates which interface version is required without
   *  changing the payload. */
  vrr: boolean
  /** The VRR window, in Hz, written into the HDMI Forum VSDB. */
  vrrMinHz: number
  vrrMaxHz: number
}

export const DEFAULT_SIGNAL: SignalOptions = {
  format: 'rgb444',
  bpc: 8,
  dsc: false,
  dscTargetBpp: 12,
  vrr: false,
  vrrMinHz: 24,
  vrrMaxHz: 60,
}

/**
 * Bits carried per pixel.
 *
 * 4:2:2 is the odd one: it subsamples chroma horizontally but HDMI always
 * transports it in a fixed 12-bit-per-component container, so it costs the same
 * as 8-bit 4:4:4 regardless of the requested depth. Treating it as
 * 2 x bpc would overstate 12-bit 4:2:2 by half.
 */
export function bitsPerPixel(s: SignalOptions): number {
  if (s.dsc) return s.dscTargetBpp
  switch (s.format) {
    case 'rgb444':
    case 'ycbcr444':
      return s.bpc * 3
    case 'ycbcr422':
      return 16
    case 'ycbcr420':
      return (s.bpc * 3) / 2
  }
}

/** Payload rate in bits per second. */
export function payloadBps(t: Timing, s: SignalOptions): number {
  return t.pixelClockHz * bitsPerPixel(s)
}

/**
 * HDMI TMDS character rate.
 *
 * Deep colour raises the character rate above the pixel clock because the extra
 * bits are clocked out on the same three lanes. 4:2:0 halves it, which is the
 * whole reason 4K60 exists on HDMI 1.4 hardware at all.
 */
export function tmdsCharacterRateHz(t: Timing, s: SignalOptions): number {
  if (s.dsc) {
    // DSC over TMDS is not a thing — HDMI only carries DSC on FRL.
    return Number.POSITIVE_INFINITY
  }
  const base = s.format === 'ycbcr420' ? t.pixelClockHz / 2 : t.pixelClockHz
  // 4:2:2 is always transported at the 8-bit character rate.
  if (s.format === 'ycbcr422') return base
  return (base * s.bpc) / 8
}

// ------------------------------------------------------------------- HDMI

export interface HdmiVersion {
  name: string
  /** Max TMDS character rate in Hz, or 0 for an FRL-only entry. */
  maxTmdsHz: number
  /** Total FRL bandwidth in bits/s, or 0 for a TMDS-only entry. */
  frlBps: number
  frlRate: number
  lanes: number
}

/** 16b/18b line coding on FRL: 16 payload bits per 18 on the wire. */
export const FRL_EFFICIENCY = 16 / 18

export const HDMI_VERSIONS: HdmiVersion[] = [
  { name: 'HDMI 1.0–1.2', maxTmdsHz: 165e6, frlBps: 0, frlRate: 0, lanes: 3 },
  { name: 'HDMI 1.3/1.4', maxTmdsHz: 340e6, frlBps: 0, frlRate: 0, lanes: 3 },
  { name: 'HDMI 2.0', maxTmdsHz: 600e6, frlBps: 0, frlRate: 0, lanes: 3 },
  { name: 'HDMI 2.1 FRL 3×3G (9G)', maxTmdsHz: 600e6, frlBps: 9e9, frlRate: 1, lanes: 3 },
  { name: 'HDMI 2.1 FRL 3×6G (18G)', maxTmdsHz: 600e6, frlBps: 18e9, frlRate: 2, lanes: 3 },
  { name: 'HDMI 2.1 FRL 4×6G (24G)', maxTmdsHz: 600e6, frlBps: 24e9, frlRate: 3, lanes: 4 },
  { name: 'HDMI 2.1 FRL 4×8G (32G)', maxTmdsHz: 600e6, frlBps: 32e9, frlRate: 4, lanes: 4 },
  { name: 'HDMI 2.1 FRL 4×10G (40G)', maxTmdsHz: 600e6, frlBps: 40e9, frlRate: 5, lanes: 4 },
  { name: 'HDMI 2.1 FRL 4×12G (48G)', maxTmdsHz: 600e6, frlBps: 48e9, frlRate: 6, lanes: 4 },
]

export interface HdmiRequirement {
  /** The lowest version that carries the mode, or null if nothing does. */
  version: HdmiVersion | null
  /** True when it fits on TMDS; false means it needs FRL. */
  viaTmds: boolean
  tmdsCharacterRateHz: number
  payloadBps: number
  /** Fraction of the chosen link used, 0-1. */
  utilisation: number
  note?: string
}

export function hdmiRequirement(t: Timing, s: SignalOptions): HdmiRequirement {
  const payload = payloadBps(t, s)
  const tmds = tmdsCharacterRateHz(t, s)

  if (!s.dsc && Number.isFinite(tmds)) {
    for (const v of HDMI_VERSIONS) {
      if (v.frlBps === 0 && tmds <= v.maxTmdsHz) {
        return {
          version: v,
          viaTmds: true,
          tmdsCharacterRateHz: tmds,
          payloadBps: payload,
          utilisation: tmds / v.maxTmdsHz,
          note:
            tmds > 340e6
              ? 'Above 340 MHz the link must be scrambled and the sink must expose SCDC — an HDMI 1.4 cable will not do it.'
              : undefined,
        }
      }
    }
  }

  for (const v of HDMI_VERSIONS) {
    if (v.frlBps === 0) continue
    if (payload <= v.frlBps * FRL_EFFICIENCY) {
      return {
        version: v,
        viaTmds: false,
        tmdsCharacterRateHz: tmds,
        payloadBps: payload,
        utilisation: payload / (v.frlBps * FRL_EFFICIENCY),
        note: s.dsc ? 'DSC only travels over FRL — an HDMI 2.0 or earlier link cannot carry it.' : undefined,
      }
    }
  }

  return {
    version: null,
    viaTmds: false,
    tmdsCharacterRateHz: tmds,
    payloadBps: payload,
    utilisation: payload / (48e9 * FRL_EFFICIENCY),
    note: 'Beyond HDMI 2.1 48G even with DSC at this target.',
  }
}

// ------------------------------------------------------------- DisplayPort

export interface DpRate {
  name: string
  /** Per-lane raw signalling rate, bits/s. */
  laneBps: number
  /** Line-code efficiency: 8b/10b below UHBR, 128b/132b at and above. */
  efficiency: number
  /** The DP version that introduced it. */
  since: string
}

export const DP_RATES: DpRate[] = [
  { name: 'RBR (1.62G)', laneBps: 1.62e9, efficiency: 0.8, since: 'DP 1.1' },
  { name: 'HBR (2.7G)', laneBps: 2.7e9, efficiency: 0.8, since: 'DP 1.1' },
  { name: 'HBR2 (5.4G)', laneBps: 5.4e9, efficiency: 0.8, since: 'DP 1.2' },
  { name: 'HBR3 (8.1G)', laneBps: 8.1e9, efficiency: 0.8, since: 'DP 1.3' },
  { name: 'UHBR10', laneBps: 10e9, efficiency: 128 / 132, since: 'DP 2.0' },
  { name: 'UHBR13.5', laneBps: 13.5e9, efficiency: 128 / 132, since: 'DP 2.0' },
  { name: 'UHBR20', laneBps: 20e9, efficiency: 128 / 132, since: 'DP 2.0' },
]

export interface DpRequirement {
  rate: DpRate | null
  lanes: number
  payloadBps: number
  utilisation: number
  note?: string
}

export function dpRequirement(t: Timing, s: SignalOptions, lanes: 1 | 2 | 4 = 4): DpRequirement {
  const payload = payloadBps(t, s)
  for (const r of DP_RATES) {
    const capacity = r.laneBps * lanes * r.efficiency
    if (payload <= capacity) {
      return {
        rate: r,
        lanes,
        payloadBps: payload,
        utilisation: payload / capacity,
        note:
          payload / capacity > 0.98
            ? 'Within 2% of the rate ceiling — DisplayPort transfer-unit overhead may put this over in practice.'
            : undefined,
      }
    }
  }
  return {
    rate: null,
    lanes,
    payloadBps: payload,
    utilisation: payload / (20e9 * lanes * (128 / 132)),
    note: 'Beyond UHBR20 on this lane count.',
  }
}

/** Single-link DVI tops out at 165 MHz; dual-link doubles it to 330. */
export function dviRequirement(t: Timing, s: SignalOptions): { link: 'single' | 'dual' | null; clockHz: number } {
  const clock = tmdsCharacterRateHz(t, s)
  if (!Number.isFinite(clock)) return { link: null, clockHz: clock }
  if (clock <= 165e6) return { link: 'single', clockHz: clock }
  if (clock <= 330e6) return { link: 'dual', clockHz: clock }
  return { link: null, clockHz: clock }
}

export const formatBps = (bps: number): string =>
  bps >= 1e9 ? `${(bps / 1e9).toFixed(2)} Gbps` : `${(bps / 1e6).toFixed(0)} Mbps`

export const formatHz = (hz: number): string =>
  hz >= 1e6 ? `${(hz / 1e6).toFixed(2)} MHz` : `${(hz / 1e3).toFixed(1)} kHz`
