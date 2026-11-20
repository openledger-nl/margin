// Bundles the hub into dist/hub.js: one file with no dependencies, so the
// Docker image holds only Node and this file.
import { chmodSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
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
