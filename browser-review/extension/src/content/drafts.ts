// Unsaved input that must survive a reload of the app (dev server restart, HMR
// full reload, manual F5). Kept in the tab's sessionStorage: it lives as long as
// the tab, is per tab, and can be read synchronously on startup.
import type { Kind, TargetInfo } from '@brm/shared';

const PREFIX = 'brm-draft:';

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) sessionStorage.removeItem(PREFIX + key);
    else sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: losing a draft is not worth breaking the overlay.
  }
}

/** The open comment / remove / edit popover. */
export interface ComposerDraft {
  path: string;
  /** The picked element, to find it again after the reload. Null for a page comment. */
  target: TargetInfo | null;
  kind: Kind;
  body: string;
  texts: string[];
  css: string;
}

export const composerDraft = {
  get: () => read<ComposerDraft>('composer'),
  set: (d: ComposerDraft | null) => write('composer', d),
};

/** Reply text per thread. */
export const replyDraft = {
  get: (id: number) => read<string>(`reply:${id}`) ?? '',
  set: (id: number, text: string) => write(`reply:${id}`, text ? text : null),
};
