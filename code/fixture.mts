// pnpm fixture: writes test/fixtures/ (the fixture vault and CONTENTS.md) again with margin-code's own code.
// Run it when a change to the writer is meant to change the files, commit them, and tell the Ledger side.
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import * as path from 'node:path';

await esbuild.build({
  entryPoints: ['src/fixture.ts'],
  outfile: 'dist/fixture.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'warning',
});
const require = createRequire(import.meta.url);
const { generateFixture } = require(path.resolve('dist/fixture.cjs')) as typeof import('./src/fixture.ts');
const result = await generateFixture('test/fixtures');
console.log(`Wrote test/fixtures/vault (${result.files.length} files) and test/fixtures/CONTENTS.md.`);
