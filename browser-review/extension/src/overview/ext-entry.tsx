// overview.html in the extension: the developer's feedback overview for one site
// (their own comments and visits) or one review-hub project (customers').
import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { DEFAULT_REVIEW_SETTINGS, activeSession, pageKey, type Comment, type PageVisit, type ProjectSummary, type ReviewSettings } from '@brm/shared';
import type { HubReviewer } from '../hub-client.ts';
import type { ContentRequest, ScreenshotDataResponse, StoreOps, StoreResponse } from '../messages.ts';
import { sessionKey } from '../sync.ts';
import css from './overview.css';
import { Overview, type OverviewData, type Source } from './Overview.tsx';

async function op<K extends keyof StoreOps>(name: K, args: StoreOps[K]['args']): Promise<StoreOps[K]['result']> {
  const res = (await chrome.runtime.sendMessage({ type: 'store', op: name, args } satisfies ContentRequest)) as StoreResponse<StoreOps[K]['result']>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** The pages you opened on this site in this browser session. */
async function readSession(origin: string): Promise<{ paths: string[]; current: string | null }> {
  if (!chrome.storage.session || !origin) return { paths: [], current: null };
  const key = sessionKey(origin);
  const s = activeSession((await chrome.storage.session.get(key))[key]);
  return { paths: s?.paths ?? [], current: s?.current ?? null };
}

/** A visit or a pull elsewhere: update now. */
const subscribe = (changed: () => void) => {
  const on = (_: unknown, area: string) => (area === 'session' || area === 'local') && changed();
  chrome.storage.onChanged.addListener(on);
  return () => chrome.storage.onChanged.removeListener(on);
};

async function screenshot(id: number): Promise<string | null> {
  const res = (await chrome.runtime.sendMessage({ type: 'screenshot-data', id } satisfies ContentRequest)) as ScreenshotDataResponse;
  return res.ok ? res.dataUrl : null;
}

/** "project:<id>" or "site:<origin>". */
function initialSource(): string {
  const q = new URLSearchParams(location.search);
  const project = q.get('project');
  if (project) return `project:${project}`;
  const origin = q.get('origin');
  return origin ? `site:${origin}` : '';
}

function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [source, setSource] = useState(initialSource);

  useEffect(() => {
    void (async () => {
      const [all, visits, list] = await Promise.all([op('list', { origin: '' }), op('visits', {}), op('projects', {})]);
      const origins = new Set<string>([...all.filter((c) => !c.project).map((c) => c.origin), ...visits.map((v) => v.origin)]);
      const found: Source[] = [
        ...list.map((p) => ({ key: `project:${p.id}`, label: `${p.name}: customer feedback` })),
        ...[...origins].sort().map((o) => ({ key: `site:${o}`, label: `${new URL(o).host}: your own comments` })),
      ];
      setProjects(list);
      setSources(found);
      setSource((s) => s || found[0]?.key || '');
    })();
  }, []);

  const select = (key: string) => {
    setSource(key);
    const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    history.replaceState(null, '', `?${kind === 'project' ? 'project' : 'origin'}=${encodeURIComponent(value)}`);
  };

  const load = useCallback(async (): Promise<OverviewData> => {
    const kind = source.slice(0, source.indexOf(':'));
    const value = source.slice(source.indexOf(':') + 1);
    if (kind === 'project') {
      const p = projects.find((x) => x.id === value) ?? (await op('projects', {})).find((x) => x.id === value);
      if (!p) throw new Error('This project is not in the extension anymore.');
      const [comments, visits] = await Promise.all([op('list', { origin: p.origin }), op('visits', { project: p.id })]);
      return {
        title: p.name,
        subtitle: `Customer feedback on ${p.origin}${p.lastPull ? `, pulled ${new Date(p.lastPull).toLocaleString()}` : ''}`,
        comments: comments.filter((c: Comment) => c.project === p.id),
        visits,
        me: p.you,
        origin: p.origin,
      };
    }
    if (kind === 'site') {
      const [comments, visits] = await Promise.all([op('list', { origin: value }), op('visits', { origin: value })]);
      return {
        title: new URL(value).host,
        subtitle: `Your own comments on ${value}`,
        comments: comments.filter((c: Comment) => !c.project),
        visits: visits as PageVisit[],
        me: null,
        origin: value,
      };
    }
    return { title: 'nothing yet', subtitle: 'Open your app with the toolbar on, or add a project on the help page.', comments: [], visits: [], me: null, origin: location.origin };
  }, [source, projects]);

  const project = source.startsWith('project:') ? source.slice('project:'.length) : null;
  const origin = project ? (projects.find((x) => x.id === project)?.origin ?? '') : source.startsWith('site:') ? source.slice('site:'.length) : '';
  const loadSession = useCallback(() => readSession(origin), [origin]);
  const review = useReviewSettings(project);

  return (
    <Overview
      load={load}
      screenshot={screenshot}
      sources={sources}
      source={source}
      onSource={select}
      live={10_000}
      subscribe={subscribe}
      loadSession={loadSession}
      panel={project ? <ReviewPanel {...review} /> : undefined}
      focusPages={project ? (review.settings?.focusPages ?? []) : undefined}
      onToggleFocus={project && review.settings ? review.toggleFocus : undefined}
    />
  );
}

type ReviewState = ReturnType<typeof useReviewSettings>;

/** A project's focus pages and sharing, read from and saved to its hub. */
function useReviewSettings(project: string | null) {
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [reviewers, setReviewers] = useState<HubReviewer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setSettings(null);
    setError(null);
    if (!project) return;
    op('reviewSettings', { project })
      .then((r) => {
        setSettings({ ...DEFAULT_REVIEW_SETTINGS, ...r.settings });
        setReviewers(r.reviewers);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(/not found/i.test(msg) ? 'This review hub is too old for focus pages and sharing: update its image.' : msg);
      });
  }, [project]);

  const save = async (next: ReviewSettings) => {
    if (!project) return;
    const before = settings;
    setSettings(next);
    try {
      setSettings(await op('saveReviewSettings', { project, settings: next }));
      setError(null);
      setSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      setSettings(before);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleFocus = (path: string) => {
    if (!settings) return;
    const has = settings.focusPages.some((f) => f.path === path);
    void save({ ...settings, focusPages: has ? settings.focusPages.filter((f) => f.path !== path) : [...settings.focusPages, { path, note: '' }] });
  };

  return { settings, reviewers, error, saved, save, toggleFocus };
}

function ReviewPanel({ settings, reviewers, error, saved, save }: ReviewState) {
  const [path, setPath] = useState('');
  const [note, setNote] = useState('');
  if (!settings) {
    return <section class="ov-settings">{error ? <p class="ov-error">{error}</p> : <p class="ov-dim">Loading the review settings…</p>}</section>;
  }
  const add = (e: Event) => {
    e.preventDefault();
    const raw = path.trim();
    if (!raw) return;
    let p: string;
    try {
      p = pageKey(new URL(raw, 'http://x.invalid').href).path;
    } catch {
      return;
    }
    const rest = settings.focusPages.filter((f) => f.path !== p);
    void save({ ...settings, focusPages: [...rest, { path: p, note: note.trim() }] });
    setPath('');
    setNote('');
  };
  const people = [...new Set([...reviewers.map((r) => r.name), ...Object.keys(settings.shareFor)])].sort();
  return (
    <section class="ov-settings" aria-label="Review settings">
      <h2>
        Review settings
        {saved && <span class="ov-saved">Saved {saved}</span>}
      </h2>
      {error && <p class="ov-error">{error}</p>}
      <div class="ov-settings-grid">
        <div>
          <h3>Focus pages</h3>
          <p class="ov-dim">Customers see these in their welcome and their overview. Or click ★ on a page in the map.</p>
          {settings.focusPages.length > 0 && (
            <ul class="ov-focus-list">
              {settings.focusPages.map((f) => (
                <li key={f.path}>
                  <code>{f.path}</code>
                  <span class="ov-dim">{f.note}</span>
                  <button
                    class="ov-x"
                    title={`Remove ${f.path}`}
                    onClick={() => void save({ ...settings, focusPages: settings.focusPages.filter((x) => x.path !== f.path) })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form class="ov-focus-add" onSubmit={add}>
            <input value={path} onInput={(e) => setPath((e.target as HTMLInputElement).value)} placeholder="/pricing" aria-label="Page path" />
            <input value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} placeholder="Note, like: check the prices" aria-label="Note" maxLength={300} />
            <button class="ov-btn" type="submit">
              Add
            </button>
          </form>
        </div>
        <div>
          <h3>Who sees what</h3>
          <label class="ov-switch">
            <input type="checkbox" checked={settings.share} onChange={(e) => void save({ ...settings, share: (e.target as HTMLInputElement).checked })} />
            <span>
              <strong>Customers see each other's feedback</strong>
              <br />
              <span class="ov-dim">Off: each customer sees only their own comments and visits. You always see everything.</span>
            </span>
          </label>
          {people.length > 0 && (
            <ul class="ov-people">
              {people.map((name) => {
                const v = settings.shareFor[name];
                return (
                  <li key={name}>
                    <span>{name}</span>
                    <select
                      aria-label={`What ${name} sees`}
                      value={v === undefined ? 'default' : v ? 'all' : 'own'}
                      onChange={(e) => {
                        const choice = (e.target as HTMLSelectElement).value;
                        const shareFor = { ...settings.shareFor };
                        if (choice === 'default') delete shareFor[name];
                        else shareFor[name] = choice === 'all';
                        void save({ ...settings, shareFor });
                      }}
                    >
                      <option value="default">As above ({settings.share ? 'everyone\'s' : 'own only'})</option>
                      <option value="all">Everyone's feedback</option>
                      <option value="own">Only their own</option>
                    </select>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
render(<App />, document.getElementById('root')!);
