// The developer's review settings for this project (review.json): the focus pages
// customers are asked to look at, and whether customers see each other's feedback.
import { join } from 'node:path';
import { DEFAULT_REVIEW_SETTINGS, pageKey, type FocusPage, type ReviewSettings } from '@brm/shared';
import { readJson, writeFileAtomic } from './files.ts';
import { InputError } from './validate.ts';

const MAX_FOCUS = 100;

export class Settings {
  readonly #file: string;
  #value: ReviewSettings = DEFAULT_REVIEW_SETTINGS;
  /** Called after the settings changed (site-map.md shows the focus pages). */
  onChange: (() => void) | null = null;

  private constructor(dir: string) {
    this.#file = join(dir, 'review.json');
  }

  static async open(dir: string): Promise<Settings> {
    const s = new Settings(dir);
    s.#value = { ...DEFAULT_REVIEW_SETTINGS, ...(await readJson<Partial<ReviewSettings>>(s.#file, {})) };
    return s;
  }

  get(): ReviewSettings {
    return this.#value;
  }

  /** Whether this customer sees everyone's feedback, or only their own. */
  shares(name: string): boolean {
    return this.#value.shareFor[name] ?? this.#value.share;
  }

  async set(input: unknown): Promise<ReviewSettings> {
    const value = parseSettings(input);
    await writeFileAtomic(this.#file, `${JSON.stringify(value, null, 2)}\n`);
    this.#value = value;
    this.onChange?.();
    return value;
  }
}

/** Checks every field; paths become pageKey paths ("/pricing"). */
export function parseSettings(input: unknown): ReviewSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Send { focusPages, share, shareFor }.');
  const o = input as Record<string, unknown>;
  const pages = o.focusPages ?? [];
  if (!Array.isArray(pages) || pages.length > MAX_FOCUS) throw new InputError(`focusPages is a list of at most ${MAX_FOCUS}.`);
  const focusPages: FocusPage[] = [];
  for (const [i, p] of pages.entries()) {
    const page = p as { path?: unknown; note?: unknown };
    if (typeof page?.path !== 'string' || !page.path.trim()) throw new InputError(`focusPages[${i}].path is a page path like /pricing.`);
    let path: string;
    try {
      path = pageKey(new URL(page.path.trim(), 'http://x.invalid').href).path;
    } catch {
      throw new InputError(`focusPages[${i}].path is not a path.`);
    }
    const note = typeof page.note === 'string' ? page.note.trim().slice(0, 300) : '';
    if (!focusPages.some((f) => f.path === path)) focusPages.push({ path, note });
  }
  if (o.share !== undefined && typeof o.share !== 'boolean') throw new InputError('share is true or false.');
  const shareFor: Record<string, boolean> = {};
  if (o.shareFor !== undefined) {
    if (!o.shareFor || typeof o.shareFor !== 'object' || Array.isArray(o.shareFor)) throw new InputError('shareFor maps customer names to true or false.');
    for (const [name, v] of Object.entries(o.shareFor as Record<string, unknown>)) {
      if (typeof v !== 'boolean' || name.length > 64) throw new InputError('shareFor maps customer names to true or false.');
      shareFor[name] = v;
    }
  }
  return { focusPages, share: o.share === true, shareFor };
}
