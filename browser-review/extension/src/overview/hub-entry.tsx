// overview.js on the review hub (/__margin/overview on the staging site): the
// customer's feedback overview. The review token comes from margin.js, in this
// site's localStorage; nothing else is needed.
import { render } from 'preact';
import type { Comment, PageVisit } from '@brm/shared';
import css from './overview.css';
import markCss from './mark.css';
import { Overview, type OverviewData } from './Overview.tsx';

const TOKEN_KEY = 'margin:review_token';
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

const load = async (): Promise<OverviewData> => {
  const [me, comments, visits] = await Promise.all([
    call<{ name: string; project: string }>('me'),
    call<Comment[]>('comments'),
    call<{ visits: PageVisit[] }>('visits'),
  ]);
  return { title: me.project, subtitle: `Feedback on ${location.origin}`, comments, visits: visits.visits, me: me.name };
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
render(<Overview load={load} screenshot={screenshot} />, root);
