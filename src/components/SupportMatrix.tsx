import { useMemo, useState } from 'react'
import type { SignalOptions } from '../lib/link.ts'
import type { Timing } from '../lib/timing/types.ts'
import { evaluateAll, unsupportedReason } from '../lib/capability/evaluate.ts'
import type { DeviceVerdict, Status } from '../lib/capability/evaluate.ts'
import { Panel } from './ui.tsx'

const PILL: Record<Status, { cls: string; label: string }> = {
  supported: { cls: 'ok', label: 'Yes' },
  conditional: { cls: 'warn', label: 'Conditional' },
  unsupported: { cls: 'bad', label: 'No' },
  unknown: { cls: 'unknown', label: 'Unknown' },
}

const CONF_LABEL: Record<string, string> = {
  documented: 'documented',
  inferred: 'inferred',
  unverified: 'UNVERIFIED',
}

function Row({ v }: { v: DeviceVerdict }) {
  const p = PILL[v.status]
  return (
    <tr>
      <td>
        <div className="model">{v.device.model}</div>
        <div className="vendor">
          {v.device.vendor} · {v.device.family}
          {v.device.role === 'source' ? ' · source' : ''}
        </div>
      </td>
      <td>
        <span className={`pill ${p.cls}`}>{p.label}</span>
      </td>
      <td>
        {v.requiredMode ? (
          <>
            <div>{v.requiredMode.label}</div>
            {v.requiredConnector ? <div className="vendor">via {v.requiredConnector.label}</div> : null}
          </>
        ) : v.status === 'unsupported' ? (
          <span className="vendor">{unsupportedReason(v)}</span>
        ) : (
          <span className="vendor">—</span>
        )}
      </td>
      <td>
        {v.warnings.map((w, i) => (
          <div key={i} className="note warn" style={{ marginTop: i ? 4 : 0 }}>
            {w}
          </div>
        ))}
        {v.device.notes.length ? (
          <details className="cite">
            <summary>
              Notes &amp; sources <span className="pill conf">{CONF_LABEL[v.device.confidence]}</span>
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--dim)', fontSize: 11.5 }}>
              {v.device.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {v.device.citations.map((c, i) => (
              <blockquote key={i}>
                {c.claim}
                <cite>
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--dim)' }}>
                      {c.source}
                    </a>
                  ) : (
                    c.source
                  )}{' '}
                  · read {c.read}
                </cite>
              </blockquote>
            ))}
            {v.device.citations.length === 0 ? (
              <blockquote>No source recorded. Treat every number in this row as a guess.</blockquote>
            ) : null}
          </details>
        ) : null}
      </td>
    </tr>
  )
}

export function SupportMatrix({ timing, signal }: { timing: Timing; signal: SignalOptions }) {
  const [vendor, setVendor] = useState<string>('all')
  const verdicts = useMemo(() => evaluateAll(timing, signal), [timing, signal])
  const vendors = useMemo(() => ['all', ...new Set(verdicts.map((v) => v.device.vendor))], [verdicts])
  const shown = vendor === 'all' ? verdicts : verdicts.filter((v) => v.device.vendor === vendor)

  const counts = verdicts.reduce<Record<string, number>>((a, v) => {
    a[v.status] = (a[v.status] ?? 0) + 1
    return a
  }, {})

  return (
    <Panel
      title="Hardware support"
      right={
        <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 400 }}>
          {counts.supported ?? 0} yes · {counts.conditional ?? 0} conditional · {counts.unsupported ?? 0} no
        </span>
      }
    >
      <div className="filters">
        {vendors.map((x) => (
          <button key={x} aria-pressed={vendor === x} onClick={() => setVendor(x)}>
            {x === 'all' ? 'All vendors' : x}
          </button>
        ))}
      </div>

      <div className="banner info">
        Every row is paperwork — vendor manuals and spec sheets, cited per claim. Nothing here has been tried against
        the hardware. &ldquo;Conditional&rdquo; means it fits only in a mode you have to go and configure, and the
        column says which.
      </div>

      <div className="scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: '26%' }}>Device</th>
              <th style={{ width: '11%' }}>Takes it</th>
              <th style={{ width: '24%' }}>Required mode</th>
              <th>What to watch</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <Row key={v.device.id} v={v} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
