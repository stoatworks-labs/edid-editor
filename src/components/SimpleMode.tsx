import { useState } from 'react'
import type { SimpleRequest } from '../lib/build.ts'
import { TIMING_STANDARDS } from '../lib/build.ts'
import type { ColorFormat, SignalOptions } from '../lib/link.ts'
import { Check, Num, Panel, Pick, Text } from './ui.tsx'

const PRESETS: { label: string; w: number; h: number; r: number }[] = [
  { label: '1920x1080 @60', w: 1920, h: 1080, r: 60 },
  { label: '1920x1200 @60', w: 1920, h: 1200, r: 60 },
  { label: '2560x1600 @60', w: 2560, h: 1600, r: 60 },
  { label: '3840x2160 @60', w: 3840, h: 2160, r: 60 },
  { label: '3840x2160 @30', w: 3840, h: 2160, r: 30 },
  { label: '4096x2160 @60', w: 4096, h: 2160, r: 60 },
  { label: '3840x2160 @120', w: 3840, h: 2160, r: 120 },
  { label: '1280x720 @60', w: 1280, h: 720, r: 60 },
  { label: '2048x1080 @60', w: 2048, h: 1080, r: 60 },
  { label: '8192x1080 @60', w: 8192, h: 1080, r: 60 },
  { label: '1920x1080 @240', w: 1920, h: 1080, r: 240 },
]

const FORMATS: { value: ColorFormat; label: string }[] = [
  { value: 'rgb444', label: 'RGB 4:4:4' },
  { value: 'ycbcr444', label: 'YCbCr 4:4:4' },
  { value: 'ycbcr422', label: 'YCbCr 4:2:2' },
  { value: 'ycbcr420', label: 'YCbCr 4:2:0' },
]

export function SimpleMode({
  req,
  onChange,
  onBuild,
  notes,
}: {
  req: SimpleRequest
  onChange: (r: SimpleRequest) => void
  onBuild: () => void
  notes: string[]
}) {
  const [custom, setCustom] = useState(false)
  const set = (patch: Partial<SimpleRequest>) => onChange({ ...req, ...patch })
  const setSig = (patch: Partial<SignalOptions>) => onChange({ ...req, signal: { ...req.signal, ...patch } })

  const presetLabel = PRESETS.find((p) => p.w === req.hActive && p.h === req.vActive && p.r === req.refreshHz)?.label

  return (
    <>
      <Panel title="What the display should say it is">
        <div className="grid c2">
          <Text
            label="EDID name"
            hint="13 characters, shown in every input menu"
            value={req.name}
            maxLength={13}
            placeholder="e.g. PDS4K-2160p60"
            onChange={(name) => set({ name })}
          />
          <Pick
            label="Preset"
            value={custom || !presetLabel ? 'custom' : presetLabel}
            options={[
              ...PRESETS.map((p) => ({ value: p.label, label: p.label })),
              { value: 'custom', label: 'Custom…' },
            ]}
            onChange={(v) => {
              if (v === 'custom') {
                setCustom(true)
                return
              }
              const p = PRESETS.find((x) => x.label === v)!
              setCustom(false)
              set({ hActive: p.w, vActive: p.h, refreshHz: p.r })
            }}
          />
        </div>

        <div className="grid c2" style={{ marginTop: 10 }}>
          <Num label="Product code" hint="0-65535" value={req.productCode} min={0} max={65535} onChange={(productCode) => set({ productCode })} />
          <Num
            label="Serial number"
            hint="its own for each unit"
            value={req.serialNumber}
            min={0}
            max={4294967295}
            onChange={(serialNumber) => set({ serialNumber })}
          />
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          A computer tells displays apart by maker, product code and serial number, not by name. Building several? Give
          each its own serial number, or a Mac can take two of them for one display.
        </div>

        <div className="grid c4" style={{ marginTop: 10 }}>
          <Num label="Width" hint="active px" value={req.hActive} min={8} max={16384} step={8} onChange={(hActive) => set({ hActive })} />
          <Num label="Height" hint="active lines" value={req.vActive} min={8} max={8192} onChange={(vActive) => set({ vActive })} />
          <Num
            label="Refresh"
            hint={req.interlaced ? 'Hz, field rate' : 'Hz'}
            value={req.refreshHz}
            min={1}
            max={480}
            step={1}
            onChange={(refreshHz) => set({ refreshHz })}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <Check label="Interlaced" checked={req.interlaced} onChange={(interlaced) => set({ interlaced })} />
            <Check
              label="Fractional (÷1.001)"
              title="59.94 rather than 60 — the pixel clock divides, the raster does not."
              checked={req.fractional}
              onChange={(fractional) => set({ fractional })}
            />
          </div>
        </div>

        <div className="grid c2" style={{ marginTop: 10 }}>
          <Pick label="Timing standard" value={req.standard} options={TIMING_STANDARDS} onChange={(standard) => set({ standard })} />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="go" onClick={onBuild} style={{ width: '100%' }}>
              Calculate
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Signal">
        <div className="grid c3">
          <Pick label="Colour format" value={req.signal.format} options={FORMATS} onChange={(format) => setSig({ format })} />
          <Pick
            label="Bit depth"
            hint="per component"
            value={req.signal.bpc}
            options={[
              { value: 8, label: '8-bit' },
              { value: 10, label: '10-bit' },
              { value: 12, label: '12-bit' },
              { value: 16, label: '16-bit' },
            ]}
            onChange={(bpc) => setSig({ bpc: bpc as 8 | 10 | 12 | 16 })}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <Check
              label="DSC (Display Stream Compression)"
              title="Commits the link to HDMI FRL — an HDMI 2.0 input cannot negotiate DSC at all."
              checked={req.signal.dsc}
              onChange={(dsc) => setSig({ dsc })}
            />
            <Check
              label="Variable refresh (VRR / VFR)"
              title="Written as a VRRmin/VRRmax window in the HDMI Forum block."
              checked={req.signal.vrr}
              onChange={(vrr) => setSig({ vrr })}
            />
          </div>
        </div>

        {req.signal.dsc ? (
          <div className="grid c3" style={{ marginTop: 10 }}>
            <Num
              label="DSC target"
              hint="bits per pixel, 12 is the usual visually-lossless target"
              value={req.signal.dscTargetBpp}
              min={6}
              max={24}
              onChange={(dscTargetBpp) => setSig({ dscTargetBpp })}
            />
            <div style={{ gridColumn: 'span 2' }}>
              <div className="note warn" style={{ marginTop: 18 }}>
                DSC travels only over HDMI fixed-rate link. Turning this on makes every HDMI 2.0 and earlier input in
                the table below say no — which is correct, not a bug in the table.
              </div>
            </div>
          </div>
        ) : null}

        {req.signal.vrr ? (
          <div className="grid c3" style={{ marginTop: 10 }}>
            <Num label="VRR minimum" hint="Hz" value={req.signal.vrrMinHz} min={1} max={500} onChange={(vrrMinHz) => setSig({ vrrMinHz })} />
            <Num label="VRR maximum" hint="Hz" value={req.signal.vrrMaxHz} min={1} max={500} onChange={(vrrMaxHz) => setSig({ vrrMaxHz })} />
            <div className="note" style={{ marginTop: 18 }}>
              Advertised in the HDMI Forum VSDB. None of the event processors here is documented to act on it; it is
              there for a source that will.
            </div>
          </div>
        ) : null}
      </Panel>

      {notes.length ? (
        <Panel title="What was built">
          {notes.map((n, i) => (
            <div key={i} className="banner">
              {n}
            </div>
          ))}
        </Panel>
      ) : null}
    </>
  )
}
