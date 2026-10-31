/**
 * An EDID's bytes as text, in the shapes people paste them in.
 *
 * Here rather than in `HexView.tsx` because the MCP server writes the same files
 * the page saves, and two copies of an offset dump would drift a column apart.
 */

export type ByteFormat = 'xxd' | 'hex' | 'c'

export const BYTE_FORMATS: { value: ByteFormat; label: string }[] = [
  { value: 'xxd', label: 'Offset dump' },
  { value: 'hex', label: 'Flat hex' },
  { value: 'c', label: 'C array' },
]

/** A file-name and C-identifier-safe form of an EDID's name. */
export const slug = (s: string) =>
  (s || 'edid').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'edid'

/** `name` is the C array's identifier, and is slugged here. */
export function renderBytes(bytes: Uint8Array, fmt: ByteFormat, name: string): string {
  const hex = (b: number) => b.toString(16).padStart(2, '0')
  switch (fmt) {
    case 'hex':
      return [...bytes].map(hex).join('')
    case 'c': {
      const lines: string[] = [`static const unsigned char ${slug(name)}[${bytes.length}] = {`]
      for (let i = 0; i < bytes.length; i += 12) {
        lines.push('  ' + [...bytes.slice(i, i + 12)].map((b) => `0x${hex(b)}`).join(', ') + ',')
      }
      lines.push('};')
      return lines.join('\n')
    }
    default: {
      const lines: string[] = []
      for (let i = 0; i < bytes.length; i += 16) {
        const chunk = [...bytes.slice(i, i + 16)]
        lines.push(`${i.toString(16).padStart(8, '0')}: ${chunk.map(hex).join(' ')}`)
      }
      return lines.join('\n')
    }
  }
}

/** The extension a saved text dump gets: a C array is a header. */
export const textExtension = (fmt: ByteFormat) => (fmt === 'c' ? 'h' : 'txt')
