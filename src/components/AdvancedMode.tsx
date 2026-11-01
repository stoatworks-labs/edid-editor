import type {
  CtaExtension,
  Descriptor,
  DisplayIdExtension,
  Edid,
  StandardTiming,
} from '../lib/edid/types.ts'
import { ESTABLISHED_EXTRA, ESTABLISHED_I_II, ESTABLISHED_III_MODES } from '../lib/edid/tables.ts'
import { emptyCta } from '../lib/edid/defaults.ts'
import { CTA_TIMINGS } from '../lib/timing/cta.ts'
import type { Timing } from '../lib/timing/types.ts'
import { frameLines, hFreq, hTotal, vFreq } from '../lib/timing/types.ts'
import { Check, Num, Panel, Pick, Text } from './ui.tsx'

type Patch = (e: Edid) => void

/** Structural editing on a frozen-by-convention object: clone, mutate, hand back. */
function edit(edid: Edid, fn: Patch): Edid {
  const next: Edid = JSON.parse(JSON.stringify(edid))
  fn(next)
  return next
}

const DESCRIPTOR_KINDS: { value: Descriptor['kind']; label: string }[] = [
  { value: 'dtd', label: 'Detailed timing' },
  { value: 'name', label: 'Display name' },
  { value: 'serial', label: 'Serial number (text)' },
  { value: 'text', label: 'Free text' },
  { value: 'range', label: 'Display range limits' },
  { value: 'established-iii', label: 'Established timings III' },
  { value: 'dummy', label: 'Unused' },
]

function blankDescriptor(kind: Descriptor['kind'], t: Timing | null): Descriptor {
  switch (kind) {
    case 'dtd':
      return {
        kind: 'dtd',
        timing: t ?? {
          hActive: 1920, hFront: 88, hSync: 44, hBack: 148,
          vActive: 1080, vFront: 4, vSync: 5, vBack: 36,
          pixelClockHz: 148_500_000, interlaced: false,
          hSyncPositive: true, vSyncPositive: true,
        },
        hSizeMm: 0, vSizeMm: 0, hBorder: 0, vBorder: 0,
        syncType: 'digital-separate', stereo: 'none',
      }
    case 'name': return { kind: 'name', text: '' }
    case 'serial': return { kind: 'serial', text: '' }
    case 'text': return { kind: 'text', text: '' }
    case 'range':
      return {
        kind: 'range',
        minVerticalHz: 24, maxVerticalHz: 60,
        minHorizontalKHz: 15, maxHorizontalKHz: 140,
        maxPixelClockMHz: 300, support: 'range-limits-only',
      }
    case 'established-iii': return { kind: 'established-iii', modes: [] }
    default: return { kind: 'dummy' }
  }
}

function TimingEditor({ t, onChange }: { t: Timing; onChange: (t: Timing) => void }) {
  const set = (p: Partial<Timing>) => onChange({ ...t, ...p })
  return (
    <>
      <div className="grid c4">
        <Num label="H active" value={t.hActive} onChange={(hActive) => set({ hActive })} />
        <Num label="H front porch" value={t.hFront} onChange={(hFront) => set({ hFront })} />
        <Num label="H sync width" value={t.hSync} onChange={(hSync) => set({ hSync })} />
        <Num label="H back porch" value={t.hBack} onChange={(hBack) => set({ hBack })} />
        <Num label="V active" hint={t.interlaced ? 'lines per field' : undefined} value={t.vActive} onChange={(vActive) => set({ vActive })} />
        <Num label="V front porch" value={t.vFront} onChange={(vFront) => set({ vFront })} />
        <Num label="V sync width" value={t.vSync} onChange={(vSync) => set({ vSync })} />
        <Num label="V back porch" value={t.vBack} onChange={(vBack) => set({ vBack })} />
      </div>
      <div className="grid c4" style={{ marginTop: 10 }}>
        <Num
          label="Pixel clock"
          hint="MHz — a DTD stores 10 kHz steps"
          value={Number((t.pixelClockHz / 1e6).toFixed(4))}
          step={0.01}
          onChange={(v) => set({ pixelClockHz: Math.round(v * 1e6) })}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
          <Check label="Interlaced" checked={t.interlaced} onChange={(interlaced) => set({ interlaced })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
          <Check label="+H sync" checked={t.hSyncPositive} onChange={(hSyncPositive) => set({ hSyncPositive })} />
          <Check label="+V sync" checked={t.vSyncPositive} onChange={(vSyncPositive) => set({ vSyncPositive })} />
        </div>
        <div className="note" style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>
          {hTotal(t)} x {frameLines(t)} raster · {(hFreq(t) / 1000).toFixed(2)} kHz ·{' '}
          {vFreq(t).toFixed(3)} Hz
        </div>
      </div>
    </>
  )
}

function DescriptorEditor({
  d, index, onChange, fallbackTiming,
}: {
  d: Descriptor
  index: number
  onChange: (d: Descriptor) => void
  fallbackTiming: Timing | null
}) {
  return (
    <div style={{ borderTop: index ? '1px solid var(--line)' : undefined, paddingTop: index ? 12 : 0, marginTop: index ? 12 : 0 }}>
      <div className="grid c2">
        <Pick
          label={`Descriptor ${index + 1}`}
          hint={index === 0 ? 'EDID 1.4: this one is the preferred timing' : undefined}
          value={d.kind}
          options={DESCRIPTOR_KINDS}
          onChange={(kind) => onChange(blankDescriptor(kind, fallbackTiming))}
        />
      </div>

      {d.kind === 'dtd' ? (
        <div style={{ marginTop: 10 }}>
          <TimingEditor t={d.timing} onChange={(timing) => onChange({ ...d, timing })} />
          <div className="grid c4" style={{ marginTop: 10 }}>
            <Num label="Image width" hint="mm, 0 = not stated" value={d.hSizeMm} onChange={(hSizeMm) => onChange({ ...d, hSizeMm })} />
            <Num label="Image height" hint="mm" value={d.vSizeMm} onChange={(vSizeMm) => onChange({ ...d, vSizeMm })} />
            <Num label="H border" value={d.hBorder} onChange={(hBorder) => onChange({ ...d, hBorder })} />
            <Num label="V border" value={d.vBorder} onChange={(vBorder) => onChange({ ...d, vBorder })} />
          </div>
        </div>
      ) : null}

      {d.kind === 'name' || d.kind === 'serial' || d.kind === 'text' ? (
        <div className="grid c2" style={{ marginTop: 10 }}>
          <Text label="Text" hint="13 characters, ASCII" value={d.text} maxLength={13} onChange={(text) => onChange({ ...d, text })} />
        </div>
      ) : null}

      {d.kind === 'range' ? (
        <>
          <div className="grid c3" style={{ marginTop: 10 }}>
            <Num label="Min vertical" hint="Hz" value={d.minVerticalHz} onChange={(v) => onChange({ ...d, minVerticalHz: v })} />
            <Num label="Max vertical" hint="Hz" value={d.maxVerticalHz} onChange={(v) => onChange({ ...d, maxVerticalHz: v })} />
            <Num label="Max pixel clock" hint="MHz, stored in 10 MHz steps" value={d.maxPixelClockMHz} step={10} onChange={(v) => onChange({ ...d, maxPixelClockMHz: v })} />
            <Num label="Min horizontal" hint="kHz" value={d.minHorizontalKHz} onChange={(v) => onChange({ ...d, minHorizontalKHz: v })} />
            <Num label="Max horizontal" hint="kHz" value={d.maxHorizontalKHz} onChange={(v) => onChange({ ...d, maxHorizontalKHz: v })} />
            <Pick
              label="Timing support"
              value={d.support}
              options={[
                { value: 'range-limits-only', label: 'Range limits only' },
                { value: 'default-gtf', label: 'Default GTF' },
                { value: 'secondary-gtf', label: 'Secondary GTF' },
                { value: 'cvt', label: 'CVT supported' },
              ]}
              onChange={(support) => onChange({ ...d, support })}
            />
          </div>
          {d.support === 'cvt' ? (
            <div className="note">
              CVT parameters are written from the mode when the EDID is built in simple mode. Editing them by hand is
              not exposed — the fields interact, and a hand-built combination that contradicts the range limits is
              worse than none.
            </div>
          ) : null}
        </>
      ) : null}

      {d.kind === 'established-iii' ? (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '4px 10px' }}>
          {ESTABLISHED_III_MODES.map((m) => (
            <Check
              key={m}
              label={m}
              checked={d.modes.includes(m)}
              onChange={(on) =>
                onChange({ ...d, modes: on ? [...d.modes, m] : d.modes.filter((x) => x !== m) })
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CtaEditor({ cta, onChange }: { cta: CtaExtension; onChange: (c: CtaExtension) => void }) {
  const set = (p: Partial<CtaExtension>) => onChange({ ...cta, ...p })
  const hf = cta.hdmiForumVsdb

  return (
    <>
      <div className="grid c4">
        <Num label="Revision" value={cta.revision} min={1} max={4} onChange={(revision) => set({ revision })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
          <Check label="Basic audio" checked={cta.basicAudio} onChange={(basicAudio) => set({ basicAudio })} />
          <Check label="Underscan (IT)" checked={cta.underscanIt} onChange={(underscanIt) => set({ underscanIt })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
          <Check label="YCbCr 4:4:4" checked={cta.ycbcr444} onChange={(ycbcr444) => set({ ycbcr444 })} />
          <Check label="YCbCr 4:2:2" checked={cta.ycbcr422} onChange={(ycbcr422) => set({ ycbcr422 })} />
        </div>
      </div>

      <h3>Video descriptors (VICs)</h3>
      <div className="note" style={{ marginBottom: 8 }}>
        A consumer HDMI source acts on these and routinely ignores a detailed timing that says the same thing. The
        first is written native; above VIC 64 the native flag does not exist.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '3px 10px', maxHeight: 220, overflowY: 'auto' }}>
        {CTA_TIMINGS.map((t) => {
          const on = cta.videoDescriptors.some((v) => v.vic === t.vic)
          return (
            <Check
              key={t.vic}
              label={t.name}
              checked={on}
              onChange={(want) =>
                set({
                  videoDescriptors: want
                    ? [...cta.videoDescriptors, { vic: t.vic, native: cta.videoDescriptors.length === 0 && t.vic <= 64 }]
                    : cta.videoDescriptors.filter((v) => v.vic !== t.vic),
                })
              }
            />
          )
        })}
      </div>

      <h3>HDMI vendor-specific block</h3>
      {cta.hdmiVsdb ? (
        <div className="grid c4">
          <Num
            label="Max TMDS clock"
            hint="MHz, 5 MHz steps"
            value={cta.hdmiVsdb.maxTmdsClockMHz}
            step={5}
            onChange={(v) => set({ hdmiVsdb: { ...cta.hdmiVsdb!, maxTmdsClockMHz: v } })}
          />
          <Text
            label="Physical address"
            hint="A.B.C.D"
            value={cta.hdmiVsdb.physicalAddress.join('.')}
            onChange={(v) => {
              const parts = v.split('.').map((x) => Math.max(0, Math.min(15, Number(x) || 0)))
              while (parts.length < 4) parts.push(0)
              set({ hdmiVsdb: { ...cta.hdmiVsdb!, physicalAddress: parts.slice(0, 4) as [number, number, number, number] } })
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <Check label="Deep colour 30-bit" checked={cta.hdmiVsdb.deepColor30} onChange={(x) => set({ hdmiVsdb: { ...cta.hdmiVsdb!, deepColor30: x } })} />
            <Check label="Deep colour 36-bit" checked={cta.hdmiVsdb.deepColor36} onChange={(x) => set({ hdmiVsdb: { ...cta.hdmiVsdb!, deepColor36: x } })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <Check label="YCbCr 4:4:4 deep colour" checked={cta.hdmiVsdb.deepColorY444} onChange={(x) => set({ hdmiVsdb: { ...cta.hdmiVsdb!, deepColorY444: x } })} />
            <Check label="DVI dual link" checked={cta.hdmiVsdb.dviDual} onChange={(x) => set({ hdmiVsdb: { ...cta.hdmiVsdb!, dviDual: x } })} />
          </div>
        </div>
      ) : (
        <button className="minor" onClick={() => set({ hdmiVsdb: { physicalAddress: [1, 0, 0, 0], supportsAi: false, deepColor30: false, deepColor36: false, deepColor48: false, deepColorY444: false, dviDual: false, maxTmdsClockMHz: 300 } })}>
          Add HDMI VSDB
        </button>
      )}

      <h3>HDMI Forum block — DSC, VRR, FRL</h3>
      {hf ? (
        <>
          <div className="grid c4">
            <Num label="Max TMDS char rate" hint="MHz" value={hf.maxTmdsCharacterRateMHz} step={5} onChange={(v) => set({ hdmiForumVsdb: { ...hf, maxTmdsCharacterRateMHz: v } })} />
            <Pick
              label="Max FRL rate"
              value={hf.maxFrlRate}
              options={[
                { value: 0, label: 'TMDS only' },
                { value: 1, label: '3 lanes x 3G — 9G' },
                { value: 2, label: '3 lanes x 6G — 18G' },
                { value: 3, label: '4 lanes x 6G — 24G' },
                { value: 4, label: '4 lanes x 8G — 32G' },
                { value: 5, label: '4 lanes x 10G — 40G' },
                { value: 6, label: '4 lanes x 12G — 48G' },
              ]}
              onChange={(maxFrlRate) => set({ hdmiForumVsdb: { ...hf, maxFrlRate } })}
            />
            <Num label="VRR minimum" hint="Hz, 0 = off" value={hf.vrrMin} onChange={(vrrMin) => set({ hdmiForumVsdb: { ...hf, vrrMin } })} />
            <Num label="VRR maximum" hint="Hz" value={hf.vrrMax} onChange={(vrrMax) => set({ hdmiForumVsdb: { ...hf, vrrMax } })} />
          </div>
          <div className="grid c4" style={{ marginTop: 10 }}>
            <Check label="DSC capable" checked={hf.dscCapable} onChange={(dscCapable) => set({ hdmiForumVsdb: { ...hf, dscCapable } })} />
            <Check label="DSC 10 bpc" checked={hf.dsc10bpc} onChange={(dsc10bpc) => set({ hdmiForumVsdb: { ...hf, dsc10bpc } })} />
            <Check label="DSC 12 bpc" checked={hf.dsc12bpc} onChange={(dsc12bpc) => set({ hdmiForumVsdb: { ...hf, dsc12bpc } })} />
            <Check label="DSC native 4:2:0" checked={hf.dscNative420} onChange={(dscNative420) => set({ hdmiForumVsdb: { ...hf, dscNative420 } })} />
            <Check label="SCDC present" checked={hf.scdcPresent} onChange={(scdcPresent) => set({ hdmiForumVsdb: { ...hf, scdcPresent } })} />
            <Check label="Scrambling ≤340 Mcsc" checked={hf.lte340ScrambleSupported} onChange={(x) => set({ hdmiForumVsdb: { ...hf, lte340ScrambleSupported: x } })} />
            <Check label="ALLM" checked={hf.allmSupported} onChange={(allmSupported) => set({ hdmiForumVsdb: { ...hf, allmSupported } })} />
            <Check label="QMS" checked={hf.qmsSupported} onChange={(qmsSupported) => set({ hdmiForumVsdb: { ...hf, qmsSupported } })} />
          </div>
          <div className="note">
            Bit assignments in this block follow edid-decode&rsquo;s reading of HDMI 2.1 and have not been checked
            against a device. See AGENTS.md.
          </div>
          <button className="minor" style={{ marginTop: 8 }} onClick={() => set({ hdmiForumVsdb: undefined })}>
            Remove
          </button>
        </>
      ) : (
        <button
          className="minor"
          onClick={() =>
            set({
              hdmiForumVsdb: {
                version: 1, maxTmdsCharacterRateMHz: 600, scdcPresent: true, rrCapable: true,
                lte340ScrambleSupported: true, deepColor420_30: false, deepColor420_36: false, deepColor420_48: false,
                maxFrlRate: 0, dscCapable: false, dsc10bpc: false, dsc12bpc: false, dscNative420: false,
                dscAllBpp: false, dscMaxFrlRate: 0, dscMaxSlices: 0, dscTotalChunkKBytes: 0,
                vrrMin: 0, vrrMax: 0, qmsSupported: false, qmsTfrMin: false, qmsTfrMax: false,
                allmSupported: false, fvaSupported: false, cnmVrr: false, cinemaVrr: false, mDelta: false,
              },
            })
          }
        >
          Add HDMI Forum block
        </button>
      )}
    </>
  )
}

export function AdvancedMode({
  edid, onChange, primary,
}: {
  edid: Edid
  onChange: (e: Edid) => void
  primary: Timing | null
}) {
  const set = (p: Partial<Edid>) => onChange({ ...edid, ...p })
  const cta = edid.extensions.find((x) => x.kind === 'cta') as CtaExtension | undefined
  const did = edid.extensions.find((x) => x.kind === 'displayid') as DisplayIdExtension | undefined

  return (
    <>
      <Panel title="Identity">
        <div className="grid c4">
          <Text
            label="Manufacturer"
            hint="3 letters — PNP ID"
            value={edid.manufacturerId}
            maxLength={3}
            onChange={(v) => set({ manufacturerId: v.toUpperCase().replace(/[^A-Za-z]/g, '') })}
          />
          <Num label="Product code" value={edid.productCode} min={0} max={65535} onChange={(productCode) => set({ productCode })} />
          <Num label="Serial number" value={edid.serialNumber} min={0} onChange={(serialNumber) => set({ serialNumber })} />
          <Num label="Year" value={edid.year} min={1990} max={2245} onChange={(year) => set({ year })} />
          <Num label="Week" hint="1-54" value={edid.week} min={0} max={54} onChange={(week) => set({ week })} />
          <Num label="EDID version" value={edid.version} min={1} max={1} onChange={(version) => set({ version })} />
          <Num label="EDID revision" hint="4 = EDID 1.4" value={edid.revision} min={0} max={4} onChange={(revision) => set({ revision })} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <Check label="Year is a MODEL year" checked={edid.isModelYear} onChange={(isModelYear) => set({ isModelYear })} />
          </div>
        </div>
        <div className="note">
          The manufacturer field is a registered PNP ID. Writing a real vendor&rsquo;s code onto an EDID you made up
          will make a device report the wrong maker — pick something that is not registered unless you are
          reproducing a specific display on purpose.
        </div>
      </Panel>

      <Panel title="Video input">
        <div className="grid c4">
          <Pick
            label="Input type"
            value={edid.input.kind}
            options={[
              { value: 'digital', label: 'Digital' },
              { value: 'analog', label: 'Analog' },
            ]}
            onChange={(kind) =>
              set({
                input:
                  kind === 'digital'
                    ? { kind: 'digital', bitDepth: 8, interface: 'hdmi-a' }
                    : { kind: 'analog', levels: 0, blankToBlackSetup: false, separateSyncSupported: true, compositeSyncSupported: true, syncOnGreenSupported: false, vsyncSerrated: true },
              })
            }
          />
          {edid.input.kind === 'digital' ? (
            <>
              <Pick
                label="Bit depth"
                value={String(edid.input.bitDepth)}
                options={['undefined', '6', '8', '10', '12', '14', '16'].map((v) => ({ value: v, label: v === 'undefined' ? 'Undefined' : `${v}-bit` }))}
                onChange={(v) => set({ input: { ...(edid.input as { kind: 'digital'; bitDepth: unknown; interface: unknown }), bitDepth: v === 'undefined' ? 'undefined' : (Number(v) as 6) } as Edid['input'] })}
              />
              <Pick
                label="Interface"
                value={edid.input.interface}
                options={[
                  { value: 'undefined', label: 'Undefined' },
                  { value: 'dvi', label: 'DVI' },
                  { value: 'hdmi-a', label: 'HDMI-a' },
                  { value: 'hdmi-b', label: 'HDMI-b' },
                  { value: 'mddi', label: 'MDDI' },
                  { value: 'displayport', label: 'DisplayPort' },
                ]}
                onChange={(v) => set({ input: { ...(edid.input as { kind: 'digital' }), interface: v } as Edid['input'] })}
              />
            </>
          ) : null}
        </div>

        <div className="grid c4" style={{ marginTop: 10 }}>
          <Num label="Screen width" hint="cm, 0 = undefined" value={edid.screenWidthCm} min={0} max={255} onChange={(screenWidthCm) => set({ screenWidthCm })} />
          <Num label="Screen height" hint="cm" value={edid.screenHeightCm} min={0} max={255} onChange={(screenHeightCm) => set({ screenHeightCm })} />
          <Num
            label="Gamma"
            hint="1.00-3.54"
            value={edid.gamma ?? 2.2}
            step={0.01}
            min={1}
            max={3.54}
            onChange={(gamma) => set({ gamma })}
          />
          <Pick
            label="Colour encoding"
            value={edid.features.colorEncoding}
            options={[
              { value: 'rgb444', label: 'RGB 4:4:4' },
              { value: 'rgb444-ycrcb444', label: 'RGB + YCrCb 4:4:4' },
              { value: 'rgb444-ycrcb422', label: 'RGB + YCrCb 4:2:2' },
              { value: 'rgb444-ycrcb444-ycrcb422', label: 'RGB + both YCrCb' },
            ]}
            onChange={(colorEncoding) => set({ features: { ...edid.features, colorEncoding } })}
          />
        </div>

        <div className="grid c3" style={{ marginTop: 10 }}>
          <Check label="Preferred timing is native" checked={edid.features.preferredTimingIsNative} onChange={(v) => set({ features: { ...edid.features, preferredTimingIsNative: v } })} />
          <Check
            label="Continuous frequency"
            title="The display takes any rate inside the range descriptor, not only the listed modes. This is what legalises a processor's custom output."
            checked={edid.features.continuousFrequency}
            onChange={(v) => set({ features: { ...edid.features, continuousFrequency: v } })}
          />
          <Check label="sRGB is the default colour space" checked={edid.features.srgbDefault} onChange={(v) => set({ features: { ...edid.features, srgbDefault: v } })} />
          <Check label="Standby" checked={edid.features.standby} onChange={(v) => set({ features: { ...edid.features, standby: v } })} />
          <Check label="Suspend" checked={edid.features.suspend} onChange={(v) => set({ features: { ...edid.features, suspend: v } })} />
          <Check label="Active off" checked={edid.features.activeOff} onChange={(v) => set({ features: { ...edid.features, activeOff: v } })} />
        </div>
      </Panel>

      <Panel title="Chromaticity">
        <div className="grid c4">
          {(
            [
              ['redX', 'Red x'], ['redY', 'Red y'],
              ['greenX', 'Green x'], ['greenY', 'Green y'],
              ['blueX', 'Blue x'], ['blueY', 'Blue y'],
              ['whiteX', 'White x'], ['whiteY', 'White y'],
            ] as const
          ).map(([k, label]) => (
            <Num
              key={k}
              label={label}
              value={Number(edid.chromaticity[k].toFixed(4))}
              step={0.001}
              min={0}
              max={0.999}
              onChange={(v) => set({ chromaticity: { ...edid.chromaticity, [k]: v } })}
            />
          ))}
        </div>
        <div className="note">Stored as 10-bit fractions, so the nearest representable step is about 0.001.</div>
      </Panel>

      <Panel title="Established timings">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '4px 10px' }}>
          {[...ESTABLISHED_I_II, ESTABLISHED_EXTRA].map((m) => (
            <Check
              key={m}
              label={m}
              checked={!!edid.established[m]}
              onChange={(on) => {
                const established = { ...edid.established }
                if (on) established[m] = true
                else delete established[m]
                set({ established })
              }}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Standard timings">
        <div className="grid c2">
          {edid.standardTimings.map((st, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <span className="note" style={{ width: 16, margin: 0 }}>{i + 1}</span>
              <input
                type="number"
                style={{ width: 90 }}
                value={st?.hActive ?? 0}
                step={8}
                onChange={(e) => {
                  const hActive = Number(e.target.value)
                  const next = [...edid.standardTimings]
                  next[i] = hActive >= 256 ? { hActive, aspect: st?.aspect ?? '16:9', refreshHz: st?.refreshHz ?? 60 } : null
                  set({ standardTimings: next })
                }}
              />
              <select
                value={st?.aspect ?? '16:9'}
                disabled={!st}
                style={{ width: 84 }}
                onChange={(e) => {
                  const next = [...edid.standardTimings]
                  if (next[i]) next[i] = { ...(next[i] as StandardTiming), aspect: e.target.value as StandardTiming['aspect'] }
                  set({ standardTimings: next })
                }}
              >
                {['16:10', '4:3', '5:4', '16:9'].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <input
                type="number"
                style={{ width: 76 }}
                value={st?.refreshHz ?? 60}
                min={60}
                max={123}
                disabled={!st}
                onChange={(e) => {
                  const next = [...edid.standardTimings]
                  if (next[i]) next[i] = { ...(next[i] as StandardTiming), refreshHz: Number(e.target.value) }
                  set({ standardTimings: next })
                }}
              />
              <button className="minor" onClick={() => { const next = [...edid.standardTimings]; next[i] = null; set({ standardTimings: next }) }}>
                clear
              </button>
            </div>
          ))}
        </div>
        <div className="note">
          Width must be a multiple of 8 from 256 to 2288, and the rate a whole number from 60 to 123 — that is the
          whole field. Anything else needs a detailed timing.
        </div>
      </Panel>

      <Panel title="Descriptors">
        {edid.descriptors.map((d, i) => (
          <DescriptorEditor
            key={i}
            d={d}
            index={i}
            fallbackTiming={primary}
            onChange={(nd) => {
              const next = [...edid.descriptors]
              next[i] = nd
              set({ descriptors: next })
            }}
          />
        ))}
      </Panel>

      <Panel
        title="CTA-861 extension"
        right={
          cta ? (
            <button className="minor" onClick={() => set({ extensions: edid.extensions.filter((x) => x !== cta) })}>
              Remove
            </button>
          ) : (
            <button className="minor" onClick={() => set({ extensions: [...edid.extensions, emptyCta()] })}>
              Add
            </button>
          )
        }
      >
        {cta ? (
          <CtaEditor
            cta={cta}
            onChange={(next) => set({ extensions: edid.extensions.map((x) => (x === cta ? next : x)) })}
          />
        ) : (
          <div className="note">
            No CTA extension. Without one an EDID says nothing about HDMI, audio, HDR, 4:2:0 or deep colour — a sink
            that only has a base block is treated as DVI.
          </div>
        )}
      </Panel>

      <Panel
        title="DisplayID 2.0 extension"
        right={
          did ? (
            <button className="minor" onClick={() => set({ extensions: edid.extensions.filter((x) => x !== did) })}>
              Remove
            </button>
          ) : (
            <button
              className="minor"
              onClick={() =>
                set({
                  extensions: [
                    ...edid.extensions,
                    {
                      kind: 'displayid', version: 0x20, primaryUseCase: 3, extensionCount: 0,
                      type7Timings: primary ? [{ timing: primary, preferred: true, aspect: '16:9', fractional: false }] : [],
                      unknownBlocks: [],
                    } as DisplayIdExtension,
                  ],
                })
              }
            >
              Add
            </button>
          )
        }
      >
        {did ? (
          <>
            <div className="note" style={{ marginBottom: 10 }}>
              Type VII timings state the clock in kHz across 24 bits, so they reach far beyond the 655.35 MHz a
              detailed timing descriptor can hold. This is the only way to put 2160p120 in an EDID.
            </div>
            {did.type7Timings.map((t, i) => (
              <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                <TimingEditor
                  t={t.timing}
                  onChange={(timing) => {
                    const next = { ...did, type7Timings: did.type7Timings.map((x, j) => (j === i ? { ...x, timing } : x)) }
                    set({ extensions: edid.extensions.map((x) => (x === did ? next : x)) })
                  }}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <Check
                    label="Preferred"
                    checked={t.preferred}
                    onChange={(preferred) => {
                      const next = { ...did, type7Timings: did.type7Timings.map((x, j) => (j === i ? { ...x, preferred } : x)) }
                      set({ extensions: edid.extensions.map((x) => (x === did ? next : x)) })
                    }}
                  />
                  <button
                    className="minor"
                    onClick={() => {
                      const next = { ...did, type7Timings: did.type7Timings.filter((_, j) => j !== i) }
                      set({ extensions: edid.extensions.map((x) => (x === did ? next : x)) })
                    }}
                  >
                    Remove timing
                  </button>
                </div>
              </div>
            ))}
            <button
              className="minor"
              style={{ marginTop: 10 }}
              onClick={() => {
                const seed = primary ?? did.type7Timings[0]?.timing
                if (!seed) return
                const next = { ...did, type7Timings: [...did.type7Timings, { timing: seed, preferred: false, aspect: '16:9', fractional: false }] }
                set({ extensions: edid.extensions.map((x) => (x === did ? next : x)) })
              }}
            >
              Add timing
            </button>
          </>
        ) : (
          <div className="note">
            No DisplayID block. You need one only when the pixel clock exceeds 655.35 MHz — a needless extension is
            another block for a fussy sink to choke on.
          </div>
        )}
      </Panel>
    </>
  )
}

export { edit }
