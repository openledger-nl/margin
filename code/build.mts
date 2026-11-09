// Bundles the extension into dist/extension.js. `--watch` rebuilds on change, `--production` minifies.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const options: esbuild.BuildOptions = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // VS Code 1.100 runs extensions on Node 20.
  target: 'node20',
  external: ['vscode'],
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
