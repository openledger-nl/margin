// The pages someone opened in this session: since they started browsing with the
// toolbar on, until a break of more than 30 minutes. Kept in the browser only
// (margin.js: localStorage; the extension: storage.session), never on the hub.

export interface BrowseSession {
  /** ISO time the session started. */
  start: string;
  /** ISO time of the last page opened. */
  last: string;
  /** Paths as pageKey(), in the order first opened. */
  paths: string[];
  /** The page open right now, or null after leaving the site (tab closed). */
  current: string | null;
}

export const SESSION_GAP_MS = 30 * 60_000;
const MAX_PATHS = 500;

/** Reads a stored session; null when missing, broken or over (a long break). */
export function activeSession(value: unknown, now = Date.now(), gap = SESSION_GAP_MS): BrowseSession | null {
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<BrowseSession>;
  if (typeof s.start !== 'string' || typeof s.last !== 'string' || !Array.isArray(s.paths)) return null;
  if (now - Date.parse(s.last) > gap) return null;
  return {
    start: s.start,
    last: s.last,
    paths: s.paths.filter((p): p is string => typeof p === 'string'),
    current: typeof s.current === 'string' ? s.current : null,
  };
}

/** The session after opening path: the same one, or a new one after a long break. */
export function touchSession(value: unknown, path: string, now = Date.now(), gap = SESSION_GAP_MS): BrowseSession {
  const at = new Date(now).toISOString();
  const s = activeSession(value, now, gap) ?? { start: at, last: at, paths: [], current: null };
  const paths = s.paths.includes(path) ? s.paths : [...s.paths, path].slice(-MAX_PATHS);
  return { start: s.start, last: at, paths, current: path };
}

/** The session after leaving the site (tab closed or gone elsewhere): no current page. */
export function leaveSession(value: unknown, now = Date.now()): BrowseSession | null {
  const s = activeSession(value, now);
  return s ? { ...s, current: null } : null;
}
