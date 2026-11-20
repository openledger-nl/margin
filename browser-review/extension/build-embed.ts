// Builds margin.js, the review overlay for staging sites, into dist-embed/.
// The hub serves it (hub/build.ts copies it in). Run with `node build-embed.ts`.
//   --watch   rebuild on every change
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist-embed');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const options: esbuild.BuildOptions = {
  // margin.js (the toolbar) and overview.js (the hub's overview page for customers).
  entryPoints: { margin: join(root, 'src', 'embed', 'index.ts'), overview: join(root, 'src', 'overview', 'hub-entry.tsx') },
  outdir: dist,
  bundle: true,
  // One classic script, so a plain <script src defer> works on any site.
  format: 'iife',
  // Customers use whatever browser they have, not just the ones the extension supports.
  target: ['chrome111', 'firefox115', 'safari16', 'edge111'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  define: { __DEV_RELOAD__: 'null' },
  minify: true,
  legalComments: 'eof',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
