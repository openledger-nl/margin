import type { Rect } from '@brm/shared';

/** PNG data URL of box from image; null if a 2D context is unavailable. */
export async function cropToPng(image: CanvasImageSource & { width: number; height: number }, box: Rect): Promise<string | null> {
  const canvas = new OffscreenCanvas(box.width, box.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return toDataUrl(new Uint8Array(await blob.arrayBuffer()));
}

function toDataUrl(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
