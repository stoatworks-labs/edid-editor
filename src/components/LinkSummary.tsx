import type { SignalOptions } from '../lib/link.ts'
import {
  bitsPerPixel,
  dpRequirement,
  dviRequirement,
  formatBps,
  formatHz,
  hdmiRequirement,
} from '../lib/link.ts'
import type { Timing } from '../lib/timing/types.ts'
import { frameRate, hFreq, hTotal, vFreq, vTotal } from '../lib/timing/types.ts'
import { Panel, Stat } from './ui.tsx'

/**
 * What the mode costs, and the smallest interface version that carries it.
 *
 * The DVI row is here because half this fleet's kit is DVI-era and "single or
 * dual link?" is the first question anyone asks about a LiveCore input.
 */
export function LinkSummary({ timing, signal }: { timing: Timing; signal: SignalOptions }) {
  const hdmi = hdmiRequirement(timing, signal)
  const dp4 = dpRequirement(timing, signal, 4)
  const dp2 = dpRequirement(timing, signal, 2)
  const dvi = dviRequirement(timing, signal)
  // 4:2:2 is the one format the two links charge differently, so it shows both.
  const hdmiBpp = bitsPerPixel(signal, 'hdmi')
  const dpBpp = bitsPerPixel(signal, 'displayport')
  const perLink = (f: (bpp: number) => string) =>
    hdmiBpp === dpBpp ? f(hdmiBpp) : `${f(hdmiBpp)} HDMI, ${f(dpBpp)} DP`

  return (
    <Panel title="Signal cost and required interface">
      <div className="stats">
        <Stat k="Pixel clock" v={formatHz(timing.pixelClockHz)} />
        <Stat k="Raster" v={`${hTotal(timing)} x ${vTotal(timing)}`} />
        <Stat k="Line rate" v={`${(hFreq(timing) / 1000).toFixed(2)} kHz`} />
        <Stat
          k={timing.interlaced ? 'Field rate' : 'Refresh'}
          v={`${vFreq(timing).toFixed(3)} Hz`}
        />
        {timing.interlaced ? <Stat k="Frame rate" v={`${frameRate(timing).toFixed(3)} Hz`} /> : null}
        <Stat k="Bits per pixel" v={perLink((bpp) => `${bpp}`)} />
        <Stat k="Payload" v={perLink((bpp) => formatBps(timing.pixelClockHz * bpp))} />
      </div>

      <h3>Minimum interface version</h3>
      <div className="stats">
        <Stat
          k="HDMI"
          small
          v={hdmi.version ? hdmi.version.name : 'no HDMI version carries this'}
        />
        <Stat
          k="DisplayPort (4 lane)"
          small
          v={dp4.rate ? `${dp4.rate.name} — ${dp4.rate.since}` : 'beyond UHBR20'}
        />
        <Stat
          k="DisplayPort (2 lane)"
          small
          v={dp2.rate ? `${dp2.rate.name} — ${dp2.rate.since}` : 'beyond UHBR20'}
        />
        <Stat
          k="DVI"
          small
          v={dvi.link === 'single' ? 'Single link' : dvi.link === 'dual' ? 'Dual link' : 'beyond dual link'}
        />
      </div>

      <div className="note">
        {hdmi.viaTmds ? (
          <>
            TMDS character rate {formatHz(hdmi.tmdsCharacterRateHz)} — {(hdmi.utilisation * 100).toFixed(0)}% of that
            version&rsquo;s ceiling.
          </>
        ) : hdmi.version ? (
          <>
            Needs a fixed-rate link: {formatBps(hdmi.payloadBps)} at {(hdmi.utilisation * 100).toFixed(0)}% of{' '}
            {hdmi.version.name.replace('HDMI 2.1 ', '')} after 16b/18b coding.
          </>
        ) : null}
      </div>
      {hdmi.note ? <div className="note warn">{hdmi.note}</div> : null}
      {dp4.note ? <div className="note warn">DisplayPort: {dp4.note}</div> : null}
      <div className="note">
        DisplayPort figures are the raw link budget after line coding. Real capacity is a little lower because the
        stream is packed into transfer units with per-line overhead, so treat anything above 98% as marginal rather
        than as a pass. HDMI TMDS is a clock ceiling and is exact.
      </div>
    </Panel>
  )
}
