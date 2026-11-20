// Markdown files with a YAML frontmatter block, read and written the way Ledger does (frontmatter.rs in Ledger):
//
//   ---
//   key: value
//   ---
//
//   The markdown body.
//
// Reading is lenient (a number where text was expected reads as text). Writing keeps every key it doesn't know,
// in place and with its comments, because the frontmatter is held as a YAML document rather than a plain object.
import { Document, isMap, isScalar, parseDocument, Scalar, type ToStringOptions, type YAMLMap } from 'yaml';

/** A body the way it reads back from a file: no blank lines around it. */
export function normalizeBody(body: string): string {
  return body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}

const TO_STRING: ToStringOptions = {
  lineWidth: 0, // never fold long lines
  blockQuote: 'literal', // multi-line text as `key: |`, never folded `>`
  indent: 2,
};

export class Frontmatter {
  private constructor(
    private readonly doc: Document,
    /** The markdown after the frontmatter, without surrounding blank lines. */
    public body: string,
  ) {}

  /** undefined when the text has no frontmatter block, or one that isn't a YAML mapping. */
  static parse(text: string): Frontmatter | undefined {
    const src = text.startsWith('﻿') ? text.slice(1) : text;
    const open = /^---\r?\n/.exec(src);
    if (!open) return undefined;
    const rest = src.slice(open[0].length);

    let offset = 0;
    for (const line of rest.split(/(?<=\n)/)) {
      if (line.replace(/\r?\n$/, '') === '---') {
        const doc: Document = parseDocument(rest.slice(0, offset), { prettyErrors: false, uniqueKeys: false });
        if (doc.errors.length > 0) return undefined;
        if (doc.contents === null) doc.contents = doc.createNode({});
        if (!isMap(doc.contents)) return undefined;
        const body = rest.slice(offset + line.length).replace(/^\r?\n/, '').trimEnd();
        return new Frontmatter(doc, body);
      }
      offset += line.length;
    }
    return undefined;
  }

  /** A new file; keys keep the order given, undefined values are left out. */
  static create(entries: Record<string, unknown>, body = ''): Frontmatter {
    const doc = new Document({});
    const fm = new Frontmatter(doc, body);
    for (const [key, value] of Object.entries(entries)) fm.set(key, value);
    return fm;
  }

  private get map(): YAMLMap {
    return this.doc.contents as YAMLMap;
  }

  has(key: string): boolean {
    return this.doc.has(key);
  }

  get(key: string): unknown {
    return this.doc.get(key);
  }

  /** A scalar as text; empty text counts as absent. */
  text(key: string): string | undefined {
    const value = this.doc.get(key);
    if (typeof value === 'string') return value === '' ? undefined : value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
    return undefined;
  }

  /** A scalar as an integer: a number, or text holding one. */
  int(key: string): number | undefined {
    const value = this.doc.get(key);
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(n) ? n : undefined;
  }

  flag(key: string): boolean | undefined {
    const value = this.doc.get(key);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return undefined;
  }

  /**
   * Sets a key, or removes it when `value` is undefined. A key that isn't there yet goes after the last key that
   * comes before it in `order`, so files keep the order of the format spec; keys nobody knows stay where they are.
   */
  set(key: string, value: unknown, order: readonly string[] = []): void {
    if (value === undefined) {
      this.doc.delete(key);
      return;
    }
    if (this.doc.has(key)) {
      this.doc.set(key, value);
      return;
    }
    const pair = this.doc.createPair(key, value);
    const rank = order.indexOf(key);
    let at = this.map.items.length;
    if (rank !== -1) {
      const before = new Set(order.slice(0, rank));
      const after = new Set(order.slice(rank + 1));
      // Just after the last key that belongs before this one; failing that, before the first that belongs after.
      let lastBefore = -1;
      let firstAfter = -1;
      this.map.items.forEach((item, i) => {
        const name = isScalar(item.key) ? String(item.key.value) : String(item.key);
        if (before.has(name)) lastBefore = i;
        if (after.has(name) && firstAfter === -1) firstAfter = i;
      });
      if (lastBefore !== -1) at = lastBefore + 1;
      else if (firstAfter !== -1) at = firstAfter;
    }
    this.map.items.splice(at, 0, pair);
  }

  keys(): string[] {
    return this.map.items.map((item) => (isScalar(item.key) ? String(item.key.value) : String(item.key)));
  }

  /** The canonical text: the frontmatter, one blank line, the body, a final newline. */
  toString(): string {
    let yaml = this.doc.toString(TO_STRING);
    // A block scalar can't hold every string (lines of only spaces, say). Where reading it back gives something
    // else, write that value double-quoted instead, which can.
    const reread = parseDocument(yaml);
    let changed = false;
    for (const item of this.map.items) {
      if (!isScalar(item.value) || typeof item.value.value !== 'string') continue;
      const key = isScalar(item.key) ? item.key.value : item.key;
      if (reread.get(key) !== item.value.value) {
        (item.value as Scalar).type = Scalar.QUOTE_DOUBLE;
        changed = true;
      }
    }
    if (changed) yaml = this.doc.toString(TO_STRING);

    let out = '---\n' + yaml;
    if (!out.endsWith('\n')) out += '\n';
    out += '---\n';
    // Leading blank lines would read back as a different body; leading spaces (an indented first line) would not.
    const body = this.body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
    if (body !== '') out += '\n' + body + '\n';
    return out;
  }
}
