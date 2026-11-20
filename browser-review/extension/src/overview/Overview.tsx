// The feedback overview: the site as a map of pages, who looked at what, and the
// feedback per page. One component, two pages: the extension's overview.html
// (developers) and the hub's /overview (customers). Export PDF prints it.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { buildSiteMap, KIND_LABELS, STATUSES, STATUS_LABELS, type Brand, type Comment, type FocusPage, type PageVisit, type SiteNode, type Status } from '@brm/shared';
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
  /** Pages the team asked reviewers to look at. */
  focusPages?: FocusPage[];
  /** Customers: false when they only see their own feedback. */
  share?: boolean;
  /** Customers: the company's look (brand.json). */
  brand?: Brand | null;
  /** The site, for links to its pages: "https://staging.acme.com". */
  origin: string;
  /** Paths the reader opened in this session (kept in their browser). */
  session?: string[];
}

export const MARGIN_REPO = 'https://github.com/openledger-nl/margin';
/** A visit this recent is where someone is now. */
const HERE_MS = 15 * 60_000;

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
  /** Reload every this many ms while the page is visible (a second screen follows along). */
  live?: number;
  /** "Powered by Margin" in the footer (the customer side). */
  credit?: boolean;
  /** Shown under the header: the developer's review settings for a project. */
  panel?: ComponentChildren;
  /** The developer marks or unmarks a focus page from the map. */
  onToggleFocus?: (path: string) => void;
  /** Focus pages from the page itself (the developer edits them), instead of from load(). */
  focusPages?: FocusPage[];
  /** Calls back when the data changed elsewhere (another tab), for an update right away. */
  subscribe?: (changed: () => void) => () => void;
  /** Opens a page of the site; without it, links open in one "site" tab. */
  openPage?: (url: string) => boolean;
  /** Customers: start with their own feedback, with a button for everyone else's. */
  mineFirst?: boolean;
  /** This browser's session (pages opened, the one open now): read right away on every change. */
  loadSession?: () => Promise<{ paths: string[]; current: string | null }>;
}

/** All page links open in this one tab, so a second screen does not pile up tabs. */
const SITE_TAB = 'margin-site';

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

export function Overview({ load, screenshot, sources, source, onSource, live = 0, credit = false, panel, onToggleFocus, focusPages, subscribe, openPage, loadSession, mineFirst = false }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState(mineFirst ? 'You' : '');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const [onlyFocus, setOnlyFocus] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);

  const refresh = () =>
    load()
      .then((d) => {
        setData(d);
        setError(null);
        setUpdated(new Date());
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  // Live: keep following while it is on screen (also on a second screen), not while printing.
  const printingRef = useRef(false);
  printingRef.current = printing;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !printingRef.current) void refresh();
    }, live);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, live]);

  // The session is local: "Here now" moves as soon as the site tab changes page, without waiting for the hub.
  const [sess, setSess] = useState<{ paths: string[]; current: string | null } | null>(null);
  const readSession = () => void loadSession?.().then(setSess, () => {});
  useEffect(readSession, [loadSession]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe?.(() => {
      readSession();
      // The rest (visits, comments) a moment later, once for a burst of changes.
      clearTimeout(t);
      t = setTimeout(() => void refresh(), 600);
    });
    return () => {
      clearTimeout(t);
      off?.();
    };
  }, [load, subscribe, loadSession]);
  const sessionPaths = sess?.paths ?? data?.session ?? [];

  useEffect(() => {
    setData(null);
    setPerson(mineFirst ? 'You' : '');
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
    return buildSiteMap(comments, visits, focusPages ?? data.focusPages ?? [], person && person !== 'You' ? [] : sessionPaths);
  }, [data, person, status, focusPages, sessionPaths.join('\n')]);

  /** The page the reader (or, in the extension, the developer) opened last, if just now. */
  const here = useMemo(() => {
    if (!data) return null;
    if (sess) return sess.current;
    const mine = data.visits.filter((v) => v.by === (data.me ?? 'You')).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
    return mine && Date.now() - Date.parse(mine.lastAt) < HERE_MS ? mine.path : null;
  }, [data, sess]);

  // Follow along: bring the page you just opened into view.
  useEffect(() => {
    if (live && here) document.querySelector(`[data-path="${CSS.escape(here)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [here, live]);

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

  const othersCount = data.comments.filter((c) => author(c, data.me) !== 'You').length;
  const all = flatten(tree);
  const focusNodes = all.filter((n) => n.focus !== null);
  const nodes = onlyFocus ? focusNodes : all;
  const session = new Set(sessionPaths);
  const seen = (n: SiteNode) => n.visited || session.has(n.path);
  const visited = nodes.filter(seen).length;
  const withFeedback = nodes.filter((n) => n.comments.length > 0).length;
  const seenNow = nodes.filter((n) => session.has(n.path)).length;
  const counts = STATUSES.map((s) => [s, nodes.reduce((sum, n) => sum + n.counts[s], 0)] as const);
  const logo = data.brand?.logo;
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <main class={`ov ${printing ? 'is-printing' : ''}`}>
      <header class="ov-head">
        {logo ? <img class="brm-mark ov-logo" src={logo} alt="" /> : <Mark />}
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
          {live ? (
            <span class="ov-live" title="This page updates by itself: keep it open on a second screen while you browse.">
              <i /> Live{updated ? ` · ${updated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            </span>
          ) : (
            <button class="ov-btn" onClick={() => void refresh()}>
              Refresh
            </button>
          )}
          <button class="ov-btn ov-primary" onClick={exportPdf} title="Opens the print dialog: choose Save as PDF">
            Export PDF
          </button>
        </div>
      </header>

      {panel}

      <section class="ov-stats" aria-label="Summary">
        {focusNodes.length > 0 && (
          <button
            class={`ov-stat ov-focus-stat ${onlyFocus ? 'is-active' : ''}`}
            onClick={() => setOnlyFocus((v) => !v)}
            aria-pressed={onlyFocus}
            title={onlyFocus ? 'Show every page' : 'Show only the focus pages'}
          >
            ★ <strong>{focusNodes.filter(seen).length}</strong> of {focusNodes.length} focus pages visited
          </button>
        )}
        <span class="ov-stat">
          <strong>{visited}</strong> pages visited
        </span>
        {seenNow > 0 && (
          <span class="ov-stat ov-session-stat" title="Pages you opened since you started browsing (until a break of 30 minutes)">
            ✓ <strong>{seenNow}</strong> this session
          </span>
        )}
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
        {mineFirst && othersCount > 0 && (
          <button class="ov-btn ov-whose" onClick={() => setPerson(person === 'You' ? '' : 'You')}>
            {person === 'You' ? `Show all other feedback (${othersCount})` : 'Only mine'}
          </button>
        )}
        <span class="ov-legend ov-dim">
          <span class="ov-tag">no feedback</span> visited, nothing said yet
        </span>
      </nav>

      {data.share === false && <p class="ov-dim ov-private">Only your own feedback and visits are shown here.</p>}

      <section class="ov-map" aria-label="Site map">
        {nodes.map((n) => (
          <PageRow
            key={n.path}
            node={n}
            here={n.path === here}
            seen={session.has(n.path)}
            href={new URL(n.path, data.origin).href}
            openPage={openPage}
            depth={onlyFocus ? 0 : depth(n.path)}
            open={printing || open.has(n.path)}
            printing={printing}
            me={data.me}
            onToggle={() => toggle(n.path)}
            onToggleFocus={onToggleFocus}
            screenshot={screenshot}
          />
        ))}
        {nodes.length === 1 && !tree.visited && tree.comments.length === 0 && (
          <p class="ov-dim ov-empty">Nothing yet. Pages show here as soon as someone opens them with the toolbar on.</p>
        )}
      </section>
      <footer class="ov-foot ov-dim">
        {credit ? (
          <>
            Powered by{' '}
            <a href={MARGIN_REPO} target="_blank" rel="noopener">
              Margin
            </a>
          </>
        ) : (
          'Margin'
        )}{' '}
        · {(updated ?? new Date()).toLocaleString()}
      </footer>
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
  here: boolean;
  /** Opened in this session. */
  seen: boolean;
  href: string;
  openPage?: Props['openPage'];
  depth: number;
  open: boolean;
  printing: boolean;
  me: string | null;
  onToggle: () => void;
  onToggleFocus?: (path: string) => void;
  screenshot: Props['screenshot'];
}) {
  const n = p.node;
  const people = [...new Set(n.visitors.map((v) => v.by))];
  const has = n.comments.length > 0;
  const visited = n.visited || p.seen;
  const star = p.onToggleFocus && (
    <button
      class={`ov-star ${n.focus !== null ? 'is-on' : ''}`}
      onClick={() => p.onToggleFocus?.(n.path)}
      title={n.focus !== null ? 'No longer a focus page' : 'Make this a focus page: customers are asked to look at it'}
      aria-pressed={n.focus !== null}
    >
      ★
    </button>
  );
  return (
    <div
      class={`ov-page ${visited ? '' : 'is-unvisited'} ${p.open && has ? 'is-open' : ''} ${n.focus !== null ? 'is-focus' : ''} ${p.here ? 'is-here' : ''}`}
      style={{ '--ov-depth': p.depth }}
      data-path={n.path}
    >
      {star}
      {/* The row folds the comments; the path is a link to the page. */}
      <div class="ov-row" onClick={(e) => has && !(e.target as Element).closest('a, button') && p.onToggle()}>
        <button class="ov-caret" onClick={p.onToggle} disabled={!has} aria-expanded={has ? p.open : undefined} aria-label={`${p.open ? 'Hide' : 'Show'} the comments on ${n.path}`}>
          {has ? (p.open ? '▾' : '▸') : ''}
        </button>
        <a
          class="ov-path"
          href={p.href}
          target={SITE_TAB}
          title={`Open ${n.path}`}
          onClick={(e) => {
            if (p.openPage?.(p.href)) e.preventDefault();
          }}
        >
          {n.path === '/' || p.depth === 0 ? n.path : `/${n.segment}`}
        </a>
        <span class="ov-page-title">
          {n.title ?? ''}
          {n.focus !== null && (
            <span class="ov-focus" title="The team asked you to look at this page">
              ★ Focus{n.focus ? `: ${n.focus}` : ''}
            </span>
          )}
          {p.here && <span class="ov-here">Here now</span>}
          {p.seen && !p.here && (
            <span class="ov-seen" title="You opened this page in this session">
              ✓ Visited this session
            </span>
          )}
        </span>
        <span class="ov-counts">
          {STATUSES.filter((s) => n.counts[s]).map((s) => (
            <span key={s} class={`ov-count st-${s}`} title={STATUS_LABELS[s]}>
              {n.counts[s]}
            </span>
          ))}
          {visited && !has && <span class="ov-tag">no feedback</span>}
          {!visited && !has && <span class={n.focus !== null ? 'ov-tag ov-todo' : 'ov-dim'}>not visited</span>}
        </span>
        <span class="ov-visitors ov-dim">
          {people.length > 0 && `${people.join(', ')} · ${when(n.visitors[0]!.lastAt)}`}
        </span>
      </div>
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
