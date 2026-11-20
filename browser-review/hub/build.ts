// Bundles the hub into dist/hub.js: one file with no dependencies, so the
// Docker image holds only Node and this file.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const out = join(dist, 'hub.js');
await esbuild.build({
  entryPoints: [join(root, 'src', 'cli.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  define: { __HUB_VERSION__: JSON.stringify(version) },
  legalComments: 'linked',
  logLevel: 'info',
});
chmodSync(out, 0o755);
copyFileSync(join(root, '..', 'LICENSE'), join(dist, 'LICENSE'));

// margin.js, the staging overlay, is built by the extension (pnpm --dir extension build:embed).
const overlay = join(root, '..', 'extension', 'dist-embed', 'margin.js');
if (existsSync(overlay)) {
  mkdirSync(join(dist, 'public'), { recursive: true });
  copyFileSync(overlay, join(dist, 'public', 'margin.js'));
  copyFileSync(join(dirname(overlay), 'overview.js'), join(dist, 'public', 'overview.js'));
  console.log('  dist/public/margin.js and overview.js (from extension/dist-embed)');
} else {
  console.warn('  No extension/dist-embed/margin.js: this hub serves no overlay. Run pnpm --dir extension build:embed first.');
}
