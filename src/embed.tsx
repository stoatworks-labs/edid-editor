/**
 * The editor as a module another application embeds.
 *
 * `npm run build:embed` makes `dist-embed/edid-editor-embed.js` from this: one
 * dependency-free ES module — React, the stylesheet and the library inside it —
 * that a host with no build step of its own can copy in and import. LivePremier
 * Plus is the first: it vendors the file, mounts the editor in a window beside
 * the switcher's EDID page and hands it an `EdidHost` so a finished EDID goes
 * straight into a bank slot.
 *
 * Two surfaces, both here so they cannot drift from the site:
 *
 *   mount(el, host?)       the whole editor, as on the site, plus the host panel
 *   edidForTiming(…) etc.  the library alone, for a host that builds EDIDs
 *                          without showing an editor (a switcher's custom formats)
 *
 * The stylesheet is global — it styles `body` — so mount into a document of
 * the editor's own (a popped-out window), not into somebody else's page.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import css from './styles.css?inline'
import type { EdidHost } from './host.ts'
import type { Timing } from './lib/timing/types.ts'
import { edidAroundTiming, vicFor } from './lib/build.ts'
import { encodeEdid } from './lib/edid/encode.ts'
import { decodeEdid } from './lib/edid/decode.ts'
import { DEFAULT_SIGNAL } from './lib/link.ts'
import { displayName, primaryTiming } from './lib/primary.ts'
import { timingLabel, vFreq } from './lib/timing/types.ts'

export type { EdidHost, HostSlot } from './host.ts'
export type { Timing } from './lib/timing/types.ts'

export const version = __APP_VERSION__

const STYLE_ID = 'edid-editor-embed-css'

/** Put the editor in `el`. Returns a function that takes it out again. */
export function mount(el: HTMLElement, host?: EdidHost): () => void {
  const doc = el.ownerDocument
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.textContent = css
    doc.head.append(style)
  }
  const root = createRoot(el)
  root.render(
    <StrictMode>
      <App host={host} />
    </StrictMode>,
  )
  return () => root.unmount()
}

/**
 * A complete EDID around a timing somebody already decided — every porch kept.
 *
 * Carries the CTA VIC when the raster is exactly one, since consumer sources act
 * on VICs; otherwise the timing is the native detailed timing, with a CTA
 * extension only where the signal needs one. Answers the bytes, the name that
 * went into the name descriptor, and the build's notes.
 */
export function edidForTiming(
  timing: Timing,
  opts: { name?: string; bpc?: 8 | 10 | 12 } = {},
): { bytes: Uint8Array; name: string; label: string; vic?: number; notes: string[] } {
  const vic = vicFor(timing)
  const label = timingLabel(timing)
  const name = (opts.name || shortName(timing, label)).slice(0, 13)
  const r = edidAroundTiming(timing, {
    name,
    signal: { ...DEFAULT_SIGNAL, bpc: opts.bpc ?? 8 },
    standard: vic !== undefined ? 'cta' : 'manual',
    vic,
    fractional: Math.abs(vFreq(timing) - Math.round(vFreq(timing))) > 0.01,
  })
  return { bytes: encodeEdid(r.edid), name, label, vic, notes: r.notes }
}

/**
 * A name that fits the 13-character name descriptor without being cut
 * mid-number: "1920x1080p59." says less than "1080p59.94".
 */
function shortName(t: Timing, label: string): string {
  if (label.length <= 13) return label
  const rate = label.slice(label.search(/[pi][\d.]+$/))
  const short = `${t.vActive}${rate}`
  return short.length <= 13 ? short : label.slice(0, 13)
}

/** What an EDID says about itself, in brief: its name, its preferred mode, its problems. */
export function describeEdid(bytes: Uint8Array | number[]): {
  name: string
  mode: string | null
  timing: Timing | null
  errors: string[]
} {
  const r = decodeEdid(bytes)
  const t = primaryTiming(r.edid)
  return {
    name: displayName(r.edid),
    mode: t ? timingLabel(t) : null,
    timing: t,
    errors: r.issues.filter((i) => i.severity === 'error').map((i) => `${i.where}: ${i.message}`),
  }
}

export { timingLabel }
