import { useMemo, useRef, useState } from 'react'
import type { Edid } from '../lib/edid/types.ts'
import { encodeEdid } from '../lib/edid/encode.ts'
import { fileContents } from '../lib/edid/decode.ts'
import type { ByteFormat } from '../lib/hexdump.ts'
import { BYTE_FORMATS, renderBytes, slug, textExtension } from '../lib/hexdump.ts'
import { Panel } from './ui.tsx'

export function saveBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function HexView({
  edid,
  raw,
  name,
  onLoad,
  title,
}: {
  edid?: Edid
  /** Exact bytes to show instead of encoding `edid` — for files that must
   *  not pass through the encoder, like a mosaic tile. */
  raw?: Uint8Array
  name: string
  onLoad?: (data: Uint8Array | string) => void
  title?: string
}) {
  const [fmt, setFmt] = useState<ByteFormat>('xxd')
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const built = useMemo(() => {
    if (raw) return { bytes: raw, error: null as string | null }
    if (!edid) return { bytes: null, error: 'nothing to show' }
    try {
      return { bytes: encodeEdid(edid), error: null as string | null }
    } catch (e) {
      return { bytes: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [edid, raw])

  if (built.error || !built.bytes) {
    return (
      <Panel title="EDID bytes">
        <div className="banner bad">
          This EDID cannot be encoded: {built.error}
        </div>
      </Panel>
    )
  }

  const bytes = built.bytes
  const blocks = Math.ceil(bytes.length / 128)
  const text = renderBytes(bytes, fmt, name)

  // Binary is the only format any EDID writer actually eats, so it is a real
  // .bin blob rather than a text file with a .bin extension.
  const download = () => saveBytes(bytes, `${slug(name)}.bin`)

  const downloadText = () => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug(name)}.${textExtension(fmt)}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Panel title={title ?? `EDID bytes — ${bytes.length} bytes, ${blocks} block${blocks > 1 ? 's' : ''}`}>
      <div className="row" style={{ marginBottom: 10 }}>
        {BYTE_FORMATS.map((f) => (
          <button key={f.value} className="minor" aria-pressed={fmt === f.value} onClick={() => setFmt(f.value)}>
            {f.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="minor" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="minor" onClick={downloadText}>
          Save text
        </button>
        <button className="go" onClick={download}>
          Download .bin
        </button>
      </div>

      {onLoad ? (
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="minor" onClick={() => fileRef.current?.click()}>
          Open an EDID…
        </button>
        <span className="note" style={{ margin: 0 }}>
          .bin, or a hex dump pasted from anywhere — xrandr, edid-decode, xxd, a C header.
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".bin,.dat,.edid,.txt,.h,.hex"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            onLoad?.(fileContents(new Uint8Array(await f.arrayBuffer())))
            e.target.value = ''
          }}
        />
      </div>
      ) : null}

      <pre className="hex">{text}</pre>
    </Panel>
  )
}
