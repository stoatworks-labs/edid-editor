import type { SignalOptions } from '../link.ts'
import { FRL_EFFICIENCY, bitsPerPixel, payloadBps, tmdsCharacterRateHz } from '../link.ts'
import type { Timing } from '../timing/types.ts'
import { vFreq } from '../timing/types.ts'
import type { CapacityMode, Connector, Device } from './types.ts'
import { DEVICE_LIST } from './devices.ts'

export type Status = 'supported' | 'conditional' | 'unsupported' | 'unknown'

export interface ConnectorVerdict {
  connector: Connector
  ok: boolean
  /** Why not, or what to watch. Empty on a clean pass. */
  reasons: string[]
  /** How much of the connector's ceiling the mode uses, 0-1. */
  headroom: number
}

export interface ModeVerdict {
  mode: CapacityMode
  ok: boolean
  connectors: ConnectorVerdict[]
}

export interface DeviceVerdict {
  device: Device
  status: Status
  /** The cheapest mode that works — what the operator has to set the box to. */
  requiredMode?: CapacityMode
  requiredConnector?: Connector
  modes: ModeVerdict[]
  warnings: string[]
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`
const mhz = (hz: number) => `${(hz / 1e6).toFixed(1)} MHz`

const FORMAT_NAMES: Record<string, string> = {
  rgb444: 'RGB 4:4:4',
  ycbcr444: 'YCbCr 4:4:4',
  ycbcr422: 'YCbCr 4:2:2',
  ycbcr420: 'YCbCr 4:2:0',
}

/** 8b/10b below UHBR — every DP rate modelled on these devices is 8b/10b. */
const DP_EFFICIENCY = 0.8

function checkConnector(c: Connector, t: Timing, s: SignalOptions): ConnectorVerdict {
  const reasons: string[] = []
  let headroom = 0

  if (!c.formats.includes(s.format)) {
    reasons.push(`does not accept ${FORMAT_NAMES[s.format] ?? s.format}`)
  }

  if (!s.dsc && s.bpc > c.maxBpc) {
    reasons.push(`${s.bpc}-bit exceeds the ${c.maxBpc}-bit ceiling`)
  }

  if (s.dsc && !c.dsc) {
    reasons.push('no DSC support — the compressed stream cannot be decoded here')
  }

  if (s.vrr && !c.vrr) {
    reasons.push('no variable refresh support — the source will be held to a fixed rate')
  }

  if (c.kind === 'hdmi' || c.kind === 'dvi') {
    const rate = tmdsCharacterRateHz(t, s)
    const fitsTmds = Number.isFinite(rate) && rate <= c.maxPixelClockHz
    if (c.frlBps && !fitsTmds) {
      // An HDMI 2.1 port moves to FRL when TMDS runs out, and FRL is a
      // payload budget, not a character rate.
      const capacity = c.frlBps * FRL_EFFICIENCY
      const payload = payloadBps(t, s)
      headroom = payload / capacity
      if (payload > capacity) {
        reasons.push(
          `needs ${(payload / 1e9).toFixed(2)} Gbps at ${bitsPerPixel(s)} bpp, FRL carries ${(capacity / 1e9).toFixed(2)} Gbps`,
        )
      }
    } else if (!Number.isFinite(rate)) {
      reasons.push('DSC needs an FRL link; this connector is TMDS only')
      headroom = 1
    } else {
      headroom = rate / c.maxPixelClockHz
      if (rate > c.maxPixelClockHz) {
        reasons.push(
          `needs ${mhz(rate)} of TMDS character rate, ceiling is ${mhz(c.maxPixelClockHz)}`,
        )
      }
    }
  } else if (c.kind === 'displayport') {
    // BOTH the vendor's pixel-clock ceiling and the raw link budget have to
    // pass. Quoting only one of them is how a spec sheet ends up disagreeing
    // with the box in the rack.
    const clockRatio = t.pixelClockHz / c.maxPixelClockHz
    if (t.pixelClockHz > c.maxPixelClockHz) {
      reasons.push(
        `needs a ${mhz(t.pixelClockHz)} pixel clock, ceiling is ${mhz(c.maxPixelClockHz)}`,
      )
    }
    let linkRatio = 0
    if (c.dpLaneBps && c.dpLanes) {
      const capacity = c.dpLaneBps * c.dpLanes * DP_EFFICIENCY
      const payload = payloadBps(t, s)
      linkRatio = payload / capacity
      if (payload > capacity) {
        reasons.push(
          `needs ${(payload / 1e9).toFixed(2)} Gbps at ${bitsPerPixel(s)} bpp, link carries ${(capacity / 1e9).toFixed(2)} Gbps`,
        )
      } else if (linkRatio > 0.98) {
        reasons.push(
          `at ${pct(linkRatio)} of the link budget — DisplayPort transfer-unit overhead may push this over in practice`,
        )
      }
    }
    headroom = Math.max(clockRatio, linkRatio)
  }

  // A "reason" that is only a caution still passes; a hard failure does not.
  const hard = reasons.filter((r) => !r.includes('may push this over'))
  return { connector: c, ok: hard.length === 0, reasons, headroom }
}

function checkMode(m: CapacityMode, t: Timing, s: SignalOptions): ModeVerdict {
  const connectors = m.connectors.map((c) => checkConnector(c, t, s))
  return { mode: m, ok: connectors.some((c) => c.ok), connectors }
}

export function evaluateDevice(d: Device, t: Timing, s: SignalOptions): DeviceVerdict {
  const warnings: string[] = []

  if (d.capacityModes.length === 0) {
    return { device: d, status: 'unknown', modes: [], warnings: ['No input capability recorded for this model.'] }
  }

  const rate = vFreq(t)
  if (d.minRefreshHz !== undefined && rate < d.minRefreshHz - 0.01) {
    warnings.push(`${rate.toFixed(2)} Hz is below the documented ${d.minRefreshHz} Hz minimum.`)
  }
  if (d.maxRefreshHz !== undefined && rate > d.maxRefreshHz + 0.01) {
    warnings.push(`${rate.toFixed(2)} Hz exceeds the documented ${d.maxRefreshHz} Hz maximum.`)
  }
  if (d.maxHActive !== undefined && t.hActive > d.maxHActive) {
    warnings.push(`${t.hActive} px wide exceeds the documented ${d.maxHActive} px maximum.`)
  }
  if (d.namedFormats?.length && !d.namedFormats.some((f) => t.hActive <= f.width && t.vActive <= f.height)) {
    warnings.push(
      `${t.hActive} × ${t.vActive} is not a format ${d.vendor} names for these inputs ` +
        `(${d.namedFormats.map((f) => f.label).join('; ')}), so it may not be accepted. Untested here.`,
    )
  }

  const modes = d.capacityModes.map((m) => checkMode(m, t, s))
  const working = modes.filter((m) => m.ok)

  if (working.length === 0) {
    return { device: d, status: 'unsupported', modes, warnings }
  }

  // Prefer a mode that costs nothing. When every working mode has a tradeoff,
  // the answer is still yes — but the operator has to go and set the box up,
  // which is exactly what 'conditional' is telling them.
  const free = working.find((m) => !m.mode.tradeoff)
  const chosen = free ?? working[0]
  const conn = chosen.connectors.find((c) => c.ok)!

  if (chosen.mode.tradeoff) warnings.push(chosen.mode.tradeoff)
  for (const r of conn.reasons) warnings.push(r)

  const hardBlocked = warnings.some((w) => /below the documented|exceeds the documented/.test(w))

  return {
    device: d,
    status: hardBlocked ? 'conditional' : free && warnings.length === 0 ? 'supported' : 'conditional',
    requiredMode: chosen.mode,
    requiredConnector: conn.connector,
    modes,
    warnings,
  }
}

export function evaluateAll(t: Timing, s: SignalOptions, devices: Device[] = DEVICE_LIST): DeviceVerdict[] {
  return devices.map((d) => evaluateDevice(d, t, s))
}
