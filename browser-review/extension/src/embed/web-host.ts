// The Host in margin.js on a staging site: the margin review hub owns the data,
// settings are in localStorage, and there is no background or side panel.
import { leaveSession, pageKey, touchSession, type Brand, type Comment, type CreateCommentInput, type FocusPage, type Rect, type ScreenshotUpload } from '@brm/shared';

/** This session's pages, read by the hub's overview on the same origin. */
export const SESSION_KEY = 'margin:session';
import type { PortEvent, TabRequest } from '../messages.ts';
import type { Host } from '../content/host.ts';

/** How often the overlay asks the hub for changes (customer replies, developer statuses). */
export const POLL_MS = 5000;
const SETTINGS_PREFIX = 'margin:';

export class Unauthorized extends Error {}

export interface WebHostOptions {
  /** The hub, ending in a slash: https://staging.acme.com/__margin/ */
  hubUrl: string;
  token: string;
  capture: (rect: Rect | null) => Promise<ScreenshotUpload | undefined>;
  /** The token was revoked or expired: the hub answered 401. */
  onUnauthorized: (message: string) => void;
  fetch?: typeof fetch;
  storage?: Storage | null;
}

export interface WebHost extends Host {
  /** Asks the hub who we are. */
  start(): Promise<'ok' | 'offline' | 'unauthorized'>;
  /** Shortcuts in the page, like the extension's commands (Alt+Shift+R/P/C/T). */
  readonly shortcuts: (e: KeyboardEvent) => TabRequest | null;
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked (private mode, sandboxed frame)
  }
}

export function createWebHost(opts: WebHostOptions): WebHost {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const api = new URL('api/review/', opts.hubUrl);
  let me: string | null = null;
  let welcome: string | null = null;
  let project: string | null = null;
  let brand: Brand | null = null;
  let focusPages: FocusPage[] = [];
  let share = false;
  /** Path -> last time sent, so a page is sent at most once a minute. */
  const visitSent = new Map<string, number>();
  let connected = false;
  const listeners = new Set<(ev: PortEvent) => void>();
  let unauthorized = false;

  const emit = (ev: PortEvent) => {
    for (const l of listeners) l(ev);
  };
  const setConnected = (value: boolean) => {
    if (value === connected) return;
    connected = value;
    emit({ type: 'status', connected });
  };

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (unauthorized) throw new Unauthorized('This review link no longer works.');
    let res: Response;
    try {
      res = await doFetch(new URL(path, api), {
        method,
        headers: {
          Authorization: `Bearer ${opts.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      setConnected(false);
      throw new Error("Can't reach the review server. Check your connection and try again.");
    }
    setConnected(true);
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401) {
      unauthorized = true;
      const message = data?.error ?? 'This review link no longer works.';
      opts.onUnauthorized(message);
      throw new Unauthorized(message);
    }
    if (!res.ok) throw new Error(data?.error ?? `The review server answered ${res.status}.`);
    return data as T;
  }

  // One list request at a time; polling and the overlay share it.
  let listing: Promise<Comment[]> | null = null;
  let lastSignature = '';
  const fetchList = (): Promise<Comment[]> => {
    listing ??= call<Comment[]>('GET', 'comments').finally(() => {
      listing = null;
    });
    return listing;
  };
  const signature = (list: Comment[]) => list.map((c) => `${c.id}:${c.updatedAt}`).join(',');

  return {
    mode: 'review',
    get me() {
      return me;
    },
    get welcome() {
      return welcome;
    },
    get project() {
      return project;
    },
    get brand() {
      return brand;
    },
    get focusPages() {
      return focusPages;
    },
    get share() {
      return share;
    },

    async start() {
      // The look first: public, so the toolbar can wear it even when the token fails.
      try {
        const res = await doFetch(new URL('brand.json', opts.hubUrl), { credentials: 'omit', cache: 'no-cache' });
        if (res.ok) {
          const b = (await res.json()) as Brand;
          brand = { ...b, logo: b.logo ? new URL(b.logo, opts.hubUrl).href : null };
        }
      } catch {
        // an older hub, or offline: the Margin look
      }
      try {
        const who = await call<{ name: string; project?: string; welcome?: string | null; share?: boolean; focusPages?: FocusPage[] }>('GET', 'me');
        me = who.name;
        welcome = who.welcome ?? null;
        project = who.project ?? null;
        share = who.share === true;
        focusPages = who.focusPages ?? [];
        return 'ok';
      } catch (err) {
        return err instanceof Unauthorized ? 'unauthorized' : 'offline';
      }
    },

    comments: {
      async list() {
        const list = await fetchList();
        lastSignature = signature(list);
        return list;
      },
      create: (input: CreateCommentInput) => call<Comment>('POST', 'comments', input),
      reply: (id, body) => call<Comment>('POST', `comments/${id}/reply`, { body }),
      accept: (id) => call<Comment>('POST', `comments/${id}/accept`, {}),
      reopen: (id, body) => call<Comment>('POST', `comments/${id}/reopen`, body === undefined ? {} : { body }),
      remove: async (id) => {
        await call('DELETE', `comments/${id}`);
      },
      async screenshot(shotId) {
        try {
          return (await call<{ dataUrl: string }>('GET', `screenshots/${shotId}`)).dataUrl;
        } catch {
          return null;
        }
      },
    },

    settings: {
      async get(key) {
        try {
          const raw = storage?.getItem(SETTINGS_PREFIX + key);
          return raw == null ? undefined : (JSON.parse(raw) as unknown);
        } catch {
          return undefined;
        }
      },
      set(key, value) {
        try {
          storage?.setItem(SETTINGS_PREFIX + key, JSON.stringify(value));
        } catch {
          // full or blocked: the setting lasts until the page reloads
        }
      },
      watch(key, onChange) {
        // Only fires for changes made in other tabs, which is what watch is for.
        const listener = (e: StorageEvent) => {
          if (e.key !== SETTINGS_PREFIX + key) return;
          try {
            onChange(e.newValue == null ? undefined : JSON.parse(e.newValue));
          } catch {
            // not ours
          }
        };
        addEventListener('storage', listener);
        return () => removeEventListener('storage', listener);
      },
    },

    panel: null,
    capture: opts.capture,

    subscribe(onEvent) {
      listeners.add(onEvent);
      onEvent({ type: 'status', connected });
      let timer = 0;
      const poll = async () => {
        if (!document.hidden && !unauthorized) {
          try {
            const list = await fetchList();
            const sig = signature(list);
            if (sig !== lastSignature) {
              lastSignature = sig;
              emit({ type: 'comments-changed', origin: location.origin });
            }
          } catch {
            // status already says we are offline
          }
        }
        if (listeners.has(onEvent)) timer = window.setTimeout(poll, POLL_MS);
      };
      timer = window.setTimeout(poll, POLL_MS);
      return () => {
        listeners.delete(onEvent);
        clearTimeout(timer);
      };
    },

    onRequest(handler) {
      const onKey = (e: KeyboardEvent) => {
        const req = shortcuts(e);
        if (!req) return;
        e.preventDefault();
        e.stopPropagation();
        handler(req);
      };
      addEventListener('keydown', onKey, { capture: true });
      return () => {
        removeEventListener('keydown', onKey, { capture: true });
      };
    },

    shortcuts,

    openHelp() {
      window.open(new URL('help', opts.hubUrl), '_blank', 'noopener');
    },

    // The hub's overview page, on this site's origin, reads the token from localStorage.
    // Not noopener: its page links open in this tab (it is our own page, same origin).
    openOverview() {
      window.open(new URL('overview', opts.hubUrl), '_blank');
    },

    // This session's pages and the one open now, for the overview: in this browser only.
    markPage(url) {
      updateSession((s) => touchSession(s, pageKey(url).path));
    },

    recordVisit(url, title) {
      const path = new URL(url).pathname;
      const last = visitSent.get(path) ?? 0;
      if (Date.now() - last < 60_000) return;
      visitSent.set(path, Date.now());
      void call('POST', 'visits', { url, title: title.slice(0, 300) }).catch(() => {});
    },

    alive: () => true,
  };
}

function updateSession(fn: (stored: unknown) => unknown): void {
  try {
    const next = fn(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'));
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: no session marks
  }
}

// Tab closed or off to another site: no "Here now" any more (the next page sets it again).
addEventListener('pagehide', () => updateSession((s) => leaveSession(s)));

/** Typing in a field: Option+C on a Mac is "ç", not a shortcut. */
function inField(e: KeyboardEvent): boolean {
  const el = e.composedPath()[0];
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** The extension's default shortcuts, handled in the page. Alt+C opens and closes the comments. */
function shortcuts(e: KeyboardEvent): TabRequest | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.repeat || inField(e)) return null;
  if (!e.shiftKey) return e.code === 'KeyC' ? { type: 'command', command: 'toggle-threads' } : null;
  switch (e.code) {
    case 'KeyR':
      return { type: 'toggle' };
    case 'KeyP':
      return { type: 'command', command: 'pick-element' };
    case 'KeyC':
      return { type: 'command', command: 'page-comment' };
    case 'KeyT':
      return { type: 'command', command: 'toggle-threads' };
    default:
      return null;
  }
}
