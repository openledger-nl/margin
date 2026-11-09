// Builds the extension. Run with `node build.ts`.
//   (no flag)   Chrome / Brave / Edge into dist/
//   --firefox   Firefox into dist-firefox/ (same code, Firefox manifest)
//   --zip       release build (no sourcemaps), zipped into release/
//   --watch     rebuild on every change, and hot reload: the extension reloads
//               itself and the localhost tabs (see src/dev-reload.ts)
import { copyFileSync, mkdirSync, readFileSync, rmSync, watch as watchDir, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import { filesIn, zip } from './zip.ts';

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const release = process.argv.includes('--zip');
const firefox = process.argv.includes('--firefox');
const dist = join(root, firefox ? 'dist-firefox' : 'dist');

/** Add-on ID on addons.mozilla.org. Keep it fixed: Firefox keys the add-on's data (IndexedDB) to it. */
const GECKO_ID = 'browser-review@andor00';

/** Hot reload server of `--watch`, one port per browser so both can run. Dev builds only. */
const DEV_RELOAD_PORT = firefox ? 4779 : 4778;

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'icons'), { recursive: true });
copyStatic();
for (const size of [16, 48, 128]) writeFileSync(join(dist, 'icons', `${size}.png`), icon(size));

/** The files in static/ that are copied as they are (the manifest per browser). */
function copyStatic(): void {
  for (const file of ['notice.html', 'help.html', 'panel.html']) copyFileSync(join(root, 'static', file), join(dist, file));
  copyFileSync(join(root, '..', 'LICENSE'), join(dist, 'LICENSE'));
  const manifest = JSON.parse(readFileSync(join(root, 'static', 'manifest.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dist, 'manifest.json'), `${JSON.stringify(firefox ? firefoxManifest(manifest) : manifest, null, 2)}\n`);
}

const options: esbuild.BuildOptions = {
  entryPoints: {
    background: join(root, 'src', 'background.ts'),
    content: join(root, 'src', 'content', 'index.tsx'),
    'main-world': join(root, 'src', 'main-world.ts'),
    notice: join(root, 'src', 'notice.ts'),
    help: join(root, 'src', 'help.ts'),
    panel: join(root, 'src', 'panel.tsx'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: firefox ? 'firefox140' : 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  // Firefox's own `browser` namespace is the one with promises everywhere; its `chrome` is a compatibility layer.
  define: {
    ...(firefox ? { chrome: 'browser' } : {}),
    // Release and normal builds leave the hot reload code out entirely.
    __DEV_RELOAD__: watch ? JSON.stringify(`http://127.0.0.1:${DEV_RELOAD_PORT}/build`) : 'null',
  },
  sourcemap: release ? false : 'linked',
  logLevel: 'info',
};

if (watch) {
  const reload = devReloadServer();
  const ctx = await esbuild.context({ ...options, plugins: [reload.plugin] });
  await ctx.watch();
  // esbuild only watches the code it bundles; static/ changes trigger a rebuild too.
  let timer: ReturnType<typeof setTimeout> | undefined;
  watchDir(join(root, 'static'), () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        copyStatic();
        void ctx.rebuild();
      } catch (err) {
        console.error(err);
      }
    }, 100);
  });
  const cli = join(root, '..', 'server', 'src', 'cli.ts');
  // A running watch keeps the build options it started with.
  for (const file of ['build.ts', 'zip.ts']) {
    watchDir(join(root, file), () =>
      console.warn(`\n${file} changed: stop this watch (Ctrl+C) and run pnpm dev again to use it.\n`),
    );
  }
  console.log(`
Watching. Load ${dist} once (Load unpacked); after that the extension
and your localhost tabs reload by themselves on every change.

To let Claude Code use the MCP server from this repo (once, then restart Claude Code):

  claude mcp remove --scope user browser-review
  claude mcp add --scope user browser-review -- node ${cli}
`);
} else {
  await esbuild.build(options);
  if (release) {
    const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')) as { version: string };
    const outDir = join(root, '..', 'release');
    // One Chromium package serves Chrome, Brave and Edge alike.
    const out = join(outDir, `browser-review-${version}-${firefox ? 'firefox' : 'chrome'}.zip`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, zip(filesIn(dist)));
    console.log(`\nPackaged ${out}`);
  }
}

/**
 * Hot reload: a build id the dev build of the extension long-polls on
 * 127.0.0.1. When it changes, the extension reloads itself (src/dev-reload.ts).
 * It only tells the build id; nothing else is served.
 */
function devReloadServer(): { plugin: esbuild.Plugin } {
  const session = Date.now().toString(36);
  let builds = 0;
  let id = `${session}-0`;
  const waiting = new Set<ServerResponse>();
  const send = (res: ServerResponse) => {
    // Firefox fetches without host permission (it is optional there), so allow it.
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(id);
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/build') {
      res.writeHead(404).end();
      return;
    }
    // Answer at once when the caller is behind; otherwise wait for the next build.
    if (url.searchParams.get('since') !== id) return send(res);
    waiting.add(res);
    const timer = setTimeout(() => {
      waiting.delete(res);
      send(res);
    }, 20_000);
    res.on('close', () => {
      clearTimeout(timer);
      waiting.delete(res);
    });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Hot reload is off: port ${DEV_RELOAD_PORT} is in use (another watch running?). Builds still run.`
        : `Hot reload server: ${err.message}`,
    );
  });
  server.listen(DEV_RELOAD_PORT, '127.0.0.1');
  return {
    plugin: {
      name: 'dev-reload',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return; // keep the last good build running
          id = `${session}-${++builds}`;
          for (const res of waiting) send(res);
          waiting.clear();
        });
      },
    },
  };
}

/**
 * Firefox runs MV3 backgrounds as event pages (background.scripts), not service
 * workers, has a sidebar instead of the side panel, and needs an add-on ID and a
 * data collection statement for signing.
 */
function firefoxManifest(m: Record<string, unknown>): Record<string, unknown> {
  const { minimum_chrome_version: _min, background: _bg, side_panel: panel, permissions, ...rest } = m;
  return {
    ...rest,
    background: { scripts: ['background.js'] },
    // Firefox has a sidebar instead of Chrome's side panel, and no permission for it.
    permissions: (permissions as string[]).filter((p) => p !== 'sidePanel'),
    sidebar_action: {
      default_panel: (panel as { default_path: string }).default_path,
      default_title: 'Browser Review',
      default_icon: { 16: 'icons/16.png', 48: 'icons/48.png' },
      open_at_install: false,
    },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        // 128: content scripts in the page's MAIN world. 140: data_collection_permissions.
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
      // Firefox for Android only knows data_collection_permissions from 142 on.
      gecko_android: { strict_min_version: '142.0' },
    },
  };
}

// ---------- icon: a speech bubble with a check, drawn pixel by pixel ----------

function icon(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  const s = size / 16;
  const inRoundRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const distToSegment = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / s;
      const v = (y + 0.5) / s;
      const bubble = inRoundRect(u, v, 1, 1, 15, 12, 3);
      const tail = v >= 11 && v <= 15 && u >= 3 && u <= 7 && u - 3 <= 15 - v;
      const check =
        Math.min(distToSegment(u, v, 4.5, 6.5, 7, 9), distToSegment(u, v, 7, 9, 11.5, 4)) <= 1.1;
      const i = (y * size + x) * 4;
      if (bubble && check) px.set([255, 255, 255, 255], i);
      else if (bubble || tail) px.set([91, 76, 219, 255], i);
    }
  }
  return encodePng(size, size, px);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
