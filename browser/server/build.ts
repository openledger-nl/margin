// Bundles the MCP server into dist/cli.js: one file with every dependency, so
// `npx browser-review-mcp` starts fast and installs nothing else.
import { chmodSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const out = join(dist, 'cli.js');
await esbuild.build({
  entryPoints: [join(root, 'src', 'cli.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // ws can use these native add-ons when installed; it works fine without them.
  external: ['bufferutil', 'utf-8-validate'],
  // Some bundled CommonJS code calls require() for Node built-ins.
  banner: { js: "import { createRequire as __brmCreateRequire } from 'node:module'; const require = __brmCreateRequire(import.meta.url);" },
  legalComments: 'linked',
  logLevel: 'info',
});
chmodSync(out, 0o755);
copyFileSync(join(root, '..', 'LICENSE'), join(dist, 'LICENSE'));
