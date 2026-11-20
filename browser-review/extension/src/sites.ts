// Which pages the overlay runs on. Two modes (a setting on the help page):
//   any (default)  local addresses and dev domains by themselves; any other site
//                  once you turn it on there with the extension icon
//   local (strict) only localhost, 127.0.0.1 and [::1]

export const SITE_ACCESS_KEY = 'siteAccess';
/** Sites turned on by hand, as origins ("https://staging.example.com"). */
export const SITES_KEY = 'enabledSites';

export type SiteAccess = 'any' | 'local';
export const SITE_ACCESS: Record<SiteAccess, string> = {
  any: 'Local addresses, dev domains, and sites you turn on',
  local: 'Strict: only localhost, 127.0.0.1 and [::1]',
};

export function toSiteAccess(value: unknown): SiteAccess {
  return value === 'local' ? 'local' : 'any';
}

export function toSites(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export interface SiteSettings {
  access: SiteAccess;
  sites: string[];
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
/** Domains that only exist on a developer's machine or network: Herd and Valet (.test), DDEV, Lando, mDNS. */
const DEV_SUFFIXES = ['.test', '.localhost', '.local', '.internal', '.ddev.site', '.lndo.site'];

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** An http or https page: the overlay can run there once allowed. */
export function isWebUrl(url: string): boolean {
  return parse(url) !== null;
}

/** localhost, 127.0.0.1 or [::1], any port, http or https. Strict mode allows only these. */
export function isLocalUrl(url: string): boolean {
  const u = parse(url);
  return u !== null && LOCAL_HOSTS.includes(u.hostname);
}

/** A local address or a dev domain (*.test, *.localhost, ...): on by default. */
export function isDevUrl(url: string): boolean {
  const u = parse(url);
  if (!u) return false;
  return LOCAL_HOSTS.includes(u.hostname) || DEV_SUFFIXES.some((s) => u.hostname.endsWith(s));
}

/** "https://staging.example.com:8080" for a page URL, or null for a non-web page. */
export function originOf(url: string): string | null {
  return parse(url)?.origin ?? null;
}

/** The overlay runs on this page. */
export function isAllowed(url: string, s: SiteSettings): boolean {
  if (s.access === 'local') return isLocalUrl(url);
  if (isDevUrl(url)) return true;
  const origin = originOf(url);
  return origin !== null && s.sites.includes(origin);
}

/** On a web page that is not allowed yet, the extension icon can turn the site on. */
export function canTurnOn(url: string, s: SiteSettings): boolean {
  return s.access === 'any' && isWebUrl(url) && !isAllowed(url, s);
}

/**
 * Match patterns for the content scripts and tabs.query. Match patterns have no
 * ports, so a site turned on at one port matches all ports of that host; the
 * overlay checks the exact origin itself (isAllowed).
 */
export function matchPatterns(s: SiteSettings): string[] {
  const local = ['localhost', '127.0.0.1'].map((h) => `*://${h}/*`);
  if (s.access === 'local') return local;
  const dev = DEV_SUFFIXES.map((suffix) => `*://*${suffix}/*`);
  const sites = s.sites.flatMap((o) => {
    const u = parse(o);
    return u ? [`${u.protocol}//${u.hostname}/*`] : [];
  });
  return [...new Set([...local, ...dev, ...sites])];
}
