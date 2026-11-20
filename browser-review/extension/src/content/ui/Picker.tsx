// Element picker, like the uBlock one: hover to highlight, wheel or arrow keys
// to go to the parent / back to the child, click to select, Esc to cancel.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { describe, isOurs, probeReact, textOf } from '../targets.ts';
import { useTrackedRect } from '../hooks.ts';
import { px } from '../px.ts';

interface Props {
  /** Started by holding this key (its label): releasing it stops. */
  releaseKey?: string | null;
  /** Mouse position when it starts: highlight what is there right away. */
  start?: { x: number; y: number } | null;
  onPick: (el: Element) => void;
  onCancel: () => void;
}

const CURSOR_STYLE_ID = 'browser-review-picker-cursor';

function hitAt(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find((e) => !isOurs(e) && e !== document.documentElement) ?? null;
}

function ancestry(el: Element): Element[] {
  const out: Element[] = [];
  for (let cur: Element | null = el; cur && cur !== document.documentElement; cur = cur.parentElement) out.push(cur);
  return out;
}

export function Picker({ releaseKey, start, onPick, onCancel }: Props) {
  const [chain, setChain] = useState<Element[]>(() => {
    const hit = start ? hitAt(start.x, start.y) : null;
    return hit ? ancestry(hit) : [];
  });
  const [depth, setDepth] = useState(0);
  const current = chain[Math.min(depth, chain.length - 1)] ?? null;
  const state = useRef({ chain, current, onPick, onCancel });
  state.current = { chain, current, onPick, onCancel };

  useEffect(() => {
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    style.textContent = '* { cursor: crosshair !important; }';
    (document.head ?? document.documentElement).appendChild(style);

    const fromUs = (e: Event) => isOurs(e.target instanceof Element ? e.target : null);
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const onMove = (e: MouseEvent) => {
      if (fromUs(e)) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (hit && hit !== state.current.chain[0]) {
        setChain(ancestry(hit));
        setDepth(0);
      }
    };
    const onPress = (e: Event) => {
      if (!fromUs(e)) block(e);
    };
    const onClick = (e: MouseEvent) => {
      if (fromUs(e)) return;
      block(e);
      const el = state.current.current ?? hitAt(e.clientX, e.clientY);
      if (el) state.current.onPick(el);
    };
    const onWheel = (e: WheelEvent) => {
      if (fromUs(e)) return;
      block(e);
      setDepth((d) => Math.max(0, Math.min(state.current.chain.length - 1, d + (e.deltaY < 0 ? 1 : -1))));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        block(e);
        state.current.onCancel();
      } else if (e.key === 'ArrowUp') {
        block(e);
        setDepth((d) => Math.min(state.current.chain.length - 1, d + 1));
      } else if (e.key === 'ArrowDown') {
        block(e);
        setDepth((d) => Math.max(0, d - 1));
      } else if (e.key === 'Enter' && state.current.current) {
        block(e);
        state.current.onPick(state.current.current);
      }
    };

    const opts = { capture: true };
    addEventListener('mousemove', onMove, opts);
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'] as const) {
      addEventListener(t, onPress, opts);
    }
    addEventListener('click', onClick, opts);
    addEventListener('wheel', onWheel, { capture: true, passive: false });
    addEventListener('keydown', onKey, opts);
    return () => {
      style.remove();
      removeEventListener('mousemove', onMove, opts);
      for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'] as const) {
        removeEventListener(t, onPress, opts);
      }
      removeEventListener('click', onClick, opts);
      removeEventListener('wheel', onWheel, { capture: true });
      removeEventListener('keydown', onKey, opts);
    };
  }, []);

  const resolve = useMemo(() => (current ? () => current : null), [current]);
  const rect = useTrackedRect(resolve);
  const label = useMemo(() => {
    if (!current) return '';
    const react = probeReact(current);
    const comp = react.components.at(-1);
    const base = describe(current.tagName.toLowerCase(), textOf(current, 40), current.getAttribute('class') ?? '');
    return comp ? `${comp}  ${base}` : base;
  }, [current]);

  return (
    <>
      <div class="brm-ui brm-picker-hint">
        Click an element. Scroll or arrow up/down for parent/child.{' '}
        {releaseKey ? `Release ${releaseKey} to stop.` : 'Esc to cancel.'}
      </div>
      {rect && (
        <>
          <div
            class="brm-highlight"
            style={px({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })}
          />
          <div
            class="brm-highlight-label"
            style={px({
              left: Math.max(4, rect.x),
              top: rect.y > 28 ? rect.y - 24 : Math.min(innerHeight - 24, rect.y + rect.height + 4),
            })}
          >
            {label} <span class="brm-dim">{Math.round(rect.width)}×{Math.round(rect.height)}</span>
          </div>
        </>
      )}
    </>
  );
}
