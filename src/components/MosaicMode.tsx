import type { MosaicCheck, MosaicRequest, MosaicResult } from '../lib/mosaic.ts'
import { MOSAIC_GRIDS, mosaicTopologyId } from '../lib/mosaic.ts'
import { timingLabel } from '../lib/timing/types.ts'
import { zipStored } from '../lib/zip.ts'
import { saveBytes, slug } from './HexView.tsx'
import { Num, Panel, Pick, Stat, Text } from './ui.tsx'

const PRESETS: { label: string; w: number; h: number; r: number }[] = [
  { label: '6144x2160 @60 — widest for any macOS', w: 6144, h: 2160, r: 60 },
  { label: '5120x1440 @60', w: 5120, h: 1440, r: 60 },
  { label: '7680x2160 @60 — two UHD', w: 7680, h: 2160, r: 60 },
  { label: '7680x2160 @50 — two UHD', w: 7680, h: 2160, r: 50 },
  { label: '7680x4320 @30 — 2 x 2 UHD', w: 7680, h: 4320, r: 30 },
  { label: '12288x1536 @50 — LED strip', w: 12288, h: 1536, r: 50 },
]

const hexId = (id: number[]) =>
  String.fromCharCode(...id.slice(0, 3)) + ' ' + id.slice(3).map((b) => b.toString(16).padStart(2, '0')).join(' ')

export function MosaicMode({
  req,
  onChange,
  result,
  errors,
  selected,
  onSelect,
}: {
  req: MosaicRequest
  onChange: (r: MosaicRequest) => void
  result: MosaicResult | null
  errors: string[]
  selected: number
  onSelect: (i: number) => void
}) {
  const set = (patch: Partial<MosaicRequest>) => onChange({ ...req, ...patch })
  const grid = MOSAIC_GRIDS.find((g) => g.cols === req.cols && g.rows === req.rows)
  const preset = PRESETS.find((p) => p.w === req.width && p.h === req.height && p.r === req.refreshHz)

  const saveAll = () => {
    if (!result) return
    const zip = zipStored(result.tiles.map((t) => ({ name: t.file, data: t.bytes })))
    saveBytes(zip, `${slug(req.name)}_${req.width}x${req.height}_${req.refreshHz}Hz.zip`, 'application/zip')
  }

  return (
    <>
      <Panel title="The canvas the Mac should see as one display">
        <div className="grid c2">
          <Text
            label="EDID name"
            hint="13 characters, the same on every plug"
            value={req.name}
            maxLength={13}
            onChange={(name) => set({ name })}
          />
          <Pick
            label="Preset"
            value={preset?.label ?? 'custom'}
            options={[...PRESETS.map((p) => ({ value: p.label, label: p.label })), { value: 'custom', label: 'Custom…' }]}
            onChange={(v) => {
              const p = PRESETS.find((x) => x.label === v)
              if (!p) return
              set({ width: p.w, height: p.h, refreshHz: p.r, rows: p.h === 4320 ? 2 : req.rows })
            }}
          />
        </div>
        <div className="grid c4" style={{ marginTop: 10 }}>
          <Num label="Width" hint="whole canvas" value={req.width} min={8} max={16384} step={8} onChange={(width) => set({ width })} />
          <Num label="Height" hint="whole canvas" value={req.height} min={8} max={8192} onChange={(height) => set({ height })} />
          <Num label="Refresh" hint="Hz" value={req.refreshHz} min={1} max={240} step={0.01} onChange={(refreshHz) => set({ refreshHz })} />
          <Pick
            label="Plugs"
            value={grid ? `${req.cols}x${req.rows}` : '2x1'}
            options={MOSAIC_GRIDS.map((g) => ({ value: `${g.cols}x${g.rows}`, label: g.label }))}
            onChange={(v) => {
              const [cols, rows] = v.split('x').map(Number)
              set({ cols, rows })
            }}
          />
        </div>
        <div className="grid c4" style={{ marginTop: 10 }}>
          <Pick
            label="Bit depth"
            value={req.bitDepth}
            options={[
              { value: 10, label: '10-bit' },
              { value: 8, label: '8-bit' },
            ]}
            onChange={(bitDepth) => set({ bitDepth: bitDepth as 8 | 10 })}
          />
          <Num
            label="Mosaic number"
            hint="0-255"
            value={req.group}
            min={0}
            max={255}
            onChange={(group) => set({ group })}
          />
          <Text label="Vendor id" hint="3 letters" value={req.vendor} maxLength={3} onChange={(vendor) => set({ vendor: vendor.toUpperCase() })} />
          <Num label="Product code" value={req.product} min={0} max={65535} onChange={(product) => set({ product })} />
        </div>
        <div className="note">
          A Mac groups plugs into one display by the topology id — vendor, product and mosaic number. Give a second
          mosaic on the same Mac a different number. The default id is Stoatworks Labs’ own (SWK, “OT”).
        </div>
      </Panel>

      {errors.length ? (
        <Panel title="Can’t build this">
          {errors.map((e, i) => (
            <div key={i} className="banner bad">
              {e}
            </div>
          ))}
        </Panel>
      ) : null}

      {result ? (
        <Panel
          title={`${result.tiles.length} EDIDs, one per plug`}
          right={
            <button className="go" onClick={saveAll}>
              Download all (.zip)
            </button>
          }
        >
          <div className="stats" style={{ marginBottom: 10 }}>
            <Stat k="Each plug" v={`${result.tileWidth} × ${result.tileHeight}`} />
            <Stat k="Tile mode" v={timingLabel(result.tileTiming)} small />
            <Stat k="Pixel clock / plug" v={`${(result.tileTiming.pixelClockHz / 1e6).toFixed(2)} MHz`} small />
            <Stat
              k="Fallback in base block"
              v={`${result.baseTiming.hActive} × ${result.baseTiming.vActive}`}
              small
            />
          </div>
          <table className="tiles">
            <thead>
              <tr>
                <th>Plug</th>
                <th>Position</th>
                <th>File</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.tiles.map((t, i) => (
                <tr key={t.file} aria-selected={i === selected} onClick={() => onSelect(i)}>
                  <td>{t.label}</td>
                  <td>
                    column {t.col + 1}, row {t.row + 1}
                  </td>
                  <td className="mono">{t.file}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="minor"
                      onClick={(e) => {
                        e.stopPropagation()
                        saveBytes(t.bytes, t.file)
                      }}
                    >
                      .bin
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">
            Load each file on the input at its position —{' '}
            {req.rows === 1 ? 'left.bin on the connector fed by the Mac’s left-hand output' : 'r1c1 is the top left'}. If
            the picture comes out in the wrong order, swap the cables. Topology id{' '}
            <span className="mono">{hexId(mosaicTopologyId(req))}</span>.
          </div>
        </Panel>
      ) : null}

      <Panel title="How this works">
        <div className="note">
          Each plug gets its own EDID. All of them carry a DisplayID Tiled Display Topology block with the same id and
          grid, and each one’s own position. A Mac that reads matching blocks on several connectors joins them into a
          single display. It then drives the outputs as one, so they stay frame synced with no tearing at the seams.
        </div>
        <div className="note">
          The layout copies, byte for byte, reference files that have bonded on macOS 26 and 27. Their base and CTA
          blocks come from a real display’s EDID, because EDIDs built from scratch never bonded on a Mac. Nothing the editor builds elsewhere
          has been tried on hardware.
        </div>
      </Panel>
    </>
  )
}

export function MosaicChecks({ checks }: { checks: MosaicCheck[] }) {
  return (
    <Panel title="What a Mac will make of it">
      {checks.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8 }}>
          <span className={`pill ${c.level}`}>{c.level === 'ok' ? 'yes' : c.level === 'warn' ? 'caveat' : 'no'}</span>
          <div>
            <div>{c.what}</div>
            <div className="note">{c.detail}</div>
          </div>
        </div>
      ))}
      <div className="note">
        From bench testing of the reference files on macOS 26 and 27, BetterDisplay users’ field reports and PixelHue’s
        notes. The widths are the widest anyone has reported, not limits anyone has found, and which chips manage them is
        inferred from who reported it. The DisplayID block layout is checked against the Linux kernel’s parser.
      </div>
    </Panel>
  )
}
