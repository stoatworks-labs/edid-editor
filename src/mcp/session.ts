/**
 * What the page holds, for the MCP tools: one EDID or one mosaic, and the signal meant to
 * go through it.
 *
 * Everything decided about an EDID is decided in `lib/`. This file opens, builds and
 * writes by calling the functions the page calls, and turns their answers into something
 * a model can read: a timing as its label plus the numbers the link panel shows, a device
 * verdict as one row of the support table. If an answer here and the page's ever differ,
 * this file has grown logic of its own.
 *
 * A mosaic's tiles are the reference builder's bytes. They are written as built, never
 * edited and never passed through `encodeEdid` (AGENTS.md, "Mosaic bytes").
 */

import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DEFAULT_REQUEST, buildEdid, solveTiming, vicFor, type SimpleRequest } from '../lib/build.ts'
import { DEVICE_LIST } from '../lib/capability/devices.ts'
import { evaluateAll, unsupportedReason, type DeviceVerdict, type Status } from '../lib/capability/evaluate.ts'
import type { Device } from '../lib/capability/types.ts'
import { decodeEdid, fileContents, parseEdidFile, type DecodeIssue } from '../lib/edid/decode.ts'
import { dtdLimit, encodeEdid } from '../lib/edid/encode.ts'
import type { Descriptor, Edid, Extension } from '../lib/edid/types.ts'
import { renderBytes, type ByteFormat } from '../lib/hexdump.ts'
import { DEFAULT_SIGNAL, bitsPerPixel, dpRequirement, dviRequirement, hdmiRequirement, payloadBps, type SignalOptions } from '../lib/link.ts'
import { DEFAULT_MOSAIC, checkMosaic, mosaicArchive, tileSignal, tryMosaic, type MosaicRequest, type MosaicResult } from '../lib/mosaic.ts'
import { displayName, primaryTiming, setDisplayName } from '../lib/primary.ts'
import { ctaByVic } from '../lib/timing/cta.ts'
import { frameRate, hFreq, hTotal, timingLabel, vFreq, vTotal, type Timing, type TimingStandard } from '../lib/timing/types.ts'
import { ToolError } from './protocol.ts'

export type Open =
  | { kind: 'edid'; edid: Edid; from: string; issues: DecodeIssue[]; notes: string[] }
  | { kind: 'mosaic'; request: MosaicRequest; result: MosaicResult }

export interface Session {
  open: Open | null
  /** The signal the support table and the link costs are asked about. build_edid sets it. */
  signal: SignalOptions
  /** The file open_edid read, which export refuses to write over. */
  sourcePath: string | null
}

export const newSession = (): Session => ({ open: null, signal: { ...DEFAULT_SIGNAL }, sourcePath: null })

/** Every report repeats this, as the page's About panel and support table do. */
export const HARDWARE_CAVEAT =
  'The hardware table is vendor manuals and spec sheets, cited per claim. None of it has been tried against real ' +
  'hardware, and no EDID this tool builds has been fed to a device.'

// ------------------------------------------------------------------- describing

const mhz = (hz: number) => +(hz / 1e6).toFixed(4)

/** A timing as the link panel states it, plus what the timing table and the DTD limit say. */
export function timingReport(t: Timing) {
  return {
    label: timingLabel(t),
    active: [t.hActive, t.vActive],
    interlaced: t.interlaced,
    pixelClockMHz: mhz(t.pixelClockHz),
    raster: [hTotal(t), vTotal(t)],
    horizontal: { front: t.hFront, sync: t.hSync, back: t.hBack, syncPositive: t.hSyncPositive },
    vertical: { front: t.vFront, sync: t.vSync, back: t.vBack, syncPositive: t.vSyncPositive },
    lineRateKHz: +(hFreq(t) / 1000).toFixed(3),
    [t.interlaced ? 'fieldRateHz' : 'refreshHz']: +vFreq(t).toFixed(3),
    ...(t.interlaced ? { frameRateHz: +frameRate(t).toFixed(3) } : {}),
    vic: vicFor(t) ?? null,
    asDtd: dtdLimit(t) ?? 'fits',
  }
}

function descriptorReport(d: Descriptor) {
  return d.kind === 'dtd' ? { ...d, timing: timingLabel(d.timing) } : d
}

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

function extensionReport(x: Extension) {
  if (x.kind === 'cta') {
    return {
      kind: 'cta',
      revision: x.revision,
      vics: x.videoDescriptors.map((v) => `${ctaByVic(v.vic)?.name ?? `VIC ${v.vic}`}${v.native ? ' (native)' : ''}`),
      detailedTimings: x.detailedTimings.map((d) => timingLabel(d.timing)),
      audio: x.audioDescriptors.length,
      ycbcr444: x.ycbcr444,
      ycbcr422: x.ycbcr422,
      ycbcr420Only: x.ycbcr420OnlyVics,
      hdmiVsdb: !!x.hdmiVsdb,
      hdmiForumVsdb: !!x.hdmiForumVsdb,
      hdr: !!x.hdrStaticMetadata,
      colorimetry: !!x.colorimetry,
      unknownBlocks: x.unknownBlocks.length,
    }
  }
  if (x.kind === 'displayid') {
    return {
      kind: 'displayid',
      version: hex(x.version),
      timings: [...(x.type1Timings ?? []), ...x.type7Timings].map((t) => `${timingLabel(t.timing)}${t.preferred ? ' (preferred)' : ''}`),
      tiled: x.tiled
        ? {
            grid: [x.tiled.hTiles, x.tiled.vTiles],
            location: [x.tiled.hLocation, x.tiled.vLocation],
            tile: [x.tiled.tileWidth, x.tiled.tileHeight],
            topologyId: x.tiled.topologyId.map(hex).join(' '),
          }
        : null,
      unknownBlocks: x.unknownBlocks.length,
    }
  }
  return { kind: 'raw', tag: hex(x.tag), bytes: x.bytes.length }
}

function encoded(e: Edid): { bytes: Uint8Array | null; error: string | null } {
  try {
    return { bytes: encodeEdid(e), error: null }
  } catch (err) {
    return { bytes: null, error: (err as Error).message }
  }
}

/**
 * The EDID as a list of what it says. `full` adds the whole model, which is what
 * edit_edid's paths address. A decoded CTA block's `source` is left out of it: it is how
 * the block looked when read, so it saves back byte for byte, and it is not for editing.
 */
export function edidReport(e: Edid, full = false) {
  const primary = primaryTiming(e)
  const { bytes, error } = encoded(e)
  return {
    name: displayName(e),
    manufacturer: e.manufacturerId,
    productCode: e.productCode,
    serialNumber: e.serialNumber,
    edidVersion: `${e.version}.${e.revision}`,
    [e.isModelYear ? 'modelYear' : 'manufactured']: e.isModelYear ? e.year : { year: e.year, week: e.week },
    input: e.input,
    screenCm: [e.screenWidthCm, e.screenHeightCm],
    primaryTiming: primary ? timingReport(primary) : null,
    descriptors: e.descriptors.map(descriptorReport),
    extensions: e.extensions.map(extensionReport),
    encodes: bytes ? { bytes: bytes.length, blocks: bytes.length / 128 } : { error },
    ...(full ? { model: JSON.parse(JSON.stringify(e, (k, v) => (k === 'source' ? undefined : v))) } : {}),
  }
}

function mosaicReport(request: MosaicRequest, result: MosaicResult) {
  return {
    request,
    tile: [result.tileWidth, result.tileHeight],
    tileTiming: timingReport(result.tileTiming),
    baseBlockStandIn: timingLabel(result.baseTiming),
    tiles: result.tiles.map((t) => ({ label: t.label, file: t.file, bytes: t.bytes.length })),
    checks: checkMosaic(request),
  }
}

export function status(s: Session) {
  const o = s.open
  if (!o) return { open: null, signal: s.signal, hint: 'Nothing is open. open_edid reads one; build_edid or build_mosaic makes one.' }
  if (o.kind === 'mosaic') return { open: 'mosaic', ...mosaicReport(o.request, o.result), signal: tileSignal(o.request, s.signal) }
  const primary = primaryTiming(o.edid)
  return {
    open: 'edid',
    from: o.from,
    name: displayName(o.edid),
    primaryTiming: primary ? timingLabel(primary) : null,
    issues: o.issues,
    notes: o.notes,
    signal: s.signal,
    encodes: encoded(o.edid).error ?? 'yes',
  }
}

// -------------------------------------------------------------- opening and building

function needEdid(s: Session): Extract<Open, { kind: 'edid' }> {
  if (!s.open) throw new ToolError('Nothing is open. Call open_edid, build_edid or build_mosaic first.')
  if (s.open.kind !== 'edid') {
    throw new ToolError(
      'A mosaic is open. Its tiles are a reference builder’s bytes and are never edited or re-encoded: change the request with build_mosaic instead.',
    )
  }
  return s.open
}

export async function openEdid(s: Session, input: { path?: string; hex?: string }) {
  if ((input.path === undefined) === (input.hex === undefined)) throw new ToolError('Give exactly one of path or hex.')
  let parsed
  if (input.path !== undefined) {
    if (!existsSync(input.path)) throw new ToolError(`No such file: ${input.path}`)
    if (statSync(input.path).isDirectory()) throw new ToolError(`${input.path} is a directory.`)
    parsed = parseEdidFile(fileContents(new Uint8Array(await readFile(input.path))))
  } else {
    parsed = parseEdidFile(input.hex!)
  }
  s.open = { kind: 'edid', edid: parsed.edid, from: input.path ?? 'pasted hex', issues: parsed.issues, notes: [] }
  s.sourcePath = input.path ?? null
  return { opened: s.open.from, issues: parsed.issues, ...edidReport(parsed.edid) }
}

export interface ModeArgs {
  width: number
  height: number
  refreshHz: number
  standard?: TimingStandard
  interlaced?: boolean
  fractional?: boolean
}

/** A mode asked for by resolution and rate, as simple mode's form states one. */
function request(m: ModeArgs, name: string, signal: SignalOptions): SimpleRequest {
  return {
    ...DEFAULT_REQUEST,
    name,
    hActive: m.width,
    vActive: m.height,
    refreshHz: m.refreshHz,
    standard: m.standard ?? DEFAULT_REQUEST.standard,
    interlaced: m.interlaced ?? false,
    fractional: m.fractional ?? false,
    signal,
  }
}

export function solve(m: ModeArgs) {
  const r = solveTiming(request(m, '', DEFAULT_SIGNAL))
  return { standard: r.standard, vic: r.vic ?? null, notes: r.notes, timing: timingReport(r.timing) }
}

/** The page's name fields stop at 13 characters; the encoder would cut the rest off silently. */
function nameFits(name: string | undefined) {
  if (name !== undefined && [...name].length > 13) {
    throw new ToolError(`"${name}" is ${[...name].length} characters; an EDID name holds 13.`)
  }
}

export function build(s: Session, m: ModeArgs & { name?: string; signal?: Partial<SignalOptions> }) {
  nameFits(m.name)
  const signal = { ...DEFAULT_SIGNAL, ...m.signal }
  const r = buildEdid(request(m, m.name ?? DEFAULT_REQUEST.name, signal))
  const { error } = encoded(r.edid)
  if (error) throw new ToolError(`That EDID cannot be encoded: ${error}`)
  s.open = { kind: 'edid', edid: r.edid, from: 'build_edid', issues: [], notes: r.notes }
  s.signal = signal
  s.sourcePath = null
  return { resolvedStandard: r.resolvedStandard, vic: r.vic ?? null, notes: r.notes, ...edidReport(r.edid) }
}

export function buildMosaicIn(s: Session, patch: Partial<MosaicRequest>) {
  nameFits(patch.name)
  const request = { ...DEFAULT_MOSAIC, ...patch }
  const { errors, result } = tryMosaic(request)
  if (!result) throw new ToolError(`The mosaic cannot be built:\n- ${errors.join('\n- ')}`)
  s.open = { kind: 'mosaic', request, result }
  s.sourcePath = null
  return mosaicReport(request, result)
}

export function describe(s: Session, opts: { full?: boolean; tile?: string }) {
  const o = s.open
  if (!o) throw new ToolError('Nothing is open. Call open_edid, build_edid or build_mosaic first.')
  if (o.kind === 'mosaic') {
    if (opts.tile === undefined) return mosaicReport(o.request, o.result)
    const tile = pickTile(o.result, opts.tile)
    // Decoded to read, never to write back: the tile's own bytes are what export writes.
    const { edid, issues } = decodeEdid(tile.bytes)
    return { tile: tile.label, file: tile.file, issues, ...edidReport(edid, opts.full) }
  }
  if (opts.tile !== undefined) throw new ToolError('tile is for a mosaic; the open EDID has no tiles.')
  return { from: o.from, issues: o.issues, notes: o.notes, ...edidReport(o.edid, opts.full) }
}

function pickTile(r: MosaicResult, which: string) {
  const t = r.tiles.find((x) => x.label === which || x.file === which)
  if (!t) throw new ToolError(`No tile "${which}". Tiles: ${r.tiles.map((x) => x.label).join(', ')}`)
  return t
}

// --------------------------------------------------------------------- editing

export interface Change {
  path: string
  value?: unknown
  remove?: boolean
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', 'source'])

/** `descriptors[1].maxVerticalHz` as keys and indices. */
function parsePath(path: string): (string | number)[] {
  const out: (string | number)[] = []
  const re = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|(\.)/gy
  let m: RegExpExecArray | null
  let last = 0
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) out.push(Number(m[2]))
    last = re.lastIndex
  }
  if (last !== path.length || out.length === 0) throw new ToolError(`${path}: not a path like descriptors[1].maxVerticalHz`)
  for (const k of out) if (typeof k === 'string' && FORBIDDEN.has(k)) throw new ToolError(`${path}: ${k} is not editable`)
  return out
}

const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

function applyChange(root: Edid, c: Change) {
  const keys = parsePath(c.path)
  let parent: unknown = root
  for (const k of keys.slice(0, -1)) {
    const next = (parent as Record<string | number, unknown>)?.[k]
    if (next === undefined || next === null || typeof next !== 'object') throw new ToolError(`${c.path}: nothing at ${String(k)}`)
    parent = next
  }
  const key = keys[keys.length - 1]
  const holder = parent as Record<string | number, unknown>

  if (c.remove) {
    if (!Array.isArray(holder) || typeof key !== 'number' || key >= holder.length) {
      throw new ToolError(`${c.path}: remove takes an existing list entry`)
    }
    holder.splice(key, 1)
    return
  }
  if (c.value === undefined) throw new ToolError(`${c.path}: give a value, or remove: true`)
  // One past the end of a list appends to it.
  if (Array.isArray(holder) && typeof key === 'number' && key === holder.length) {
    holder.push(c.value)
    return
  }
  if (!(key in holder)) {
    throw new ToolError(`${c.path}: no such field. describe_edid with full: true shows the model and its paths.`)
  }
  const was = holder[key]
  // A field keeps its type; null stands in for "absent" on the fields that allow it.
  if (was !== null && c.value !== null && kindOf(was) !== kindOf(c.value)) {
    throw new ToolError(`${c.path} is a ${kindOf(was)}, not a ${kindOf(c.value)}`)
  }
  holder[key] = c.value
}

/**
 * Field edits to the open EDID, all or none. The edited model must still encode: the
 * encoder is the judge of a field out of range, as it is when the page tries to show the
 * bytes, and a refused edit leaves the EDID as it was.
 */
export function edit(s: Session, changes: Change[], name?: string) {
  const o = needEdid(s)
  if (!changes.length && name === undefined) throw new ToolError('Nothing to change: give changes, or a name.')
  nameFits(name)
  let next = structuredClone(o.edid)
  for (const c of changes) applyChange(next, c)
  if (name !== undefined) {
    next = setDisplayName(next, name)
    if (displayName(next) !== name) {
      throw new ToolError('No descriptor slot is free for a name: every one holds something else. Replace one with edit_edid first.')
    }
  }
  const { bytes, error } = encoded(next)
  if (error || !bytes) throw new ToolError(`Not applied — the edited EDID would not encode: ${error}`)
  o.edid = next
  return {
    changed: changes.map((c) => c.path).concat(name !== undefined ? ['name'] : []),
    ...readBack(next, bytes, changes),
    ...edidReport(next),
  }
}

function valueAt(root: unknown, keys: (string | number)[]): unknown {
  let v = root
  for (const k of keys) v = v === null || typeof v !== 'object' ? undefined : (v as Record<string | number, unknown>)[k]
  return v
}

/**
 * Which edited fields the bytes do not hold as given. The encoder stores some fields
 * modulo their width and rounds the clock to 10 kHz, where the page's inputs stop at the
 * field's range; read back, the bytes say what a sink will see.
 */
function readBack(next: Edid, bytes: Uint8Array, changes: Change[]) {
  const back = decodeEdid(bytes).edid
  const lost = changes
    .filter((c) => !c.remove)
    .flatMap((c) => {
      const keys = parsePath(c.path)
      const wrote = valueAt(next, keys)
      const read = valueAt(back, keys)
      return read === undefined || JSON.stringify(read) === JSON.stringify(wrote) ? [] : [`${c.path}: set to ${JSON.stringify(wrote)}, the bytes read back ${JSON.stringify(read)}`]
    })
  return lost.length ? { readBack: lost } : {}
}

// -------------------------------------------------------------- links and devices

/**
 * The timing a link or device question is about, and the signal through it: a mode asked
 * for by resolution and rate, else the open EDID's primary timing, else a mosaic tile's.
 */
function subject(s: Session, mode: ModeArgs | undefined, signal: Partial<SignalOptions> | undefined) {
  if (mode) {
    const r = solveTiming(request(mode, '', DEFAULT_SIGNAL))
    return { of: `the ${r.standard} timing for the mode asked for`, timing: r.timing, signal: { ...s.signal, ...signal } }
  }
  const o = s.open
  if (!o) throw new ToolError('Nothing is open. Give a mode, or open or build an EDID first.')
  if (o.kind === 'mosaic') {
    return { of: 'each mosaic tile', timing: o.result.tileTiming, signal: tileSignal(o.request, { ...s.signal, ...signal }) }
  }
  const timing = primaryTiming(o.edid)
  if (!timing) {
    throw new ToolError(
      'This EDID carries no timing — no detailed timing descriptor, no CTA timing and no DisplayID timing — so there is nothing to cost or to check against hardware.',
    )
  }
  return { of: 'the open EDID’s primary timing', timing, signal: { ...s.signal, ...signal } }
}

const gbps = (bps: number) => +(bps / 1e9).toFixed(3)
const share = (u: number) => +(u * 100).toFixed(1)

export function links(s: Session, mode?: ModeArgs, signal?: Partial<SignalOptions>) {
  const { of, timing: t, signal: sig } = subject(s, mode, signal)
  const hdmi = hdmiRequirement(t, sig)
  const dp = (lanes: 2 | 4) => {
    const r = dpRequirement(t, sig, lanes)
    return { minimum: r.rate ? `${r.rate.name}, since ${r.rate.since}` : null, percentOfRate: share(r.utilisation), ...(r.note ? { note: r.note } : {}) }
  }
  const dvi = dviRequirement(t, sig)
  return {
    of,
    mode: timingReport(t),
    signal: sig,
    bitsPerPixel: { hdmi: bitsPerPixel(sig, 'hdmi'), displayport: bitsPerPixel(sig, 'displayport') },
    payloadGbps: { hdmi: gbps(payloadBps(t, sig, 'hdmi')), displayport: gbps(payloadBps(t, sig, 'displayport')) },
    hdmi: {
      minimum: hdmi.version?.name ?? null,
      via: hdmi.version ? (hdmi.viaTmds ? 'TMDS' : 'FRL') : null,
      ...(Number.isFinite(hdmi.tmdsCharacterRateHz) ? { tmdsCharacterRateMHz: mhz(hdmi.tmdsCharacterRateHz) } : {}),
      percentOfLink: share(hdmi.utilisation),
      ...(hdmi.note ? { note: hdmi.note } : {}),
    },
    displayPort4Lane: dp(4),
    displayPort2Lane: dp(2),
    dvi: dvi.link ?? 'beyond dual link',
    caveat:
      'DisplayPort figures are the raw link budget after line coding; transfer-unit overhead makes real capacity a little lower, so above 98% is marginal, not a pass. HDMI TMDS is a clock ceiling and is exact. FRL is after 16b/18b only: FEC and packet overhead are not modelled.',
  }
}

function verdictRow(v: DeviceVerdict) {
  return {
    id: v.device.id,
    device: `${v.device.vendor} ${v.device.model}`,
    family: v.device.family,
    ...(v.device.role === 'source' ? { role: 'source' } : {}),
    status: v.status,
    ...(v.requiredMode ? { mode: v.requiredMode.label } : {}),
    ...(v.requiredConnector ? { via: v.requiredConnector.label } : {}),
    ...(v.status === 'unsupported' ? { why: unsupportedReason(v) } : {}),
    ...(v.warnings.length ? { warnings: v.warnings } : {}),
    confidence: v.device.confidence,
  }
}

function verdictDetail(v: DeviceVerdict) {
  return {
    ...verdictRow(v),
    modes: v.modes.map((m) => ({
      label: m.mode.label,
      ok: m.ok,
      ...(m.mode.tradeoff ? { tradeoff: m.mode.tradeoff } : {}),
      connectors: m.connectors.map((c) => ({
        label: c.connector.label,
        count: c.connector.count,
        ok: c.ok,
        percentOfCeiling: share(c.headroom),
        ...(c.reasons.length ? { reasons: c.reasons } : {}),
      })),
    })),
    notes: v.device.notes,
    citations: v.device.citations,
  }
}

function findDevice(id: string): Device {
  const d = DEVICE_LIST.find((x) => x.id === id)
  if (!d) throw new ToolError(`No device "${id}". list_devices gives the ids.`)
  return d
}

const sameVendor = (d: Device, vendor: string | undefined) => !vendor || d.vendor.toLowerCase() === vendor.trim().toLowerCase()

export function check(
  s: Session,
  opts: { mode?: ModeArgs; signal?: Partial<SignalOptions>; vendor?: string; status?: Status[]; device?: string },
) {
  const { of, timing, signal } = subject(s, opts.mode, opts.signal)
  const head = { of, mode: timingLabel(timing), signal }
  if (opts.device) {
    return { ...head, ...verdictDetail(evaluateAll(timing, signal, [findDevice(opts.device)])[0]), caveat: HARDWARE_CAVEAT }
  }
  const all = evaluateAll(timing, signal)
  const count = (st: Status) => all.filter((v) => v.status === st).length
  const shown = all.filter((v) => sameVendor(v.device, opts.vendor) && (!opts.status?.length || opts.status.includes(v.status)))
  if (opts.vendor && !all.some((v) => sameVendor(v.device, opts.vendor))) {
    throw new ToolError(`No vendor "${opts.vendor}". Vendors: ${[...new Set(DEVICE_LIST.map((d) => d.vendor))].join(', ')}`)
  }
  return {
    ...head,
    counts: { supported: count('supported'), conditional: count('conditional'), unsupported: count('unsupported'), unknown: count('unknown') },
    devices: shown.map(verdictRow),
    caveat: `${HARDWARE_CAVEAT} "conditional" means it fits only in a mode someone has to go and configure; the row says which.`,
  }
}

export function devices(opts: { vendor?: string; id?: string }) {
  if (opts.id) {
    const d = findDevice(opts.id)
    return { ...d, caveat: HARDWARE_CAVEAT }
  }
  const list = DEVICE_LIST.filter((d) => sameVendor(d, opts.vendor))
  if (!list.length) throw new ToolError(`No vendor "${opts.vendor}". Vendors: ${[...new Set(DEVICE_LIST.map((d) => d.vendor))].join(', ')}`)
  return {
    devices: list.map((d) => ({
      id: d.id,
      device: `${d.vendor} ${d.model}`,
      family: d.family,
      ...(d.role === 'source' ? { role: 'source' } : {}),
      modes: d.capacityModes.map((m) => m.label),
      confidence: d.confidence,
    })),
    caveat: HARDWARE_CAVEAT,
  }
}

// --------------------------------------------------------------------- writing

export async function exportTo(s: Session, out: string, opts: { format?: ByteFormat | 'bin'; tile?: string; overwrite?: boolean }) {
  const o = s.open
  if (!o) throw new ToolError('Nothing is open. Call open_edid, build_edid or build_mosaic first.')
  const path = resolve(out)
  if (s.sourcePath && path === resolve(s.sourcePath)) throw new ToolError('That is the file that was opened. Write the EDID somewhere else.')
  if (!existsSync(dirname(path))) throw new ToolError(`No such directory: ${dirname(path)}`)
  if (existsSync(path) && !opts.overwrite) throw new ToolError(`${path} already exists. Pass overwrite: true to replace it, or give another path.`)
  const format = opts.format ?? 'bin'

  let bytes: Uint8Array
  let name: string
  let what: string
  if (o.kind === 'mosaic') {
    if (opts.tile === undefined) {
      if (format !== 'bin') throw new ToolError('A whole mosaic is written as a .zip of its tiles. Name a tile to write one as text.')
      if (!/\.zip$/i.test(path)) throw new ToolError('A whole mosaic is written as a zip of its tiles; give a path ending in .zip, or name a tile.')
      const zip = mosaicArchive(o.request, o.result)
      await writeFile(path, zip.bytes)
      return { wrote: path, bytes: zip.bytes.length, tiles: o.result.tiles.map((t) => t.file), pageWouldName: zip.name }
    }
    const tile = pickTile(o.result, opts.tile)
    bytes = tile.bytes
    name = tile.file.replace(/\.bin$/, '')
    what = `tile ${tile.label}, as built`
  } else {
    if (opts.tile !== undefined) throw new ToolError('tile is for a mosaic; the open EDID has no tiles.')
    const r = encoded(o.edid)
    if (!r.bytes) throw new ToolError(`This EDID cannot be encoded: ${r.error}`)
    bytes = r.bytes
    name = displayName(o.edid) || 'edid'
    what = 'the open EDID'
  }
  const data = format === 'bin' ? bytes : new TextEncoder().encode(renderBytes(bytes, format, name))
  await writeFile(path, data)
  return { wrote: path, what, format, bytes: bytes.length, blocks: bytes.length / 128 }
}
