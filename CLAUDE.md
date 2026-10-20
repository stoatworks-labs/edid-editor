# Otter EDID Editor — command reference

See `AGENTS.md` for the mental model, invariants and what is actually verified.

```bash
npm install
npm run dev          # port 5173 by default; the launch.json entry uses 5199
npm test             # vitest, 127 tests
npm run build        # -> dist/
npm run build:embed  # -> dist-embed/, committed; LivePremier Plus vendors it
npm run serve:dist   # serves dist/ WITH public/_headers, unlike `npm run preview`
```

Do not hand-edit `src/lib/edid/tables.ts` except to append — the tables are
positional bit maps.
