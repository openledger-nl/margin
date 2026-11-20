import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rect } from '@brm/shared';
import { DEFAULT_SEND_KEY, SEND_KEY, toSendKey, type SendKey } from '../settings.ts';

function same(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Follows the on-screen rect of an element every frame (scroll, resize,
 * layout changes). Re-renders only when the rect actually changes.
 */
export function useTrackedRect(resolve: (() => Element | null) | null, tight = false): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const last = useRef<Rect | null>(null);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    if (!resolve) {
      last.current = null;
      setRect(null);
      return;
    }
    let raf = 0;
    let el: Element | null = null;
    const tick = () => {
      if (!el?.isConnected) el = resolveRef.current?.() ?? null;
      let next: Rect | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) next = { x: r.x, y: r.y, width: r.width, height: r.height };
        if (next && tight) {
          // Block elements are as wide as their container. Use where the content really ends.
          const range = document.createRange();
          range.selectNodeContents(el);
          const c = range.getBoundingClientRect();
          if (c.width > 0 && c.right < r.right) next.width = Math.max(16, c.right - r.x);
        }
      }
      if (!same(next, last.current)) {
        last.current = next;
        setRect(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [resolve, tight]);

  return rect;
}

/** The current page URL, also for SPA navigation (pushState can't be observed from here, so we poll). */
export function useHref(): string {
  const [href, setHref] = useState(location.href);
  useEffect(() => {
    const t = setInterval(() => {
      if (location.href !== href) setHref(location.href);
    }, 400);
    const onPop = () => setHref(location.href);
    addEventListener('popstate', onPop);
    return () => {
      clearInterval(t);
      removeEventListener('popstate', onPop);
    };
  }, [href]);
  return href;
}

/** The send key setting, live: a change on the help page applies at once. */
export function useSendKey(): SendKey {
  const [key, setKey] = useState<SendKey>(DEFAULT_SEND_KEY);
  useEffect(() => {
    void chrome.storage.local
      .get(SEND_KEY)
      .then((r) => setKey(toSendKey(r[SEND_KEY])))
      .catch(() => {});
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && SEND_KEY in changes) setKey(toSendKey(changes[SEND_KEY]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return key;
}
