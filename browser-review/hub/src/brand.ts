// A company's own name, colors and logo on the customer side: brand.json and
// logo.svg or logo.png in the data folder. Re-read when the files change; a broken
// file is ignored (the Margin look stays) and reported by `margin brand check`.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeHex } from '@brm/shared';

export const MAX_LOGO_BYTES = 200 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface BrandFiles {
  name: string | null;
  color: string | null;
  toolbar: string | null;
  logo: { type: 'image/svg+xml' | 'image/png'; data: Buffer; version: string } | null;
  /** What is wrong with the files, for `margin brand check` and the log. */
  problems: string[];
}

const EMPTY: BrandFiles = { name: null, color: null, toolbar: null, logo: null, problems: [] };

async function version(path: string): Promise<string> {
  try {
    const s = await stat(path);
    return `${s.mtimeMs}:${s.ino}:${s.size}`;
  } catch {
    return 'none';
  }
}

export async function readBrand(dir: string): Promise<BrandFiles> {
  const problems: string[] = [];
  const out: BrandFiles = { ...EMPTY, problems };
  let raw: string | null = null;
  try {
    raw = await readFile(join(dir, 'brand.json'), 'utf8');
  } catch {
    // no brand.json: the Margin look
  }
  if (raw !== null) {
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
      else problems.push('brand.json must be an object, like { "name": "Acme", "color": "#e4572e" }.');
    } catch {
      problems.push('brand.json is not valid JSON.');
    }
    if (data.name !== undefined) {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (name && name.length <= 40 && !/[\u0000-\u001f<>]/.test(name)) out.name = name;
      else problems.push('name is 1 to 40 characters, without < or >.');
    }
    for (const key of ['color', 'toolbar'] as const) {
      if (data[key] === undefined) continue;
      const c = normalizeHex(data[key]);
      if (c) out[key] = c;
      else problems.push(`${key} must look like #e4572e (or #e52).`);
    }
    for (const key of Object.keys(data)) {
      if (!['name', 'color', 'toolbar'].includes(key)) problems.push(`Unknown field "${key}" in brand.json (name, color, toolbar).`);
    }
  }
  for (const [file, type] of [
    ['logo.svg', 'image/svg+xml'],
    ['logo.png', 'image/png'],
  ] as const) {
    let data: Buffer;
    try {
      data = await readFile(join(dir, file));
    } catch {
      continue;
    }
    if (out.logo) {
      problems.push(`Both logo.svg and logo.png: using ${out.logo.type === 'image/svg+xml' ? 'logo.svg' : 'logo.png'}.`);
      continue;
    }
    if (data.length > MAX_LOGO_BYTES) {
      problems.push(`${file} is ${Math.round(data.length / 1024)} KB, at most ${MAX_LOGO_BYTES / 1024} KB.`);
      continue;
    }
    if (type === 'image/png' && !PNG_MAGIC.every((b, i) => data[i] === b)) {
      problems.push('logo.png is not a PNG file.');
      continue;
    }
    if (type === 'image/svg+xml' && !/<svg[\s>]/i.test(data.subarray(0, 4096).toString('utf8'))) {
      problems.push('logo.svg does not look like an SVG file.');
      continue;
    }
    out.logo = { type, data, version: createHash('sha256').update(data).digest('hex').slice(0, 12) };
  }
  return out;
}

/** The brand, re-read when brand.json or a logo file changed. */
export class Brand {
  readonly #dir: string;
  #version = '';
  #files: BrandFiles = EMPTY;
  readonly #log: (msg: string) => void;

  constructor(dir: string, log: (msg: string) => void = () => {}) {
    this.#dir = dir;
    this.#log = log;
  }

  async get(): Promise<BrandFiles> {
    const v = (await Promise.all(['brand.json', 'logo.svg', 'logo.png'].map((f) => version(join(this.#dir, f))))).join('|');
    if (v !== this.#version) {
      this.#version = v;
      this.#files = await readBrand(this.#dir);
      for (const p of this.#files.problems) this.#log(`brand: ${p}`);
    }
    return this.#files;
  }

  /** What the overlay, the overview and the help page get: no file data. */
  async publicJson(): Promise<{ name: string | null; color: string | null; toolbar: string | null; logo: string | null }> {
    const b = await this.get();
    return { name: b.name, color: b.color, toolbar: b.toolbar, logo: b.logo ? `brand/logo?v=${b.logo.version}` : null };
  }
}
