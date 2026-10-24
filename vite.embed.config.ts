import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * The embeddable build — see src/embed.tsx.
 *
 * One ES module with everything inside it, React included, because its first
 * consumer (LivePremier Plus) has no bundler and vendors a single file the way
 * it vendors aquilon-pitch's engine. Unminified, so a diff of a re-sync is
 * readable and a stack trace in the host names real functions.
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`v${pkg.version}`),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [react()],
  // The site's icons, worker and headers are the site's; the module needs none of them.
  publicDir: false,
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'src/embed.tsx',
      formats: ['es'],
      fileName: () => 'edid-editor-embed.js',
    },
  },
})
