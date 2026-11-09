// Building selectors for an element, and finding it again later.
import type { Rect, TargetInfo } from '@brm/shared';

export const HOST_TAG = 'browser-review-overlay';

/** True for our own overlay host, which must never be picked or matched. */
export function isOurs(el: Element | null): boolean {
  return !!el && (el.tagName.toLowerCase() === HOST_TAG || !!el.closest(HOST_TAG));
}

function attrValue(v: string): string {
  return `"${v.replace(/["\\]/g, '\\$&')}"`;
}

function isUnique(sel: string): boolean {
  try {
    return document.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
}

/** Ids from useId, Radix, Headless UI and similar change between renders. */
function stableId(id: string): boolean {
  return !!id && !/^[:«]|^\d|^radix-|^headlessui-|^react-|[0-9a-f]{8,}|:r[0-9a-z]+:/i.test(id);
}

const TEST_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa'];

function step(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = [...parent.children].filter((c) => c.tagName === el.tagName);
  return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag;
}

/** A CSS path from the closest anchored ancestor (unique id or test id) down to the element. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  for (let cur: Element | null = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
    if (cur !== el) {
      const anchor = anchorOf(cur);
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
    }
    if (cur === document.body) {
      parts.unshift('body');
      break;
    }
    parts.unshift(step(cur));
  }
  return parts.join(' > ');
}

function anchorOf(el: Element): string | null {
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const sel = `[${a}=${attrValue(v)}]`;
      if (isUnique(sel)) return sel;
    }
  }
  if (stableId(el.id)) {
    const sel = `#${CSS.escape(el.id)}`;
    if (isUnique(sel)) return sel;
  }
  return null;
}

export function buildSelectors(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const out: string[] = [];
  const add = (sel: string) => {
    if (!out.includes(sel) && isUnique(sel)) out.push(sel);
  };
  const own = anchorOf(el);
  if (own) out.push(own);
  for (const a of ['aria-label', 'name', 'title', 'placeholder', 'alt']) {
    const v = el.getAttribute(a);
    if (v && v.length < 120) add(`${tag}[${a}=${attrValue(v)}]`);
  }
  // A test id that is not unique on its own may be unique under its parent path.
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v && el.parentElement) add(`${cssPath(el.parentElement)} > [${a}=${attrValue(v)}]`);
  }
  out.push(cssPath(el));
  return out;
}

export function textOf(el: Element, max = 300): string {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function htmlOf(el: Element, max = 1500): string {
  const html = el.outerHTML.replace(/\s?data-brm-[a-z-]+="[^"]*"/g, '');
  return html.length > max ? `${html.slice(0, max - 1)}…` : html;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Asks the main-world script for the React component chain and source file. */
export function probeReact(el: Element): { components: string[]; source: string | null } {
  let result = { components: [] as string[], source: null as string | null };
  const onResult = (e: Event) => {
    try {
      const detail = (e as CustomEvent<unknown>).detail;
      if (typeof detail === 'string') result = JSON.parse(detail) as typeof result;
    } catch {
      // keep the empty result
    }
  };
  document.addEventListener('brm:probe-result', onResult, { once: true });
  el.setAttribute('data-brm-probe', '');
  try {
    // Synchronous: the main-world listener runs during dispatchEvent and answers right away.
    document.dispatchEvent(new CustomEvent('brm:probe'));
  } finally {
    el.removeAttribute('data-brm-probe');
    document.removeEventListener('brm:probe-result', onResult);
  }
  return result;
}

export function buildTarget(el: Element): TargetInfo {
  const react = probeReact(el);
  return {
    selectors: buildSelectors(el),
    tag: el.tagName.toLowerCase(),
    text: textOf(el),
    html: htmlOf(el),
    rect: rectOf(el),
    components: react.components,
    source: react.source,
  };
}

/** Finds the element of a stored target. With several matches, the one with the same text wins. */
export function findTarget(target: TargetInfo): Element | null {
  // Even positional selector hits stay authoritative when text changes: an intentional
  // edit must not move a pin to another element that still has the old text.
  for (const sel of target.selectors) {
    let matches: Element[];
    try {
      matches = [...document.querySelectorAll(sel)].filter((m) => !isOurs(m));
    } catch {
      continue;
    }
    if (matches.length === 1) return matches[0] ?? null;
    if (matches.length > 1) return matches.find((m) => textOf(m) === target.text) ?? matches[0] ?? null;
  }
  if (!target.text) return null;
  let closest: Element | null = null;
  let closestDistance = Infinity;
  const x = target.rect.x + target.rect.width / 2;
  const y = target.rect.y + target.rect.height / 2;
  for (const el of document.getElementsByTagName(target.tag)) {
    if (isOurs(el) || textOf(el) !== target.text) continue;
    const rect = el.getBoundingClientRect();
    // Compare rectangle centers; equal distances keep document order.
    const distance = (rect.x + rect.width / 2 - x) ** 2 + (rect.y + rect.height / 2 - y) ** 2;
    if (distance < closestDistance) {
      closest = el;
      closestDistance = distance;
    }
  }
  return closest;
}

/** Short label like `button.save "Opslaan"` for the picker and sidebar. */
export function describe(tag: string, text: string, classes?: string): string {
  const cls = classes ? `.${classes.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}` : '';
  const t = text ? ` "${text.length > 30 ? `${text.slice(0, 29)}…` : text}"` : '';
  return `${tag}${cls}${t}`;
}
