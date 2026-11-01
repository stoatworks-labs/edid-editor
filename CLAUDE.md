# EDID Editor — command reference

See `AGENTS.md` for the mental model, invariants and what is actually verified.

```bash
npm install
npm run dev          # port 5173 by default; the launch.json entry uses 5199
npm test             # vitest, 178 tests
npm run build        # -> dist/
npm run build:embed  # -> dist-embed/, committed; LivePremier Plus vendors it
npm run serve:dist   # serves dist/ WITH public/_headers, unlike `npm run preview`
node src/mcp/server.ts   # the MCP server over stdio (Node >= 22.18, no install needed)
```

Do not hand-edit `src/lib/edid/tables.ts` except to append — the tables are
positional bit maps.

## The MCP server

- **`src/mcp/` builds, costs and judges nothing itself.** It calls what the page calls.
  Whatever a panel decided in a component (the byte dumps, the file sniff, the mosaic's
  try-build, the tile's signal, an unsupported row's reason, the standards offered) now
  lives in `lib/` for both. A decision written in `src/mcp/` is a second copy of the page.
  Its tests compare against the library asked directly: the same bytes as the page's
  download, the same verdicts as the support table.
- **`src/lib/` and `src/mcp/` run under Node's type stripping**, straight from source.
  `erasableSyntaxOnly` and `verbatimModuleSyntax` in `tsconfig.json` hold that line: no
  enums, namespaces or parameter properties (`EncodeError` had one), type-only imports say
  `type`, and imports carry `.ts`. `lib/` takes no npm dependency, which is why the server
  needs no install.
- **stdout belongs to the protocol.** `src/mcp/stdout.ts` sends console output to stderr
  and has to be `server.ts`'s FIRST import. The spawn test in `mcp.test.ts` is the only
  test that would see a stray line.
- **A mosaic's tiles are never edited and never encoded.** `edit_edid` refuses while a
  mosaic is open, and `export` writes `tile.bytes`, as the page's download does.
- **`edit_edid` reads back what it wrote.** The encoder stores some fields modulo their
  width and rounds the clock to 10 kHz, and the page's inputs stop at a field's range where
  a model's do not. A changed field the bytes do not hold comes back under `readBack`.
- **`src/mcp/protocol.ts` is VENDORED** from `stoatworks-backend/mcp/protocol.ts`, the
  same file in every tool's server. Never edit it here: change the master and run
  `stoatworks-backend/scripts/sync-mcp.py --apply`.
