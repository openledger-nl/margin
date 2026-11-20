// Screenshots in margin.js: no extension, so no captureVisibleTab. html-to-image
// redraws the page (the visible part) on a canvas; the element crop and the
// outline around it are drawn from that.
import { toCanvas } from 'html-to-image';
import { cropBox, type Rect, type ScreenshotUpload } from '@brm/shared';
import { HOST_TAG } from '../content/targets.ts';

/** Give up after this long: the comment goes without screenshots. */
const TIMEOUT_MS = 10_000;
/** The outline color of the extension's screenshots (.brm-capture-box). */
const OUTLINE = '#e0368a';
/** A 1x1 transparent PNG for images the browser won't let us read (other origins without CORS). */
const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function background(): string {
  for (const el of [document.body, document.documentElement]) {
    const c = getComputedStyle(el).backgroundColor;
    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c;
  }
  return '#ffffff';
}

/** The visible part of the page as a canvas, at 1 CSS px per pixel. */
async function viewport(): Promise<HTMLCanvasElement> {
  const body = document.body;
  const r = body.getBoundingClientRect();
  // Without the scrollbars: what the page itself fills.
  const width = document.documentElement.clientWidth || innerWidth;
  const height = document.documentElement.clientHeight || innerHeight;
  return toCanvas(body, {
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    pixelRatio: 1,
    backgroundColor: background(),
    imagePlaceholder: PLACEHOLDER,
    cacheBust: false,
    // Our own overlay never goes in the screenshot.
    filter: (node) => !(node instanceof Element && node.tagName.toLowerCase() === HOST_TAG),
    // Put the body where it is on screen: scrolled, and without its margin.
    style: {
      margin: '0',
      transform: `translate(${r.left}px, ${r.top}px)`,
      transformOrigin: 'top left',
      width: `${r.width}px`,
    },
  });
}

function toPng(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}

function crop(source: HTMLCanvasElement, box: Rect): string | null {
  const c = document.createElement('canvas');
  c.width = box.width;
  c.height = box.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return toPng(c);
}

function outline(canvas: HTMLCanvasElement, rect: Rect): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(rect.x - 1.5, rect.y - 1.5, rect.width + 3, rect.height + 3);
}

/** Page screenshot with the element outlined, plus a crop around the element. Undefined when it failed. */
export async function capturePage(rect: Rect | null): Promise<ScreenshotUpload | undefined> {
  try {
    const canvas = await Promise.race([
      viewport(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    // Outline first, so the crop shows it too, like the extension's screenshots.
    if (rect) outline(canvas, rect);
    const box = rect ? cropBox(rect, canvas, 1) : null;
    const element = box ? crop(canvas, box) : null;
    const page = toPng(canvas);
    return element ? { page, element } : { page };
  } catch {
    return undefined;
  }
}
