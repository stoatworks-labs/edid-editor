/**
 * EDID Editor's operations as MCP tools: what a person does on the page, one tool each.
 *
 * Every tool is a thin wrapper over `session.ts`, which asks `lib/` the page's questions.
 * The schemas are strict — an unknown argument is refused — and their ranges are the
 * page's: simple mode's width stops at 16384, and so does build_edid's.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { TIMING_STANDARDS } from '../lib/build.ts'
import { BYTE_FORMATS } from '../lib/hexdump.ts'
import { DEFAULT_MOSAIC, type MosaicRequest } from '../lib/mosaic.ts'
import type { SignalOptions } from '../lib/link.ts'
import type { Status } from '../lib/capability/evaluate.ts'
import type { ByteFormat } from '../lib/hexdump.ts'
import { type JsonSchema, type ServerInfo, type Tool } from './protocol.ts'
import {
  type BuildArgs,
  type Change,
  type ModeArgs,
  type Session,
  build,
  buildMosaicIn,
  check,
  describe,
  devices,
  edit,
  exportTo,
  links,
  newSession,
  openEdid,
  solve,
  status,
} from './session.ts'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }

export const SERVER_INFO: ServerInfo = {
  name: 'edid-editor',
  version,
  instructions: [
    'EDID Editor builds, reads, edits and checks EDIDs, and says which event-video processors (Analog Way, Barco, PixelHue, NovaStar and others) will accept a mode, and in which input mode. It works on files on this machine; nothing is uploaded.',
    'One thing is open at a time: an EDID (open_edid reads a .bin or any hex dump; build_edid makes one from a resolution and rate) or a mosaic (build_mosaic: one tiled EDID per plug, so a Mac bonds several outputs into one display). describe_edid shows it, edit_edid changes fields, export writes it. link_requirements and check_devices answer for the open EDID’s primary timing, a mosaic tile, or a mode given directly; solve_timing and list_devices need nothing open.',
    'Heights are whole-frame active lines (1080 for 1080i). Refresh is the field rate for an interlaced mode. The signal (colour format, bit depth, DSC, VRR) is what will be sent through the EDID; build_edid sets it, and link_requirements and check_devices can be asked about another for one call.',
    'Say this whenever it matters: the hardware table is vendor manuals and spec sheets, cited per claim, and none of it has been tried on real hardware; no EDID this tool builds has been fed to a device. "inferred" and "unverified" rows are weaker still. A mosaic’s tiles are a reference builder’s bytes and are never edited.',
  ].join('\n\n'),
}

/** `~/x` and relative paths, resolved the way a shell in the client's directory would. */
function resolvePath(p: string): string {
  const expanded = p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
  return resolve(process.cwd(), expanded)
}

const STANDARD: JsonSchema = {
  type: 'string',
  enum: TIMING_STANDARDS.map((s) => s.value),
  description: `How the blanking is chosen: ${TIMING_STANDARDS.map((s) => `${s.value} = ${s.label}`).join('; ')}. Default manual (the automatic choice).`,
}

const MODE: Record<string, JsonSchema> = {
  width: { type: 'integer', minimum: 8, maximum: 16384, description: 'Active pixels per line.' },
  height: { type: 'integer', minimum: 8, maximum: 8192, description: 'Active lines of the whole frame: 1080 for 1080i.' },
  refreshHz: { type: 'number', minimum: 1, maximum: 480, description: 'Hz. The field rate for an interlaced mode. 59.94 is 60 with fractional: true.' },
  standard: STANDARD,
  interlaced: { type: 'boolean', description: 'Default false.' },
  fractional: { type: 'boolean', description: 'The 1000/1001 rate: 59.94 rather than 60. Default false.' },
}

const MODE_OBJECT: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['width', 'height', 'refreshHz'],
  properties: MODE,
  description: 'Ask about this mode instead of what is open, timed as build_edid would time it.',
}

const SIGNAL: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    format: { type: 'string', enum: ['rgb444', 'ycbcr444', 'ycbcr422', 'ycbcr420'] },
    bpc: { type: 'integer', enum: [8, 10, 12, 16], description: 'Bits per component.' },
    dsc: { type: 'boolean', description: 'Display Stream Compression.' },
    dscTargetBpp: { type: 'number', minimum: 6, maximum: 24, description: 'DSC target, bits per PIXEL. 12 is the usual visually lossless target for 4:4:4.' },
    vrr: { type: 'boolean', description: 'Variable refresh. Costs no bandwidth; it gates the interface version.' },
    vrrMinHz: { type: 'number', minimum: 1, maximum: 500 },
    vrrMaxHz: { type: 'number', minimum: 1, maximum: 500 },
  },
  description: 'The signal sent through the EDID. Fields left out keep their current values (the defaults are RGB 4:4:4, 8-bit, no DSC, no VRR).',
}

const MOSAIC_FIELDS: Record<string, JsonSchema> = {
  width: { type: 'integer', minimum: 8, maximum: 16384, description: `The whole canvas, pixels. Default ${DEFAULT_MOSAIC.width}.` },
  height: { type: 'integer', minimum: 8, maximum: 8192, description: `The whole canvas, lines. Default ${DEFAULT_MOSAIC.height}.` },
  cols: { type: 'integer', minimum: 1, maximum: 16, description: `Default ${DEFAULT_MOSAIC.cols}. Only 2 x 1 and 2 x 2 have been seen to bond on a Mac.` },
  rows: { type: 'integer', minimum: 1, maximum: 16, description: `Default ${DEFAULT_MOSAIC.rows}.` },
  refreshHz: { type: 'number', minimum: 1, maximum: 240, description: `Default ${DEFAULT_MOSAIC.refreshHz}.` },
  name: { type: 'string', description: `The monitor name, the same on every tile, 13 characters at most. Default "${DEFAULT_MOSAIC.name}".` },
  bitDepth: { type: 'integer', enum: [8, 10], description: `Default ${DEFAULT_MOSAIC.bitDepth}.` },
  vendor: { type: 'string', description: `Three-letter PNP id, in the base block and the topology id. Default ${DEFAULT_MOSAIC.vendor}.` },
  product: { type: 'integer', minimum: 0, maximum: 65535, description: `Default ${DEFAULT_MOSAIC.product}.` },
  group: { type: 'integer', minimum: 0, maximum: 255, description: 'The mosaic number. Two mosaics on one Mac need two numbers. Default 1.' },
}

const TILE: JsonSchema = { type: 'string', description: 'A mosaic tile, by label (left, right, r1c2) or file name.' }

/** The tools, over one session. A fresh set per server, so the tests can run several. */
export function edidTools(state: Session = newSession()): Tool[] {
  return [
    {
      name: 'open_edid',
      title: 'Open an EDID',
      description:
        'Read an EDID, replacing whatever is open: a binary .bin, or a hex dump in any common shape (xrandr, edid-decode, xxd, a C array, bare hex), from a file or pasted. Never refuses a damaged EDID: it opens with the problems listed under issues. Unedited, a real EDID exports back byte for byte.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'The file. Relative paths resolve against the server’s working directory.' },
          hex: { type: 'string', description: 'A hex dump, instead of a file.' },
        },
      },
      run: (a) => openEdid(state, { path: a.path === undefined ? undefined : resolvePath(a.path as string), hex: a.hex as string | undefined }),
    },
    {
      name: 'build_edid',
      title: 'Build an EDID',
      description:
        'Simple mode: a whole EDID from a resolution and a refresh rate, replacing whatever is open. The mode as a native detailed timing, a range descriptor around it, the name, a CTA extension with the VIC when the mode is one, and a DisplayID extension only when a DTD cannot hold it. Notes say what was decided and why.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height', 'refreshHz'],
        properties: {
          ...MODE,
          name: { type: 'string', description: 'What every input menu shows. 13 characters at most. Default UHD-2160p60.' },
          signal: { ...SIGNAL, description: 'The signal the EDID is built for. Fields left out take the defaults: RGB 4:4:4, 8-bit, no DSC, no VRR.' },
          productCode: { type: 'integer', minimum: 0, maximum: 65535, description: 'Bytes 10-11. Default 1.' },
          serialNumber: {
            type: 'integer',
            minimum: 0,
            maximum: 4294967295,
            description:
              'Bytes 12-15. A computer tells displays apart by manufacturer, product code and serial number, not by name, so when building several EDIDs give each its own. Default 1.',
          },
        },
      },
      run: (a) => build(state, a as unknown as BuildArgs),
    },
    {
      name: 'build_mosaic',
      title: 'Build a mosaic',
      description:
        'Mosaic mode: one canvas split across several plugs, one tiled EDID per plug, so a Mac treats the outputs as one frame-synced display. The bytes copy a reference builder that has bonded on macOS 26 and 27. Replaces whatever is open. Fields left out take the page’s defaults. Lists the tiles and the checks: what a Mac is known to do with the set.',
      inputSchema: { type: 'object', additionalProperties: false, properties: MOSAIC_FIELDS },
      run: (a) => buildMosaicIn(state, a as Partial<MosaicRequest>),
    },
    {
      name: 'status',
      title: 'What is open',
      description: 'What is open, where it came from, its name and primary timing, its decode issues and build notes, and the signal being asked about.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      annotations: { readOnlyHint: true },
      run: () => status(state),
    },
    {
      name: 'describe_edid',
      title: 'Describe the EDID',
      description:
        'The open EDID field by field: identity, input, the primary timing with its raster and rates, each descriptor, each extension (CTA VICs and data blocks, DisplayID timings and tiling), and whether it encodes. full: true adds the whole model, whose paths edit_edid takes. For a mosaic, the set and its checks; name a tile to decode that tile.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { full: { type: 'boolean', description: 'Include the whole model. Long.' }, tile: TILE },
      },
      annotations: { readOnlyHint: true },
      run: (a) => describe(state, { full: a.full as boolean | undefined, tile: a.tile as string | undefined }),
    },
    {
      name: 'edit_edid',
      title: 'Edit fields',
      description:
        'Advanced mode: change fields of the open EDID by path into the model that describe_edid { full: true } shows, as in descriptors[1].maxVerticalHz or extensions[0].videoDescriptors[0].vic. A field keeps its type. An index one past the end of a list appends; remove: true deletes a list entry. All the changes apply or none do: the result must still encode, and a refusal says which field broke it. Not for a mosaic.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          changes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path'],
              properties: {
                path: { type: 'string' },
                value: { description: 'The new value: number, string, boolean, null, list or object.' },
                remove: { type: 'boolean' },
              },
            },
          },
          name: { type: 'string', description: 'The display name, as the page’s Name field sets it: the name descriptor, or the first free slot. 13 characters at most.' },
        },
      },
      run: (a) => edit(state, (a.changes as Change[] | undefined) ?? [], a.name as string | undefined),
    },
    {
      name: 'solve_timing',
      title: 'Solve a timing',
      description:
        'The timing build_edid would use for a mode, without building anything: which standard it came from (a CTA VIC first, under the automatic choice), the blanking, the clock, the line and refresh rates, and whether a detailed timing descriptor can hold it.',
      inputSchema: { type: 'object', additionalProperties: false, required: ['width', 'height', 'refreshHz'], properties: MODE },
      annotations: { readOnlyHint: true },
      run: (a) => solve(a as unknown as ModeArgs),
    },
    {
      name: 'link_requirements',
      title: 'What the mode costs',
      description:
        'The link panel: the pixel clock, bits per pixel and payload on HDMI and on DisplayPort (4:2:2 costs them differently), and the minimum HDMI version, DisplayPort rate at 4 and 2 lanes, and DVI link that carry it. For the open EDID’s primary timing, a mosaic tile, or a mode given.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { mode: MODE_OBJECT, signal: SIGNAL } },
      annotations: { readOnlyHint: true },
      run: (a) => links(state, a.mode as ModeArgs | undefined, a.signal as Partial<SignalOptions> | undefined),
    },
    {
      name: 'check_devices',
      title: 'Which hardware takes it',
      description:
        'The support table: for every processor and source in the table, whether it takes the mode with this signal (supported, conditional on an input mode someone has to configure, unsupported, or unknown), the input mode and connector it needs, and what to watch. device: an id gives every input mode’s connectors with their reasons, and the citations.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: MODE_OBJECT,
          signal: SIGNAL,
          vendor: { type: 'string', description: 'Only this vendor’s devices (the counts still cover all).' },
          status: {
            type: 'array',
            items: { type: 'string', enum: ['supported', 'conditional', 'unsupported', 'unknown'] },
            description: 'Only devices with these verdicts.',
          },
          device: { type: 'string', description: 'One device in full, by id (list_devices).' },
        },
      },
      annotations: { readOnlyHint: true },
      run: (a) =>
        check(state, {
          mode: a.mode as ModeArgs | undefined,
          signal: a.signal as Partial<SignalOptions> | undefined,
          vendor: a.vendor as string | undefined,
          status: a.status as Status[] | undefined,
          device: a.device as string | undefined,
        }),
    },
    {
      name: 'list_devices',
      title: 'The hardware table',
      description:
        'The devices the support table knows, with their input modes and how confident the table is (documented, inferred, unverified). id: a device in full: connectors and their ceilings, notes, and every citation with its read date.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { vendor: { type: 'string' }, id: { type: 'string' } },
      },
      annotations: { readOnlyHint: true },
      run: (a) => devices({ vendor: a.vendor as string | undefined, id: a.id as string | undefined }),
    },
    {
      name: 'export',
      title: 'Write the EDID',
      description: `Write what is open to a file, as the page saves it: bin (the only format an EDID writer eats) or a text dump (${BYTE_FORMATS.map((f) => `${f.value} = ${f.label}`).join(', ')}). A mosaic writes every tile, as built, into one .zip, or one tile when named. Never writes over the file that was opened, and refuses an existing file unless overwrite is true.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Where to write. Relative paths resolve against the server’s working directory.' },
          format: { type: 'string', enum: ['bin', ...BYTE_FORMATS.map((f) => f.value)], description: 'Default bin.' },
          tile: TILE,
          overwrite: { type: 'boolean' },
        },
      },
      annotations: { destructiveHint: false },
      run: (a) =>
        exportTo(state, resolvePath(a.path as string), {
          format: a.format as ByteFormat | 'bin' | undefined,
          tile: a.tile as string | undefined,
          overwrite: a.overwrite === true,
        }),
    },
  ]
}
