// overview.html in the extension: the developer's feedback overview for one site
// (their own comments and visits) or one review-hub project (customers').
import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Comment, PageVisit, ProjectSummary } from '@brm/shared';
import type { ContentRequest, ScreenshotDataResponse, StoreOps, StoreResponse } from '../messages.ts';
import css from './overview.css';
import { Overview, type OverviewData, type Source } from './Overview.tsx';

async function op<K extends keyof StoreOps>(name: K, args: StoreOps[K]['args']): Promise<StoreOps[K]['result']> {
  const res = (await chrome.runtime.sendMessage({ type: 'store', op: name, args } satisfies ContentRequest)) as StoreResponse<StoreOps[K]['result']>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

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
      };
    }
    return { title: 'nothing yet', subtitle: 'Open your app with the toolbar on, or add a project on the help page.', comments: [], visits: [], me: null };
  }, [source, projects]);

  return <Overview load={load} screenshot={screenshot} sources={sources} source={source} onSource={select} />;
}

const style = document.createElement('style');
style.textContent = css;
document.head.append(style);
render(<App />, document.getElementById('root')!);
