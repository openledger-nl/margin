// Screenshot mode: hide our own UI, draw an outline around the element, let
// the background take the screenshot, then restore.
import type { Rect } from '@brm/shared';
import { rectOf } from './targets.ts';

let shadow: ShadowRoot | null = null;

export function initCapture(root: ShadowRoot): void {
  shadow = root;
}

export function nextFrames(n = 2): Promise<void> {
  return new Promise((resolve) => {
    const tick = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
    tick(n);
  });
}

/** Enters capture mode and returns the element rect plus a function to leave it again. */
export async function enterCapture(el: Element | null): Promise<{ rect: Rect | null; exit: () => void }> {
  const root = shadow?.querySelector('.brm-root');
  root?.classList.add('brm-capturing');
  let box: HTMLDivElement | null = null;
  let rect: Rect | null = null;
  if (el && shadow) {
    rect = rectOf(el);
    if (rect.width > 0 && rect.height > 0) {
      box = document.createElement('div');
      box.className = 'brm-capture-box';
      Object.assign(box.style, {
        left: `${rect.x - 3}px`,
        top: `${rect.y - 3}px`,
        width: `${rect.width + 6}px`,
        height: `${rect.height + 6}px`,
      });
      shadow.appendChild(box);
    } else {
      rect = null;
    }
  }
  await nextFrames(2);
  return {
    rect,
    exit: () => {
      root?.classList.remove('brm-capturing');
      box?.remove();
    },
  };
}

export async function withCapture<T>(el: Element | null, fn: (rect: Rect | null) => Promise<T>): Promise<T> {
  const { rect, exit } = await enterCapture(el);
  try {
    return await fn(rect);
  } finally {
    exit();
  }
}
