// Runs in the page's own JavaScript world (not the isolated content-script
// world), because React's fiber lives on JS properties of DOM nodes that only
// the page can see. The content script asks by marking the element with
// data-brm-probe and firing "brm:probe"; we answer with a JSON string.

import { fromStack } from './react-source.ts';

interface Fiber {
  type: unknown;
  return: Fiber | null;
  _debugOwner?: Fiber | null;
  _debugStack?: { stack?: string } | null;
  _debugSource?: { fileName: string; lineNumber: number } | null;
}

interface ProbeResult {
  components: string[];
  source: string | null;
}

function nameOf(type: unknown): string | null {
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (type && typeof type === 'object') {
    const t = type as { displayName?: string; render?: unknown; type?: unknown };
    if (t.displayName) return t.displayName;
    if (t.render) return nameOf(t.render); // forwardRef
    if (t.type) return nameOf(t.type); // memo
  }
  return null;
}

function sourceOf(fiber: Fiber): string | null {
  // React 18 and older (with the dev Babel plugin).
  if (fiber._debugSource) return `${fiber._debugSource.fileName}:${fiber._debugSource.lineNumber}`;
  // React 19: the stack where the JSX element was created.
  return fromStack(fiber._debugStack?.stack);
}

function probe(el: Element): ProbeResult {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!key) return { components: [], source: null };
  const host = (el as unknown as Record<string, Fiber>)[key];
  if (!host) return { components: [], source: null };

  let source = sourceOf(host);
  for (let owner = host._debugOwner; !source && owner; owner = owner._debugOwner) source = sourceOf(owner);

  const names: string[] = [];
  for (let f = host.return; f && names.length < 12; f = f.return) {
    const n = nameOf(f.type);
    if (n && n !== names.at(-1)) names.push(n);
  }
  return { components: names.reverse(), source };
}

document.addEventListener('brm:probe', () => {
  const el = document.querySelector('[data-brm-probe]');
  let result: ProbeResult = { components: [], source: null };
  if (el) {
    try {
      result = probe(el);
    } catch {
      // Never break the page.
    }
  }
  document.dispatchEvent(new CustomEvent('brm:probe-result', { detail: JSON.stringify(result) }));
});
