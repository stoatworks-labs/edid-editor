import type { ColorFormat } from '../link.ts'
import type { TimingStandard } from '../timing/types.ts'

export type ConnectorKind = 'hdmi' | 'displayport' | 'dvi' | 'sdi'

export interface Citation {
  /** What the claim is, in the source's own terms. */
  claim: string
  source: string
  url?: string
  /** When the source was read. */
  read: string
}

/**
 * How confident we are in a device's numbers.
 *
 * `documented`  the limit is stated in a vendor manual or spec sheet, cited.
 * `inferred`    the limit follows necessarily from a documented one (e.g. an
 *               HDMI 2.0 port cannot exceed 600 MHz), but the vendor does not
 *               state the number itself.
 * `unverified`  neither — a working assumption, badged as such everywhere.
 *
 * Nothing in this file may be `documented` without a citation. That invariant
 * is enforced by a test, not by discipline.
 */
export type Confidence = 'documented' | 'inferred' | 'unverified'

export interface Connector {
  kind: ConnectorKind
  /** As the vendor writes it: "HDMI 2.0", "DisplayPort 1.2", "Dual-Link DVI-D". */
  label: string
  count: number
  /**
   * Ceiling on the TMDS character rate (HDMI/DVI) or the pixel rate (DP), in Hz.
   *
   * For HDMI this is the hard limit the vendor quotes and is exact. For
   * DisplayPort a "600 MHz max" figure is a pixel-rate limit the vendor imposes
   * on top of the link rate, so BOTH it and the link budget have to pass.
   */
  maxPixelClockHz: number
  /** DisplayPort link budget, when the connector is DP. */
  dpLaneBps?: number
  dpLanes?: number
  maxBpc: 8 | 10 | 12 | 16
  formats: ColorFormat[]
  hdcp: string[]
  dsc: boolean
  vrr: boolean
}

/**
 * A way of configuring the device's connectors.
 *
 * This is the thing the user asked to see: a Barco E2 Gen 1 card is FOUR
 * 1200p60 inputs, or TWO 4K30, or ONE 4K60 using two cables — same hardware,
 * three different answers to "will it take my EDID". An Aquilon DP card is four
 * DP 1.2 ports or two DP 1.4 ports. A LiveCore DVI input is single-link, or
 * dual-link at the cost of the neighbouring input.
 *
 * A device with no such choice has exactly one mode, named "Standard".
 */
export interface CapacityMode {
  id: string
  label: string
  /** What it costs — usually other inputs. Empty when nothing is given up. */
  tradeoff?: string
  connectors: Connector[]
}

export interface NamedFormat {
  width: number
  height: number
  /** As the vendor puts it, e.g. "custom formats such as 8192 × 1080 @ 60". */
  label: string
}

export interface Device {
  id: string
  vendor: string
  family: string
  model: string
  /**
   * `sink` reads the EDID you build (a processor input).
   * `source` reads someone else's EDID and must be able to GENERATE the mode
   *   — a media server or LED processor feeding a wall. The question is the
   *   same shape but the answer is about output capability.
   */
  role: 'sink' | 'source'
  /** Timing standards the inputs are documented to accept. */
  standards?: TimingStandard[]
  minRefreshHz?: number
  maxRefreshHz?: number
  /** Widest active line the device will take, where documented. */
  maxHActive?: number
  maxVActive?: number
  /**
   * The formats the vendor names for these inputs, each as a box: a mode no
   * wider and no taller than one of them is a format the vendor documents. A
   * mode outside every box is not refused, because vendors list examples
   * rather than ceilings, but the verdict says it is not one they name and may
   * not be accepted. Only what the vendor actually names (rule 2 in devices.ts).
   */
  namedFormats?: NamedFormat[]
  capacityModes: CapacityMode[]
  /**
   * Take another device's capacity modes verbatim, by id.
   *
   * For models that genuinely ARE the same input platform under a different
   * name — a NeXtage is a LiveCore. Deliberately explicit rather than matched
   * on `family`: an EX chassis is in the Event Master family but accepts either
   * generation of card, so guessing by family handed it the Gen 1 dual-cable
   * answer and stated it as fact. A device with neither modes nor an
   * inheritsFrom reports 'unknown', which is the honest answer.
   */
  inheritsFrom?: string
  notes: string[]
  confidence: Confidence
  citations: Citation[]
}
