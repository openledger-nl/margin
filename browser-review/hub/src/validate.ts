// Checks request bodies from the network. The extension's store trusts its own
// content script; the hub trusts nobody, so every field is checked for type and size.
import { KINDS, type Change, type CreateCommentInput, type Kind, type Rect, type TargetInfo, type Viewport } from '@brm/shared';

export class InputError extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new InputError(`${what} must be an object.`);
  return v as Obj;
}

export function str(v: unknown, what: string, max: number, opts: { empty?: boolean } = {}): string {
  if (typeof v !== 'string') throw new InputError(`${what} must be text.`);
  if (v.length > max) throw new InputError(`${what} is too long (at most ${max} characters).`);
  if (!opts.empty && !v.trim()) throw new InputError(`${what} is empty.`);
  return v;
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError(`${what} must be a number.`);
  return v;
}

function strList(v: unknown, what: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(v) || v.length > maxItems) throw new InputError(`${what} must be a list of at most ${maxItems}.`);
  return v.map((s, i) => str(s, `${what}[${i}]`, maxLength));
}

function rect(v: unknown, what: string): Rect {
  const o = obj(v, what);
  return { x: num(o.x, `${what}.x`), y: num(o.y, `${what}.y`), width: num(o.width, `${what}.width`), height: num(o.height, `${what}.height`) };
}

function viewport(v: unknown): Viewport {
  const o = obj(v, 'viewport');
  return { width: num(o.width, 'viewport.width'), height: num(o.height, 'viewport.height'), dpr: num(o.dpr, 'viewport.dpr') };
}

function target(v: unknown): TargetInfo | null {
  if (v === null) return null;
  const o = obj(v, 'target');
  return {
    selectors: strList(o.selectors, 'target.selectors', 10, 2000),
    tag: str(o.tag, 'target.tag', 64),
    text: str(o.text, 'target.text', 1000, { empty: true }),
    html: str(o.html, 'target.html', 5000, { empty: true }),
    rect: rect(o.rect, 'target.rect'),
    components: strList(o.components, 'target.components', 50, 200),
    source: o.source === null ? null : str(o.source, 'target.source', 500),
  };
}

function change(v: unknown): Change | null {
  if (v === null) return null;
  const o = obj(v, 'change');
  if (o.kind === 'remove') return { kind: 'remove' };
  if (o.kind !== 'edit') throw new InputError('change.kind must be "remove" or "edit".');
  if (!Array.isArray(o.texts) || o.texts.length > 100) throw new InputError('change.texts must be a list of at most 100.');
  return {
    kind: 'edit',
    texts: o.texts.map((t, i) => {
      const e = obj(t, `change.texts[${i}]`);
      const index = num(e.index, `change.texts[${i}].index`);
      if (!Number.isInteger(index) || index < 0) throw new InputError(`change.texts[${i}].index must be a whole number.`);
      return {
        index,
        before: str(e.before, `change.texts[${i}].before`, 5000, { empty: true }),
        after: str(e.after, `change.texts[${i}].after`, 5000, { empty: true }),
      };
    }),
    css: str(o.css, 'change.css', 20000, { empty: true }),
  };
}

/** The body of POST /api/review/comments. Screenshots are checked as PNGs by the Store. */
export function parseCreateInput(body: unknown): CreateCommentInput {
  const o = obj(body, 'The request');
  if (!KINDS.includes(o.kind as Kind)) throw new InputError(`kind must be one of ${KINDS.join(', ')}.`);
  const input: CreateCommentInput = {
    kind: o.kind as Kind,
    url: str(o.url, 'url', 2048),
    title: str(o.title ?? '', 'title', 500, { empty: true }),
    viewport: viewport(o.viewport),
    target: target(o.target ?? null),
    change: change(o.change ?? null),
    body: str(o.body ?? '', 'body', 20000, { empty: true }),
  };
  if (o.screenshots !== undefined) {
    const s = obj(o.screenshots, 'screenshots');
    input.screenshots = {};
    // About 6 MB per image as base64; the request as a whole is capped at 15 MB.
    if (s.page !== undefined) input.screenshots.page = str(s.page, 'screenshots.page', 8_000_000);
    if (s.element !== undefined) input.screenshots.element = str(s.element, 'screenshots.element', 8_000_000);
  }
  return input;
}

export function parseObject(body: unknown): Obj {
  return obj(body ?? {}, 'The request');
}
