import { useEffect, useRef, useState } from 'preact/hooks';
import { canDelete, KIND_LABELS, STATUS_LABELS, type Comment, type Message, type ProjectSummary, type SendDecision, type Status } from '@brm/shared';
import { suggestDecision } from '../../sync.ts';
import { useHost, useSetting } from '../host.ts';
import { describe } from '../targets.ts';
import { replyDraft } from '../drafts.ts';
import { useSendKey } from '../hooks.ts';
import { Mark } from './Mark.tsx';
import { isSendKey, sendKeyName } from '../../settings.ts';

export type Filter = 'active' | Status | 'all';
export type Scope = 'page' | 'site';

const FILTERS: { key: Filter; label: string; hint?: string; statuses: Status[] }[] = [
  {
    key: 'active',
    label: 'Not accepted yet',
    hint: 'Open, in progress and review ready',
    statuses: ['open', 'in_progress', 'review_ready'],
  },
  // One per status.
  ...(['open', 'in_progress', 'review_ready', 'accepted'] as const).map((st) => ({
    key: st,
    label: STATUS_LABELS[st],
    statuses: [st],
  })),
  { key: 'all', label: 'All', statuses: ['open', 'in_progress', 'review_ready', 'accepted'] },
];

interface Props {
  comments: Comment[];
  path: string;
  /** This site, for the Overview button. */
  origin?: string;
  connected: boolean;
  focusId: number | null;
  /** In the browser's side panel: fills it, no resize handle (the browser resizes it). */
  docked?: boolean;
  onClose: () => void;
  onHover: (id: number | null) => void;
  /** Resolves to a note to show, e.g. when the element is gone. */
  onGoTo: (c: Comment) => string | null | Promise<string | null>;
  onOpenPage: (c: Comment) => void;
  onChanged: () => Promise<void>;
}

function time(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** All comments collapsed (an overview), the default, or all expanded. Remembered for all sites. */
const COLLAPSED_KEY = 'threadsOverview';

/**
 * Which comments are open: all collapsed by default, or all expanded, plus the
 * ones the user toggled by hand. New comments follow the current default.
 */
function useExpanded() {
  // Collapsed unless the user chose Expand all (stored false).
  const [collapsed, setCollapsed] = useSetting(COLLAPSED_KEY, (v) => v !== false);
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set());
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  // Toggled by hand means the opposite of the default.
  const isOpen = (id: number) => collapsed === toggled.has(id);
  const toggle = (id: number) =>
    setToggled((t) => {
      const next = new Set(t);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const show = (id: number) =>
    setToggled((t) => {
      const next = new Set(t);
      if (collapsedRef.current) next.add(id);
      else next.delete(id);
      return next;
    });
  const setAll = (value: boolean) => {
    setCollapsed(value);
    setToggled(new Set());
  };
  return { collapsed, isOpen, toggle, show, setAll };
}

/** Width the user dragged the sidebar to, shared by all sites. */
const WIDTH_KEY = 'sidebarWidth';
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
/** Leave at least this much of the page visible. */
const PAGE_MIN = 200;

const clampWidth = (w: number) => Math.round(Math.max(MIN_WIDTH, Math.min(w, innerWidth - PAGE_MIN)));

/**
 * Drag the left edge to resize; double-click it for the default width. The width
 * goes on the overlay root as --brm-side-w, so the toolbar and page composer move along.
 */
function useSidebarWidth(ref: { current: HTMLElement | null }) {
  const [width, save] = useSetting(WIDTH_KEY, (w) => (typeof w === 'number' ? w : DEFAULT_WIDTH));
  /** While dragging: stored only when the drag ends. */
  const [dragged, setDragged] = useState<number | null>(null);
  // Keep it inside the window when the window gets smaller.
  const [, rerender] = useState(0);
  useEffect(() => {
    const onResize = () => rerender((n) => n + 1);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  const shown = clampWidth(dragged ?? width);
  useEffect(() => {
    const root = ref.current?.parentElement;
    root?.style.setProperty('--brm-side-w', `${shown}px`);
    return () => root?.style.removeProperty('--brm-side-w');
  }, [shown]);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    let w = shown;
    const move = (ev: PointerEvent) => {
      w = clampWidth(innerWidth - ev.clientX);
      setDragged(w);
    };
    const up = () => {
      handle.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragged(null);
      save(w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  return { width: shown, onPointerDown, reset: () => save(DEFAULT_WIDTH) };
}

const ORDER: Record<Status, number> = { review_ready: 0, in_progress: 1, open: 2, accepted: 3 };

/** Which comments the sidebar shows: '' this site, or a review-hub project id. Remembered for all sites. */
const SOURCE_KEY = 'commentsSource';
/** How often the sidebar refreshes projects and their comments from the extension's store. */
const PROJECT_REFRESH_MS = 5000;

/** Review-hub projects and the selected one's comments (developer side only). */
function useProjects(source: string) {
  const host = useHost();
  const api = host.mode === 'review' ? undefined : host.projects;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState<string | null>(null);
  const selected = projects.find((p) => p.id === source) ?? null;

  const refresh = async () => {
    if (!api) return;
    try {
      const list = await api.list();
      setProjects(list);
      const p = list.find((x) => x.id === source);
      setComments(p ? (await host.comments.list(p.origin)).filter((c) => c.project === p.id) : []);
    } catch {
      // the background is restarting: next round
    }
  };

  useEffect(() => {
    if (!api) return;
    void refresh();
    const t = setInterval(() => void refresh(), PROJECT_REFRESH_MS);
    return () => clearInterval(t);
  }, [api, source]);

  const pull = async () => {
    if (!api || !selected) return;
    setPulling(true);
    setPullNote(null);
    try {
      const [r] = await api.pull(selected.id);
      if (r && !r.error) {
        const n = r.added + r.updated + r.removed;
        setPullNote(n === 0 ? 'Nothing new.' : [r.added && `${r.added} new`, r.updated && `${r.updated} updated`, r.removed && `${r.removed} deleted`].filter(Boolean).join(', '));
      }
    } catch (err) {
      setPullNote(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
      await refresh();
    }
  };

  return { available: Boolean(api) && projects.length > 0, projects, selected, comments, pull, pulling, pullNote, refresh };
}

export function Sidebar({ comments, path, origin, connected, focusId, docked, onClose, onHover, onGoTo, onOpenPage, onChanged }: Props) {
  const host = useHost();
  const [scope, setScope] = useState<Scope>('page');
  const [filter, setFilter] = useState<Filter>('active');
  const [source, setSource] = useSetting(SOURCE_KEY, (v) => (typeof v === 'string' ? v : ''));
  const projects = useProjects(source);
  /** A review-hub project is shown instead of this site. */
  const project = projects.available ? projects.selected : null;
  const list = project ? projects.comments : comments;
  /** Customer feedback with agent updates the developer has not sent yet. */
  const pending = host.mode === 'review' ? [] : list.filter((c) => c.project && c.outbox?.length);
  /** The Send to customer panel, with these comments. */
  const [sending, setSending] = useState<Comment[] | null>(null);
  const afterChange = async () => {
    await onChanged();
    await projects.refresh();
  };
  const expanded = useExpanded();
  const asideRef = useRef<HTMLElement>(null);
  const size = useSidebarWidth(asideRef);

  useEffect(() => {
    if (focusId === null) return;
    const c = comments.find((x) => x.id === focusId);
    expanded.show(focusId);
    if (c && project) setSource('');
    if (c && c.path !== path) setScope('site');
    if (c && !FILTERS.find((f) => f.key === filter)?.statuses.includes(c.status)) setFilter('all');
  }, [focusId]);

  const inScope = list.filter((c) => project !== null || scope === 'site' || c.path === path);
  const statuses = FILTERS.find((f) => f.key === filter)?.statuses ?? [];
  const shown = inScope
    .filter((c) => statuses.includes(c.status))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt));
  const anyOpen = shown.some((c) => expanded.isOpen(c.id));

  return (
    <aside
      ref={asideRef}
      class={`brm-ui brm-sidebar ${docked ? 'is-docked' : ''}`}
      style={docked ? undefined : { width: `${size.width}px` }}
      aria-label="Review comments"
    >
      {!docked && (
        <div
          class="brm-side-resize"
          title="Drag to resize, double-click for the default width"
          onPointerDown={size.onPointerDown}
          onDblClick={size.reset}
        />
      )}
      <header class="brm-side-head">
        <Mark />
        <strong>Comments</strong>
        {!project && (
          <div class="brm-seg">
            <button class={scope === 'page' ? 'is-active' : ''} onClick={() => setScope('page')}>
              This page
            </button>
            <button class={scope === 'site' ? 'is-active' : ''} onClick={() => setScope('site')}>
              Whole site
            </button>
          </div>
        )}
        {project && <span class="brm-spacer" />}
        {host.openOverview && (
          <button
            class="brm-btn brm-overview-btn"
            title="All feedback on a map of the site: which pages were looked at, and what was said where. Export as PDF."
            onClick={() => host.openOverview?.(project ? { project: project.id } : origin ? { origin } : {})}
          >
            Overview
          </button>
        )}
        <button class="brm-icon-btn" title="Help" onClick={() => host.openHelp()}>
          ?
        </button>
        <button class="brm-icon-btn" title="Close (Alt+C)" onClick={onClose}>
          ✕
        </button>
      </header>
      {projects.available && (
        <div class={`brm-source ${project ? 'is-project' : ''}`}>
          <select
            value={project?.id ?? ''}
            aria-label="Show comments from"
            onChange={(e) => setSource((e.target as HTMLSelectElement).value)}
          >
            <option value="">This site</option>
            {projects.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}: customer feedback
              </option>
            ))}
          </select>
          {project && (
            <button class="brm-btn brm-primary" disabled={projects.pulling} onClick={() => void projects.pull()} title={`Get new feedback from ${project.hubUrl}`}>
              {projects.pulling ? 'Pulling…' : 'Pull feedback'}
            </button>
          )}
        </div>
      )}
      {project && (
        <p class={`brm-source-status ${project.lastError ? 'is-error' : ''}`}>
          {project.lastError ??
            projects.pullNote ??
            (project.lastPull ? `Pulled ${time(project.lastPull)} from ${new URL(project.hubUrl).host}` : 'Not pulled yet.')}
          {!project.lastError && (
            <span class="brm-source-hint">
              Customer feedback from {project.name}: your agent works on it as usual, the customer accepts or reopens it on staging.
            </span>
          )}
        </p>
      )}
      {pending.length > 0 && host.projects && (
        <div class="brm-pending">
          <span>
            <strong>{pending.length}</strong> {pending.length === 1 ? 'update is' : 'updates are'} not sent to the customer yet
          </span>
          <button class="brm-btn brm-primary" onClick={() => setSending(pending)}>
            Send to customer…
          </button>
        </div>
      )}
      <nav class="brm-filters">
        <label class="brm-filter">
          <span class="brm-dim">Show</span>
          <select value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as Filter)}>
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key} title={f.hint}>
                {f.label} ({inScope.filter((c) => f.statuses.includes(c.status)).length})
              </option>
            ))}
          </select>
        </label>
        {shown.length > 0 && (
          <button
            class="brm-btn"
            onClick={() => expanded.setAll(anyOpen)}
            title={anyOpen ? 'Collapse every comment for an overview' : 'Expand every comment'}
          >
            {anyOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </nav>
      {!connected && host.mode === 'review' && (
        <p class="brm-warn">Can't reach the review server right now. Your feedback is sent when it is back; try again in a moment.</p>
      )}
      {!connected && host.mode !== 'review' && (
        <p class="brm-warn">
          No coding agent is connected. Your comments are saved here; your agent sees them as soon as a session with
          browser-review runs.{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              host.openHelp('setup');
            }}
          >
            How to set it up
          </a>
        </p>
      )}
      <div class="brm-side-list">
        {shown.length === 0 && <p class="brm-empty">{project ? 'No customer feedback with this status.' : 'Nothing here.'}</p>}
        {shown.map((c) => (
          <Card
            key={c.id}
            comment={c}
            showPath={project !== null || scope === 'site'}
            onThisPage={!project && c.path === path}
            projectName={project?.name ?? null}
            onSend={(c) => setSending([c])}
            open={expanded.isOpen(c.id)}
            focused={focusId === c.id}
            onToggle={() => expanded.toggle(c.id)}
            onHover={onHover}
            onGoTo={onGoTo}
            onOpenPage={onOpenPage}
            onChanged={afterChange}
          />
        ))}
      </div>
      {sending && (
        <SendPanel
          comments={sending}
          onClose={() => setSending(null)}
          onDone={async () => {
            setSending(null);
            await afterChange();
          }}
        />
      )}
    </aside>
  );
}

interface CardProps {
  comment: Comment;
  showPath: boolean;
  onThisPage: boolean;
  /** Shown from a review-hub project: customer feedback the developer can't accept or delete. */
  projectName: string | null;
  /** Open the Send to customer panel for this comment. */
  onSend: (c: Comment) => void;
  open: boolean;
  /** Asked for (a pin, "Open thread"): scroll it into view. */
  focused: boolean;
  onToggle: () => void;
  onHover: (id: number | null) => void;
  onGoTo: Props['onGoTo'];
  onOpenPage: Props['onOpenPage'];
  onChanged: () => Promise<void>;
}

/** Who wrote a message, as the reader sees it. */
function authorLabel(m: Message, mode: 'developer' | 'review', me: string | null): string {
  if (m.author === 'user') return m.name && m.name !== me ? m.name : 'You';
  return mode === 'review' ? (m.name ?? 'Developer') : 'Agent';
}

function Card({ comment: c, showPath, onThisPage, projectName, onSend, open, focused, onToggle, onHover, onGoTo, onOpenPage, onChanged }: CardProps) {
  const host = useHost();
  const { comments: api } = host;
  const mode = host.mode ?? 'developer';
  const me = host.me ?? null;
  /** In review mode, customers can only delete or undo what they wrote themselves (the hub checks it too). */
  const mine = mode !== 'review' || (c.messages[0]?.author === 'user' && c.messages[0].name === me);
  /** A copy of customer feedback in the developer's extension: the customer accepts, reopens and deletes. */
  const customer = mode !== 'review' && Boolean(c.project);
  const [reply, setReply] = useState(() => replyDraft.get(c.id));

  useEffect(() => replyDraft.set(c.id, reply), [c.id, reply]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sendKey = useSendKey();
  const ref = useRef<HTMLElement>(null);
  const first = c.messages.find((m) => m.author === 'user');

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setReply('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canUndo = c.kind !== 'comment' && canDelete(c) && mine && !customer;

  return (
    <article
      ref={ref}
      class={`brm-thread st-${c.status} ${open ? 'is-open' : ''}`}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button class="brm-thread-head" onClick={onToggle} aria-expanded={open}>
        <span class="brm-id">#{c.id}</span>
        <span class={`brm-badge st-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        {c.kind !== 'comment' && <span class="brm-badge brm-kind">{KIND_LABELS[c.kind]}</span>}
        {customer && c.outbox?.length ? (
          <span class="brm-badge brm-unsent" title="Your agent's updates wait for you to send them">
            Not sent
          </span>
        ) : null}
        {customer && first?.name && (
          <span class="brm-badge brm-who" title={`Customer feedback${projectName ? ` from ${projectName}` : ''}`}>
            {first.name}
          </span>
        )}
        <span class="brm-dim brm-when">{time(c.updatedAt)}</span>
      </button>
      <div class="brm-thread-summary" onClick={onToggle}>
        <div class="brm-where">
          {c.target ? describe(c.target.tag, c.target.text) : 'Whole page'}
          {showPath && <span class="brm-dim"> on {c.path}</span>}
        </div>
        {!open && first && <div class="brm-clamp">{first.body}</div>}
        {customer && c.remote && (
          <div class="brm-customer-sees">
            Customer sees: <span class={`brm-badge st-${c.remote.status}`}>{STATUS_LABELS[c.remote.status]}</span>
          </div>
        )}
      </div>

      {open && (
        <div class="brm-thread-body">
          <Thumb comment={c} />
          {c.change?.kind === 'edit' && (
            <div class="brm-change">
              {c.change.texts.map((t) => (
                <div key={t.index}>
                  <s>{t.before}</s> <span class="brm-dim">to</span> {t.after}
                </div>
              ))}
              {c.change.css.trim() && <code class="brm-mono">{c.change.css}</code>}
            </div>
          )}
          <ul class="brm-messages">
            {c.messages.map((m) => (
              <li key={m.id} class={`brm-msg by-${m.author}`}>
                {m.author !== 'system' && (
                  <div class="brm-msg-meta">
                    {authorLabel(m, mode, me)} <span class="brm-dim">{time(m.createdAt)}</span>
                  </div>
                )}
                <div class="brm-msg-body">{m.body}</div>
              </li>
            ))}
          </ul>

          {c.solution && (
            <div class="brm-solution">
              <div class="brm-solution-title">{mode === 'review' ? 'What was changed' : 'How the agent solved it'}</div>
              <div class="brm-msg-body">{c.solution.note}</div>
              {c.solution.files.length > 0 && (
                <ul class="brm-files">
                  {c.solution.files.map((f) => (
                    <li key={f}>
                      <code>{f}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <textarea
            class="brm-reply"
            rows={2}
            placeholder={
              customer
                ? `Reply to the customer; ${sendKeyName(sendKey)} sends`
                : c.status === 'review_ready'
                  ? `Not right? Say what is still wrong; ${sendKeyName(sendKey)} reopens.`
                  : `Reply; ${sendKeyName(sendKey)} sends`
            }
            value={reply}
            onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (!isSendKey(e, sendKey)) return;
              e.preventDefault();
              // Never accepts by keyboard: on a finished thread it reopens, with the text.
              if (busy || !reply.trim()) return;
              if (!customer && (c.status === 'review_ready' || c.status === 'accepted')) void run(() => api.reopen(c.id, reply));
              else void run(() => api.reply(c.id, reply));
            }}
          />
          {error && <p class="brm-error">{error}</p>}
          {note && <p class="brm-note">{note}</p>}
          <div class="brm-actions brm-wrap">
            <button
              class="brm-btn"
              onClick={() => void Promise.resolve(onGoTo(c)).then(setNote)}
              title={
                onThisPage
                  ? c.target
                    ? 'Scroll to the element'
                    : 'Scroll to the top of the page'
                  : 'Go to the page and show the element'
              }
            >
              Go to
            </button>
            <a
              class="brm-btn"
              href={c.url}
              title={c.url}
              onClick={(e) => {
                e.preventDefault();
                onOpenPage(c);
              }}
            >
              Open page
            </a>
            {canUndo && (
              <button
                class="brm-btn"
                disabled={busy}
                onClick={() => void run(() => api.remove(c.id))}
                title="Bring the element back and drop this task"
              >
                Undo {c.kind === 'remove' ? 'removal' : 'edit'}
              </button>
            )}
            {c.kind === 'comment' && canDelete(c) && mine && !customer && (
              <button
                class="brm-btn"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete comment #${c.id}?`)) void run(() => api.remove(c.id));
                }}
              >
                Delete
              </button>
            )}
            <span class="brm-spacer" />
            {customer && c.outbox?.length ? (
              <button class="brm-btn brm-primary" onClick={() => onSend(c)} title="Choose what the customer sees: fixed, or more feedback needed">
                Send to customer…
              </button>
            ) : null}
            {!customer && (c.status === 'review_ready' || c.status === 'accepted') && (
              <button class="brm-btn" disabled={busy} onClick={() => void run(() => api.reopen(c.id, reply))}>
                Reopen
              </button>
            )}
            {(customer || (c.status !== 'review_ready' && c.status !== 'accepted')) && (
              <button
                class="brm-btn"
                disabled={busy || !reply.trim()}
                onClick={() => void run(() => api.reply(c.id, reply))}
              >
                Send
              </button>
            )}
            {!customer && c.status === 'review_ready' && (
              <button class="brm-btn brm-primary" disabled={busy} onClick={() => void run(() => api.accept(c.id))}>
                Accept solution
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Thumb({ comment }: { comment: Comment }) {
  const host = useHost();
  const shot =
    comment.screenshots.find((s) => s.kind === 'element' && s.source === 'initial') ??
    comment.screenshots.find((s) => s.kind === 'page' && s.source === 'initial');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!shot) return;
    let live = true;
    void host.comments.screenshot(shot.id).then((d) => live && setSrc(d));
    return () => {
      live = false;
    };
  }, [shot?.id]);
  if (!shot || !src) return null;
  return (
    <a
      class="brm-thumb"
      href={src}
      onClick={(e) => {
        e.preventDefault();
        const w = window.open();
        if (w) {
          const img = w.document.createElement('img');
          img.src = src;
          img.style.maxWidth = '100%';
          w.document.body.append(img);
        }
      }}
      title="Screenshot when the comment was made"
    >
      <img src={src} alt="Screenshot of the element" />
    </a>
  );
}


/**
 * Send to customer: for each comment, fixed (review ready, with a note) or more
 * feedback needed (a question), in the developer's own words. Only what is sent
 * here reaches the customer; the agent's queued updates are the suggestion.
 */
function SendPanel({ comments, onClose, onDone }: { comments: Comment[]; onClose: () => void; onDone: () => Promise<void> }) {
  const host = useHost();
  const [rows, setRows] = useState(() => comments.map((c) => ({ c, d: suggestDecision(c), include: true })));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const update = (id: number, change: Partial<SendDecision> & { include?: boolean }) =>
    setRows((rs) =>
      rs.map((r) => (r.c.id === id ? { ...r, include: change.include ?? r.include, d: { ...r.d, ...change, id } } : r)),
    );
  const chosen = rows.filter((r) => r.include);
  const missing = chosen.filter((r) => !r.d.message.trim());

  const send = async () => {
    if (!host.projects || chosen.length === 0) return;
    setBusy(true);
    try {
      const results = await host.projects.send(chosen.map((r) => ({ id: r.c.id, decision: r.d.decision, message: r.d.message })));
      const failed: Record<number, string> = {};
      for (const res of results) if (!res.ok) failed[res.id] = res.error ?? 'Not sent.';
      setErrors(failed);
      const left = rows.filter((r) => failed[r.c.id] !== undefined || !r.include);
      if (Object.keys(failed).length === 0) await onDone();
      else setRows(left);
    } catch (err) {
      setErrors({ 0: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const discard = async (id: number) => {
    await host.projects?.discard(id);
    const left = rows.filter((r) => r.c.id !== id);
    if (left.length === 0) await onDone();
    else setRows(left);
  };

  return (
    <div class="brm-send" role="dialog" aria-label="Send to customer">
      <header class="brm-send-head">
        <strong>Send to customer</strong>
        <span class="brm-spacer" />
        <button class="brm-icon-btn" title="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <p class="brm-send-intro">
        Deployed to staging? Tell the customer what was fixed, or ask what you need. Only what you send here reaches them.
      </p>
      <div class="brm-send-list">
        {rows.map(({ c, d, include }) => {
          const first = c.messages.find((m) => m.author === 'user');
          return (
            <section key={c.id} class={`brm-send-row ${include ? '' : 'is-skipped'}`}>
              <label class="brm-send-title">
                <input type="checkbox" checked={include} onChange={(e) => update(c.id, { include: (e.target as HTMLInputElement).checked })} />
                <span class="brm-id">#{c.id}</span>
                {first?.name && <span class="brm-badge brm-who">{first.name}</span>}
                <span class="brm-clamp brm-send-quote">{first?.body ?? ''}</span>
              </label>
              {include && (
                <>
                  <div class="brm-seg brm-send-choice" role="radiogroup">
                    <button
                      role="radio"
                      aria-checked={d.decision === 'fixed'}
                      class={d.decision === 'fixed' ? 'is-active is-fixed' : ''}
                      onClick={() => update(c.id, { decision: 'fixed' })}
                    >
                      ✓ Fixed
                    </button>
                    <button
                      role="radio"
                      aria-checked={d.decision === 'question'}
                      class={d.decision === 'question' ? 'is-active is-question' : ''}
                      onClick={() => update(c.id, { decision: 'question' })}
                    >
                      ? More feedback needed
                    </button>
                  </div>
                  <textarea
                    class="brm-reply"
                    rows={3}
                    value={d.message}
                    placeholder={d.decision === 'fixed' ? 'What did you change? The customer reads this.' : 'What do you need to know from the customer?'}
                    onInput={(e) => update(c.id, { message: (e.target as HTMLTextAreaElement).value })}
                  />
                  <div class="brm-send-meta">
                    <span class="brm-dim">
                      Customer sees{' '}
                      <span class={`brm-badge st-${c.remote?.status ?? c.status}`}>{STATUS_LABELS[c.remote?.status ?? c.status]}</span> →{' '}
                      <span class={`brm-badge st-${d.decision === 'fixed' ? 'review_ready' : 'in_progress'}`}>
                        {d.decision === 'fixed' ? 'Review ready' : 'In progress'}
                      </span>
                    </span>
                    <button class="brm-link" onClick={() => void discard(c.id)} title="Drop the agent's updates; the customer keeps seeing what they see now">
                      Discard agent updates
                    </button>
                  </div>
                </>
              )}
              {errors[c.id] && <p class="brm-error">{errors[c.id]}</p>}
            </section>
          );
        })}
        {errors[0] && <p class="brm-error">{errors[0]}</p>}
      </div>
      <footer class="brm-send-foot">
        <button class="brm-btn" onClick={onClose} disabled={busy}>
          Later
        </button>
        <button class="brm-btn brm-primary" disabled={busy || chosen.length === 0 || missing.length > 0} onClick={() => void send()} title={missing.length ? 'Write a message for each comment you send' : undefined}>
          {busy ? 'Sending…' : `Send ${chosen.length} to customer`}
        </button>
      </footer>
    </div>
  );
}
