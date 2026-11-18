// Builds the extension. Run with `node build.ts`.
//   (no flag)   Chrome / Brave / Edge into dist/
//   --firefox   Firefox into dist-firefox/ (same code, Firefox manifest)
//   --zip       release build (no sourcemaps), zipped into release/
//   --watch     rebuild on every change (then reload the extension in the browser)
import { copyFileSync, mkdirSync, readFileSync, rmSync, watch as watchDir, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { filesIn, zip } from './zip.ts';

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const release = process.argv.includes('--zip');
const firefox = process.argv.includes('--firefox');
const dist = join(root, firefox ? 'dist-firefox' : 'dist');

/** Add-on ID on addons.mozilla.org. Keep it fixed: Firefox keys the add-on's storage to it. */
const GECKO_ID = 'margin-github@andor00';

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'icons'), { recursive: true });
copyStatic();
// The icon is the Margin mark, shared by every extension in this repo: see ../brand/.
for (const size of [16, 32, 48, 128]) copyFileSync(join(root, '..', 'brand', 'icons', `${size}.png`), join(dist, 'icons', `${size}.png`));

/** The files in static/ that are copied as they are (the manifest per browser). */
function copyStatic(): void {
  for (const file of ['popup.html', 'home.css']) copyFileSync(join(root, 'static', file), join(dist, file));
  copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE'));
  const manifest = JSON.parse(readFileSync(join(root, 'static', 'manifest.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(firefox ? firefoxManifest(manifest) : manifest, null, 2)}\n`);
}

const options: esbuild.BuildOptions = {
  entryPoints: {
    content: join(root, 'src', 'content.ts'),
    popup: join(root, 'src', 'popup.tsx'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: firefox ? 'firefox128' : 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  // Firefox's own `browser` namespace is the one with promises everywhere; its `chrome` is a compatibility layer.
  define: firefox ? { chrome: 'browser' } : {},
  sourcemap: release ? false : 'linked',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  let timer: ReturnType<typeof setTimeout> | undefined;
  watchDir(join(root, 'static'), () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        copyStatic();
        console.log('static/ copied');
      } catch (err) {
        console.error(err);
      }
    }, 100);
  });
  console.log(`
Watching. Load ${dist} once (${firefox ? 'about:debugging → This Firefox → Load Temporary Add-on → manifest.json' : 'chrome://extensions → Developer mode → Load unpacked'}).
After a change, reload the extension there and then the GitHub tab.
`);
} else {
  await esbuild.build(options);
  if (release) {
    const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')) as { version: string };
    const outDir = join(root, 'release');
    const out = join(outDir, `margin-github-${version}-${firefox ? 'firefox' : 'chrome'}.zip`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, zip(filesIn(dist)));
    console.log(`\nPackaged ${out}`);
  }
}

/** Firefox needs an add-on ID and a data collection statement for signing, and knows no minimum_chrome_version. */
function firefoxManifest(m: Record<string, unknown>): Record<string, unknown> {
  const { minimum_chrome_version: _min, ...rest } = m;
  return {
    ...rest,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        // 121: CSS :has(), which the declutter tweaks use. 140: data_collection_permissions.
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: '142.0' },
    },
  };
}
