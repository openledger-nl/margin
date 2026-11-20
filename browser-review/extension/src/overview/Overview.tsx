// The feedback overview: the site as a map of pages, who looked at what, and the
// feedback per page. One component, two pages: the extension's overview.html
// (developers) and the hub's /overview (customers). Export PDF prints it.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { buildSiteMap, KIND_LABELS, STATUSES, STATUS_LABELS, type Comment, type PageVisit, type SiteNode, type Status } from '@brm/shared';
import { Mark } from '../content/ui/Mark.tsx';

export interface OverviewData {
  /** "acme-shop" or "localhost:5173". */
  title: string;
  /** "Customer feedback on https://staging.acme.com". */
  subtitle: string;
  comments: Comment[];
  visits: PageVisit[];
  /** Whose comments are "You": the token name, or null when messages without a name are yours (the extension). */
  me: string | null;
}

export interface Source {
  key: string;
  label: string;
}

interface Props {
  load: () => Promise<OverviewData>;
  screenshot: (shotId: number) => Promise<string | null>;
  /** Other sites or projects to switch to (the extension). */
  sources?: Source[];
  source?: string;
  onSource?: (key: string) => void;
}

type StatusFilter = 'active' | Status | 'all';
const ACTIVE: Status[] = ['open', 'in_progress', 'review_ready'];

/** Who wrote a comment, as shown: its first message's name, or You. */
function author(c: Comment, me: string | null): string {
  const name = c.messages.find((m) => m.author === 'user')?.name;
  if (!name) return 'You';
  return name === me ? 'You' : name;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** The page with this comment opened in the toolbar's sidebar (the overlay reads margin_comment). */
export function commentLink(c: Comment): string {
  const u = new URL(c.url);
  u.searchParams.set('margin_comment', String(c.id));
  return u.href;
}

export function Overview({ load, screenshot, sources, source, onSource }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [printing, setPrinting] = useState(false);

  const refresh = () =>
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    setData(null);
    setPerson('');
    setOpen(new Set());
    void refresh();
  }, [load]);

  const people = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const c of data.comments) names.add(author(c, data.me));
    for (const v of data.visits) names.add(v.by === data.me ? 'You' : v.by);
    return [...names].sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : a.localeCompare(b)));
  }, [data]);

  const tree = useMemo(() => {
    if (!data) return null;
    const statuses = status === 'active' ? ACTIVE : status === 'all' ? [...STATUSES] : [status];
    const comments = data.comments.filter((c) => statuses.includes(c.status) && (!person || author(c, data.me) === person));
    const visits = data.visits.filter((v) => !person || (v.by === data.me ? 'You' : v.by) === person);
    return buildSiteMap(comments, visits);
  }, [data, person, status]);

  const exportPdf = () => {
    setPrinting(true);
    // Let every comment and screenshot render first.
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 1200);
  };

  if (error) {
    return (
      <main class="ov">
        <p class="ov-error">{error}</p>
      </main>
    );
  }
  if (!data || !tree) {
    return (
      <main class="ov">
        <p class="ov-dim">Loading the feedback overview…</p>
      </main>
    );
  }

  const nodes = flatten(tree);
  const visited = nodes.filter((n) => n.visited).length;
  const withFeedback = nodes.filter((n) => n.comments.length > 0).length;
  const counts = STATUSES.map((s) => [s, nodes.reduce((sum, n) => sum + n.counts[s], 0)] as const);
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <main class={`ov ${printing ? 'is-printing' : ''}`}>
      <header class="ov-head">
        <Mark />
        <div class="ov-title">
          <h1>Feedback overview: {data.title}</h1>
          <p class="ov-dim">{data.subtitle}</p>
        </div>
        <div class="ov-tools">
          {sources && sources.length > 1 && (
            <select aria-label="Site or project" value={source} onChange={(e) => onSource?.((e.target as HTMLSelectElement).value)}>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <button class="ov-btn" onClick={() => void refresh()}>
            Refresh
          </button>
          <button class="ov-btn ov-primary" onClick={exportPdf} title="Opens the print dialog: choose Save as PDF">
            Export PDF
          </button>
        </div>
      </header>

      <section class="ov-stats" aria-label="Summary">
        <span class="ov-stat">
          <strong>{visited}</strong> pages visited
        </span>
        <span class="ov-stat">
          <strong>{withFeedback}</strong> with feedback
        </span>
        {counts.map(([s, n]) => (
          <span key={s} class={`ov-stat st-${s}`}>
            <i class="ov-dot" />
            <strong>{n}</strong> {STATUS_LABELS[s].toLowerCase()}
          </span>
        ))}
      </section>

      <nav class="ov-filters">
        <label>
          Person{' '}
          <select value={person} onChange={(e) => setPerson((e.target as HTMLSelectElement).value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show{' '}
          <select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value as StatusFilter)}>
            <option value="all">All feedback</option>
            <option value="active">Not accepted yet</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <span class="ov-legend ov-dim">
          <span class="ov-tag">no feedback</span> visited, nothing said yet
        </span>
      </nav>

      <section class="ov-map" aria-label="Site map">
        {nodes.map((n) => (
          <PageRow
            key={n.path}
            node={n}
            depth={depth(n.path)}
            open={printing || open.has(n.path)}
            printing={printing}
            me={data.me}
            onToggle={() => toggle(n.path)}
            screenshot={screenshot}
          />
        ))}
        {nodes.length === 1 && !tree.visited && tree.comments.length === 0 && (
          <p class="ov-dim ov-empty">Nothing yet. Pages show here as soon as someone opens them with the toolbar on.</p>
        )}
      </section>
      <footer class="ov-foot ov-dim">Margin · {new Date().toLocaleString()}</footer>
    </main>
  );
}

function flatten(n: SiteNode): SiteNode[] {
  return [n, ...n.children.flatMap(flatten)];
}

function depth(path: string): number {
  return path === '/' ? 0 : path.split('/').length - 1;
}

function PageRow(p: {
  node: SiteNode;
  depth: number;
  open: boolean;
  printing: boolean;
  me: string | null;
  onToggle: () => void;
  screenshot: Props['screenshot'];
}) {
  const n = p.node;
  const people = [...new Set(n.visitors.map((v) => v.by))];
  const has = n.comments.length > 0;
  return (
    <div class={`ov-page ${n.visited ? '' : 'is-unvisited'} ${p.open && has ? 'is-open' : ''}`} style={{ '--ov-depth': p.depth }}>
      <button class="ov-row" onClick={p.onToggle} disabled={!has} aria-expanded={has ? p.open : undefined}>
        <span class="ov-caret">{has ? (p.open ? '▾' : '▸') : ''}</span>
        <code class="ov-path">{n.path === '/' ? '/' : `/${n.segment}`}</code>
        <span class="ov-page-title">{n.title ?? ''}</span>
        <span class="ov-counts">
          {STATUSES.filter((s) => n.counts[s]).map((s) => (
            <span key={s} class={`ov-count st-${s}`} title={STATUS_LABELS[s]}>
              {n.counts[s]}
            </span>
          ))}
          {n.visited && !has && <span class="ov-tag">no feedback</span>}
          {!n.visited && !has && <span class="ov-dim">not visited</span>}
        </span>
        <span class="ov-visitors ov-dim">
          {people.length > 0 && `${people.join(', ')} · ${when(n.visitors[0]!.lastAt)}`}
        </span>
      </button>
      {has && (
        <div class={`ov-comments ${p.open ? '' : 'is-folded'}`}>
          {n.comments.map((c) => (
            <CommentCard key={c.id} c={c} me={p.me} full={p.printing} screenshot={p.screenshot} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentCard({ c, me, full, screenshot }: { c: Comment; me: string | null; full: boolean; screenshot: Props['screenshot'] }) {
  const [expanded, setExpanded] = useState(false);
  const show = full || expanded;
  const first = c.messages.find((m) => m.author === 'user');
  const shot = c.screenshots.find((s) => s.kind === 'element' && s.source === 'initial') ?? c.screenshots.find((s) => s.source === 'initial');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!show || !shot || src) return;
    let live = true;
    void screenshot(shot.id).then((d) => live && setSrc(d));
    return () => {
      live = false;
    };
  }, [show, shot?.id]);
  return (
    <article class={`ov-card st-${c.status}`}>
      <button class="ov-card-head" onClick={() => setExpanded(!expanded)} aria-expanded={show}>
        <span class="ov-id">#{c.id}</span>
        <span class={`ov-badge st-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        {c.kind !== 'comment' && <span class="ov-badge ov-kind">{KIND_LABELS[c.kind]}</span>}
        <span class="ov-who">{author(c, me)}</span>
        <span class="ov-text">{first?.body ?? ''}</span>
        <span class="ov-dim ov-when">{when(c.updatedAt)}</span>
      </button>
      <div class={`ov-card-body ${show ? '' : 'is-folded'}`}>
        <p class="ov-dim">{c.target ? `On <${c.target.tag}> "${c.target.text.slice(0, 80)}"` : 'About the whole page'}</p>
        {src && <img class="ov-shot" src={src} alt={`Screenshot of comment #${c.id}`} />}
        <ul class="ov-thread">
          {c.messages
            .filter((m) => m.author !== 'system')
            .map((m) => (
              <li key={m.id} class={`by-${m.author}`}>
                <strong>{m.author === 'user' ? (m.name && m.name !== me ? m.name : 'You') : (m.name ?? 'Developer')}</strong>{' '}
                <span class="ov-dim">{when(m.createdAt)}</span>
                <div>{m.body}</div>
              </li>
            ))}
        </ul>
        {c.solution && (
          <div class="ov-solution">
            <strong>What was changed</strong>
            <div>{c.solution.note}</div>
          </div>
        )}
        <a class="ov-btn ov-open" href={commentLink(c)} target="_blank" rel="noopener">
          Open on the page
        </a>
      </div>
    </article>
  );
}
