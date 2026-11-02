/**
 * The MCP server, from the protocol up.
 *
 * Three layers. The protocol on its own, because a client that cannot negotiate never gets
 * as far as a tool. The tools, driven in process the way a model drives them, and checked
 * against the library asked directly: the one thing this server must not do is build,
 * cost or judge an EDID differently from the page. And the real server process over its
 * own stdio, because Node's type stripping and stdout carrying nothing but protocol are
 * exactly what no in-process test can see.
 */

import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fx from '../lib/__tests__/fixtures/reference-tiles.json'
import { DEFAULT_REQUEST, buildEdid, solveTiming } from '../lib/build.ts'
import { evaluateAll } from '../lib/capability/evaluate.ts'
import { encodeEdid } from '../lib/edid/encode.ts'
import { renderBytes } from '../lib/hexdump.ts'
import { DEFAULT_SIGNAL, dpRequirement, hdmiRequirement } from '../lib/link.ts'
import { DEFAULT_MOSAIC, buildMosaic, mosaicArchive, tileSignal } from '../lib/mosaic.ts'
import { PROTOCOL_VERSIONS, type Tool, createMcpServer } from './protocol.ts'
import { SERVER_INFO, edidTools } from './tools.ts'

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const scratch = () => mkdtempSync(join(tmpdir(), 'edid-mcp-'))
const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** An in-process client. `call` answers with the tool's text, parsed when it is JSON. */
function client(tools: Tool[] = edidTools()) {
  const sent: Json[] = []
  const server = createMcpServer(SERVER_INFO, tools, (m) => sent.push(m))
  let seq = 0
  const request = async (method: string, params?: object): Promise<Json> => {
    const id = ++seq
    await server.handle(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    return sent.find((m) => m.id === id)
  }
  const call = async (name: string, args: object = {}): Promise<{ isError: boolean; text: string; json: Json }> => {
    const r = await request('tools/call', { name, arguments: args })
    const text: string = r.result.content[0].text
    let json: Json = null
    try {
      json = JSON.parse(text)
    } catch {
      // A refusal is prose.
    }
    return { isError: !!r.result.isError, text, json }
  }
  return { sent, server, request, call }
}

/** The page's simple-mode request for a mode, as build_edid forms it. */
const pageRequest = (o: Partial<typeof DEFAULT_REQUEST>) => ({ ...DEFAULT_REQUEST, signal: { ...DEFAULT_SIGNAL }, ...o })

describe('protocol', () => {
  it('echoes a protocol version it knows, and offers its newest for one it does not', async () => {
    const c = client()
    const known = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })
    expect(known.result.protocolVersion).toBe('2025-06-18')
    expect(known.result.serverInfo.name).toBe('edid-editor')
    expect(known.result.instructions).toMatch(/none of it has been tried on real hardware/)
    const future = await c.request('initialize', { protocolVersion: '2099-01-01' })
    expect(future.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0])
  })

  it('lists every tool with a strict object schema', async () => {
    const { result } = await client().request('tools/list')
    expect(result.tools.map((t: Json) => t.name)).toEqual([
      'open_edid', 'build_edid', 'build_mosaic', 'status', 'describe_edid', 'edit_edid',
      'solve_timing', 'link_requirements', 'check_devices', 'list_devices', 'export',
    ])
    for (const t of result.tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.inputSchema.additionalProperties).toBe(false)
      expect(t.description.length).toBeGreaterThan(40)
    }
  })

  it('refuses an argument it does not know and a value off the page’s scale', async () => {
    const c = client()
    // A typo the model would otherwise be told succeeded.
    expect((await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, refresh: 50 })).text).toMatch(/refresh is not a known argument/)
    expect((await c.call('build_edid', { width: 20000, height: 1080, refreshHz: 60 })).text).toMatch(/width must be at most 16384/)
    expect((await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, signal: { bpc: 9 } })).text).toMatch(/bpc must be one of/)
    expect((await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, standard: 'auto' })).text).toMatch(/standard must be one of "manual"/)
    expect((await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, name: 'Fourteen chars' })).text).toMatch(/holds 13/)
    expect((await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, productCode: 70000 })).text).toMatch(/productCode must be at most 65535/)
    expect((await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, serialNumber: -1 })).text).toMatch(/serialNumber must be at least 0/)
  })

  it('says what to do first when nothing is open', async () => {
    const c = client()
    for (const t of ['describe_edid', 'link_requirements', 'check_devices']) {
      expect((await c.call(t)).text).toMatch(/Nothing is open/)
    }
    expect((await c.call('edit_edid', { name: 'X' })).text).toMatch(/Nothing is open/)
    expect((await c.call('export', { path: join(scratch(), 'x.bin') })).text).toMatch(/Nothing is open/)
    expect((await c.call('status')).json.open).toBeNull()
  })
})

describe('the tools ask the library what the page asks', () => {
  it('builds the EDID simple mode builds, byte for byte', async () => {
    const c = client()
    const r = await c.call('build_edid', { width: 3840, height: 2160, refreshHz: 60, name: 'PDS4K-2160p60', signal: { bpc: 10 } })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({ resolvedStandard: 'cta', vic: 97, name: 'PDS4K-2160p60' })

    const path = join(scratch(), 'pds.bin')
    expect((await c.call('export', { path })).json).toMatchObject({ bytes: 256, blocks: 2 })
    const page = encodeEdid(buildEdid(pageRequest({ name: 'PDS4K-2160p60', signal: { ...DEFAULT_SIGNAL, bpc: 10 } })).edid)
    expect(Buffer.compare(readFileSync(path), page)).toBe(0)
  })

  it('gives a unit its own product code and serial number, as simple mode does', async () => {
    const c = client()
    const r = await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, name: 'Stage L', productCode: 2, serialNumber: 7 })
    expect(r.json).toMatchObject({ productCode: 2, serialNumber: 7 })
    const path = join(scratch(), 'stage-l.bin')
    await c.call('export', { path })
    const page = encodeEdid(buildEdid(pageRequest({ name: 'Stage L', hActive: 1920, vActive: 1080, productCode: 2, serialNumber: 7 })).edid)
    expect(Buffer.compare(readFileSync(path), page)).toBe(0)
  })

  it('writes the text dumps the page saves', async () => {
    const c = client()
    await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, name: 'Stage L' })
    const bytes = encodeEdid(buildEdid(pageRequest({ name: 'Stage L', hActive: 1920, vActive: 1080 })).edid)
    const dir = scratch()
    for (const format of ['xxd', 'hex', 'c'] as const) {
      const path = join(dir, `stage.${format}`)
      await c.call('export', { path, format })
      expect(readFileSync(path, 'utf8')).toBe(renderBytes(bytes, format, 'Stage L'))
    }
    expect(readFileSync(join(dir, 'stage.c'), 'utf8')).toMatch(/^static const unsigned char stage_l\[256\]/)
  })

  it('times a mode as build_edid would, with nothing open', async () => {
    const r = (await client().call('solve_timing', { width: 1920, height: 1080, refreshHz: 60 })).json
    expect(r).toMatchObject({ standard: 'cta', vic: 16, timing: { raster: [2200, 1125], pixelClockMHz: 148.5, asDtd: 'fits' } })
    // 8192 wide has an ordinary clock and still cannot be a DTD (AGENTS.md).
    const wide = (await client().call('solve_timing', { width: 8192, height: 1080, refreshHz: 60 })).json
    expect(wide.timing.asDtd).not.toBe('fits')
    const i = (await client().call('solve_timing', { width: 1920, height: 1080, refreshHz: 60, interlaced: true })).json
    // The field rate, not the frame rate, and heights and rasters by the frame, as the
    // server's instructions promise; only the porches are per field.
    expect(i).toMatchObject({
      vic: 5,
      timing: {
        label: '1920x1080i60', interlaced: true, active: [1920, 1080], raster: [2200, 1125],
        vertical: { perField: true, fieldActive: 540 }, fieldRateHz: 60, frameRateHz: 30,
      },
    })
  })

  it('costs the link as the link panel does', async () => {
    const c = client()
    const signal = { ...DEFAULT_SIGNAL, format: 'ycbcr422' as const, bpc: 10 as const }
    const r = (await c.call('link_requirements', { mode: { width: 3840, height: 2160, refreshHz: 60 }, signal: { format: 'ycbcr422', bpc: 10 } })).json
    const t = solveTiming(pageRequest({})).timing
    expect(r.hdmi.minimum).toBe(hdmiRequirement(t, signal).version!.name)
    expect(r.displayPort4Lane.minimum).toBe(`${dpRequirement(t, signal, 4).rate!.name}, since ${dpRequirement(t, signal, 4).rate!.since}`)
    // 4:2:2 is the one format the two links charge differently.
    expect(r.bitsPerPixel).toEqual({ hdmi: 24, displayport: 20 })
    // A signal for one call is not kept.
    expect((await c.call('status')).json.signal).toEqual(DEFAULT_SIGNAL)
  })

  it('judges every device as the support table does', async () => {
    const c = client()
    await c.call('build_edid', { width: 3840, height: 2160, refreshHz: 60, signal: { bpc: 10 } })
    const r = (await c.call('check_devices')).json
    const t = solveTiming(pageRequest({})).timing
    const lib = evaluateAll(t, { ...DEFAULT_SIGNAL, bpc: 10 })
    expect(r.devices.map((d: Json) => [d.id, d.status])).toEqual(lib.map((v) => [v.device.id, v.status]))
    expect(Object.values(r.counts).reduce((a: number, b) => a + (b as number), 0)).toBe(lib.length)
    expect(r.caveat).toMatch(/None of it has been tried against real hardware/)

    const barco = (await c.call('check_devices', { vendor: 'barco', status: ['unsupported'] })).json
    expect(barco.devices.length).toBeGreaterThan(0)
    expect(barco.devices.every((d: Json) => d.device.startsWith('Barco') && d.status === 'unsupported' && d.why)).toBe(true)

    const one = (await c.call('check_devices', { device: lib[0].device.id })).json
    expect(one.modes.length).toBe(lib[0].modes.length)
    expect(one.citations).toEqual(lib[0].device.citations)
    expect((await c.call('check_devices', { vendor: 'Sony' })).text).toMatch(/No vendor "Sony"/)
    expect((await c.call('list_devices', { id: 'nope' })).text).toMatch(/No device "nope"/)
  })
})

describe('reading and editing', () => {
  it('opens a real EDID from a file or pasted hex, and saves it back unedited byte for byte', async () => {
    const tile = fx.cases[0].tiles[0]
    const dir = scratch()
    const bin = join(dir, 'left.bin')
    writeFileSync(bin, bytesOf(tile.hex))

    const c = client()
    const opened = (await c.call('open_edid', { path: bin })).json
    expect(opened.issues.filter((i: Json) => i.severity === 'error')).toEqual([])
    expect(opened.extensions.map((x: Json) => x.kind)).toEqual(['cta', 'displayid'])
    await c.call('export', { path: join(dir, 'again.bin') })
    expect(readFileSync(join(dir, 'again.bin')).toString('hex')).toBe(tile.hex)

    // The same bytes as an xxd dump, pasted.
    const pasted = client()
    await pasted.call('open_edid', { hex: renderBytes(bytesOf(tile.hex), 'xxd', 'x') })
    await pasted.call('export', { path: join(dir, 'pasted.bin') })
    expect(readFileSync(join(dir, 'pasted.bin')).toString('hex')).toBe(tile.hex)

    expect((await c.call('open_edid', { path: bin, hex: '00' })).text).toMatch(/exactly one/)
    expect((await c.call('open_edid', { path: join(dir, 'missing.bin') })).text).toMatch(/No such file/)
    // Garbage still opens, with the problem said.
    expect((await c.call('open_edid', { hex: 'not an edid' })).json.issues[0].message).toMatch(/base block is 128/)
  })

  it('edits fields all or none, and keeps each field’s type', async () => {
    const c = client()
    await c.call('build_edid', { width: 1920, height: 1080, refreshHz: 60, name: 'Before' })
    const model = (await c.call('describe_edid', { full: true })).json.model
    expect(model.descriptors[1].kind).toBe('range')

    const ok = (await c.call('edit_edid', { changes: [{ path: 'descriptors[1].maxVerticalHz', value: 75 }], name: 'After' })).json
    expect(ok.changed).toEqual(['descriptors[1].maxVerticalHz', 'name'])
    expect(ok.descriptors[1].maxVerticalHz).toBe(75)
    expect(ok.name).toBe('After')

    expect((await c.call('edit_edid', { changes: [{ path: 'descriptors[1].maxVerticalHz', value: '75' }] })).text).toMatch(/is a number, not a string/)
    expect((await c.call('edit_edid', { changes: [{ path: 'descriptors[1].maxVerticlHz', value: 1 }] })).text).toMatch(/no such field/)
    expect((await c.call('edit_edid', { changes: [{ path: 'extensions[0].source', value: null }] })).text).toMatch(/source is not editable/)
    expect((await c.call('edit_edid', { changes: [{ path: '__proto__.x', value: 1 }] })).text).toMatch(/not editable/)

    // A value the encoder cannot store is refused, and nothing changes — not even the
    // change before it in the same call.
    const bad = await c.call('edit_edid', {
      changes: [
        { path: 'descriptors[1].minVerticalHz', value: 50 },
        { path: 'week', value: 300 },
      ],
    })
    expect(bad.text).toMatch(/would not encode/)
    const after = (await c.call('describe_edid')).json
    expect(after.descriptors[1].minVerticalHz).not.toBe(50)
    expect(after.manufactured.week).toBe(1)

    // A value the encoder stores modulo its width is applied, and the read-back says so:
    // the page's field stops at 65535, the model's does not.
    const wrapped = (await c.call('edit_edid', { changes: [{ path: 'productCode', value: 70000 }] })).json
    expect(wrapped.readBack).toEqual(['productCode: set to 70000, the bytes read back 4464'])
    expect((await c.call('edit_edid', { changes: [{ path: 'productCode', value: 7 }] })).json.readBack).toBeUndefined()

    // Append a VIC one past the end, then take it away again.
    const vics = model.extensions[0].videoDescriptors.length
    const added = (await c.call('edit_edid', { changes: [{ path: `extensions[0].videoDescriptors[${vics}]`, value: { vic: 4, native: false } }] })).json
    expect(added.extensions[0].vics.at(-1)).toMatch(/^VIC 4\b/)
    const removed = (await c.call('edit_edid', { changes: [{ path: `extensions[0].videoDescriptors[${vics}]`, remove: true }] })).json
    expect(removed.extensions[0].vics).toHaveLength(vics)
  })
})

describe('mosaics', () => {
  it('writes the tiles exactly as the builder made them, and refuses to edit them', async () => {
    const c = client()
    const r = (await c.call('build_mosaic', {})).json
    expect(r.tiles.map((t: Json) => t.file)).toEqual(['left.bin', 'right.bin'])
    const lib = buildMosaic(DEFAULT_MOSAIC)

    const dir = scratch()
    const zip = (await c.call('export', { path: join(dir, 'all.zip') })).json
    expect(Buffer.compare(readFileSync(join(dir, 'all.zip')), mosaicArchive(DEFAULT_MOSAIC, lib).bytes)).toBe(0)
    expect(zip.pageWouldName).toBe(mosaicArchive(DEFAULT_MOSAIC, lib).name)
    await c.call('export', { path: join(dir, 'right.bin'), tile: 'right' })
    expect(Buffer.compare(readFileSync(join(dir, 'right.bin')), lib.tiles[1].bytes)).toBe(0)

    expect((await c.call('edit_edid', { name: 'X' })).text).toMatch(/never edited or re-encoded/)
    expect((await c.call('export', { path: join(dir, 'all.bin') })).text).toMatch(/\.zip/)
    expect((await c.call('describe_edid', { tile: 'r9c9' })).text).toMatch(/No tile "r9c9"/)
    expect((await c.call('describe_edid', { tile: 'left' })).json.extensions[1].tiled.grid).toEqual([2, 1])

    // The tile carries the mosaic's bit depth, as the page's panels do.
    const link = (await c.call('link_requirements')).json
    expect(link.of).toBe('each mosaic tile')
    expect(link.signal).toEqual(tileSignal(DEFAULT_MOSAIC, DEFAULT_SIGNAL))
  })

  it('reproduces the reference builder’s files', async () => {
    const k = fx.cases[0]
    const c = client()
    await c.call('build_mosaic', { width: k.input.width, height: k.input.height, cols: k.input.cols, rows: k.input.rows, refreshHz: k.input.hz, bitDepth: k.input.bitDepth })
    const dir = scratch()
    await c.call('export', { path: join(dir, 'left.bin'), tile: 'left' })
    // The reference names each tile itself (MS1Left); the editor names them all alike, so
    // compare everything but the base block's name descriptor and its checksum.
    const ours = readFileSync(join(dir, 'left.bin'))
    const theirs = bytesOf(k.tiles[0].hex)
    expect(ours.length).toBe(theirs.length)
    const differs = [...ours].flatMap((b, i) => (b === theirs[i] ? [] : [i]))
    expect(differs.every((i) => (i >= 90 && i < 108) || i === 127)).toBe(true)
  })

  it('refuses a mosaic the builder would refuse, with its reasons', async () => {
    const r = await client().call('build_mosaic', { width: 6145 })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/multiple of 8/)
  })
})

describe('writing', () => {
  it('never writes over the file it opened, nor an existing file unless told', async () => {
    const dir = scratch()
    const bin = join(dir, 'in.bin')
    writeFileSync(bin, bytesOf(fx.cases[0].tiles[0].hex))
    const c = client()
    await c.call('open_edid', { path: bin })
    expect((await c.call('export', { path: bin, overwrite: true })).text).toMatch(/file that was opened/)
    const out = join(dir, 'out.bin')
    expect((await c.call('export', { path: out })).isError).toBe(false)
    expect((await c.call('export', { path: out })).text).toMatch(/already exists/)
    expect((await c.call('export', { path: out, overwrite: true })).isError).toBe(false)
    expect((await c.call('export', { path: join(dir, 'no', 'such', 'x.bin') })).text).toMatch(/No such directory/)
    expect(existsSync(join(dir, 'no'))).toBe(false)
  })
})

const typeStripping = !!(process.features as { typescript?: unknown }).typescript

describe.runIf(typeStripping)('the server process', () => {
  it('runs from source under Node and writes nothing but protocol to stdout', async () => {
    const dir = scratch()
    const child = spawn(process.execPath, [repo('src/mcp/server.ts')], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'build_edid', arguments: { width: 1920, height: 1080, refreshHz: 60 } } },
      // Relative to the server's working directory, as a client launched from a project would be.
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'export', arguments: { path: 'out.bin' } } },
    ]
    child.stdin.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const code = await new Promise((r) => child.on('close', r))
    expect(code).toBe(0)

    // Every line parses: one stray console.log from a library would fail here.
    const replies = stdout.trim().split('\n').map((l) => JSON.parse(l))
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4])
    expect(replies[1].result.tools).toHaveLength(11)
    expect(replies[3].result.isError).toBeUndefined()
    const page = encodeEdid(buildEdid(pageRequest({ hActive: 1920, vActive: 1080 })).edid)
    expect(Buffer.compare(readFileSync(join(dir, 'out.bin')), page)).toBe(0)
  }, 30_000)
})
