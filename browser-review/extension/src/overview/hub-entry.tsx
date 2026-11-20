// overview.js on the review hub (/__margin/overview on the staging site): the
// customer's feedback overview. The review token comes from margin.js, in this
// site's localStorage; nothing else is needed.
import { render } from 'preact';
import { activeSession, brandTokens, type Brand, type Comment, type FocusPage, type PageVisit } from '@brm/shared';
import css from './overview.css';
import markCss from './mark.css';
import { Overview, type OverviewData } from './Overview.tsx';

const TOKEN_KEY = 'margin:review_token';
/** Written by margin.js on this site (embed/web-host.ts): this session's pages. */
const SESSION_KEY = 'margin:session';

function readSession(): { paths: string[]; current: string | null } {
  try {
    const s = activeSession(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'));
    return { paths: s?.paths ?? [], current: s?.current ?? null };
  } catch {
    return { paths: [], current: null };
  }
}
const loadSession = async () => readSession();
const api = new URL('api/review/', location.href);

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call<T>(path: string): Promise<T> {
  const t = token();
  if (!t) throw new Error('Open your review link first (the one you were sent); then this overview shows your feedback.');
  const res = await fetch(new URL(path, api), { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store', credentials: 'omit' });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? `The review server answered ${res.status}.`);
  return data as T;
}

/** The company's look (brand.json, public); null for the Margin look. */
async function loadBrand(): Promise<Brand | null> {
  try {
    const res = await fetch(new URL('brand.json', location.href), { cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) return null;
    const b = (await res.json()) as Brand;
    return { ...b, logo: b.logo ? new URL(b.logo, location.href).href : null };
  } catch {
    return null;
  }
}

let brand: Brand | null = null;
let applied = '';
function applyBrand(b: Brand | null): void {
  const key = JSON.stringify(b);
  if (key === applied) return;
  applied = key;
  const names: Record<string, string> = { accent: '--accent', 'accent-strong': '--accent-strong', 'accent-soft': '--accent-soft', 'on-accent': '--on-accent' };
  for (const v of Object.values(names)) document.documentElement.style.removeProperty(v);
  for (const [role, value] of Object.entries(brandTokens(b ?? { color: null, toolbar: null }))) {
    if (names[role]) document.documentElement.style.setProperty(names[role], value);
  }
  document.title = b?.name ? `Feedback overview · ${b.name}` : 'Feedback overview';
}

let loads = 0;
const load = async (): Promise<OverviewData> => {
  // The look rarely changes: check it now and then, not on every live update.
  if (loads++ % 12 === 0) {
    brand = await loadBrand();
    applyBrand(brand);
  }
  const [me, comments, visits] = await Promise.all([
    call<{ name: string; project: string; share?: boolean; focusPages?: FocusPage[] }>('me'),
    call<Comment[]>('comments'),
    call<{ visits: PageVisit[] }>('visits'),
  ]);
  return {
    title: me.project,
    subtitle: `Feedback on ${location.origin}`,
    comments,
    visits: visits.visits,
    me: me.name,
    focusPages: me.focusPages ?? [],
    share: me.share !== false,
    brand,
    origin: location.origin,
  };
};

/** The site tab writes a visit or the session: update now, not at the next tick. */
const subscribe = (changed: () => void) => {
  const on = (e: StorageEvent) => e.key === SESSION_KEY && changed();
  addEventListener('storage', on);
  return () => removeEventListener('storage', on);
};

/** Opened from the toolbar: open pages in that tab (the site), and bring it forward. */
const openPage = (url: string): boolean => {
  try {
    const site = window.opener as Window | null;
    if (!site || site.closed || site.location.origin !== location.origin) return false;
    site.location.href = url;
    site.focus();
    return true;
  } catch {
    return false;
  }
};

const screenshot = async (id: number): Promise<string | null> => {
  try {
    return (await call<{ dataUrl: string }>(`screenshots/${id}`)).dataUrl;
  } catch {
    return null;
  }
};

const style = document.createElement('style');
style.textContent = css + markCss;
document.head.append(style);
document.title = 'Feedback overview';
const root = document.getElementById('root')!;
root.replaceChildren(); // the page's "Loading…" text
render(<Overview load={load} screenshot={screenshot} live={4000} credit subscribe={subscribe} openPage={openPage} loadSession={loadSession} mineFirst />, root);
