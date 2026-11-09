import type { Rect } from './index.ts';

/**
 * Pixel box around rect (CSS px) in an image drawn at scale, padded by pad CSS px
 * and clamped to the image. Null below 2x2 px. Keeps the extension's rounding.
 */
export function cropBox(rect: Rect, image: { width: number; height: number }, scale: number, pad = 12): Rect | null {
  const x0 = Math.max(0, Math.floor((rect.x - pad) * scale));
  const y0 = Math.max(0, Math.floor((rect.y - pad) * scale));
  const x1 = Math.min(image.width, Math.ceil((rect.x + rect.width + pad) * scale));
  const y1 = Math.min(image.height, Math.ceil((rect.y + rect.height + pad) * scale));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
