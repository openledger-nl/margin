import { useEffect, useRef, useState } from 'preact/hooks';
import { KIND_LABELS, STATUS_LABELS, type Comment, type Status } from '@brm/shared';
import { bridge } from '../bridge.ts';
import { describe } from '../targets.ts';
import { replyDraft } from '../drafts.ts';
import { useSendKey } from '../hooks.ts';
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

/** All threads collapsed (an overview) instead of all expanded. Remembered for all sites. */
const COLLAPSED_KEY = 'threadsOverview';

/**
 * Which threads are open: all expanded by default, or all collapsed, plus the
 * ones the user toggled by hand. New threads follow the current default.
 */
function useExpanded() {
  const [collapsed, setCollapsed] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set());
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  useEffect(() => {
    void chrome.storage.local.get(COLLAPSED_KEY).then((r) => setCollapsed(r[COLLAPSED_KEY] === true));
  }, []);
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
    void chrome.storage.local.set({ [COLLAPSED_KEY]: value });
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
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    void chrome.storage.local.get(WIDTH_KEY).then((r) => {
      if (typeof r[WIDTH_KEY] === 'number') setWidth(r[WIDTH_KEY]);
    });
  }, []);
  // Keep it inside the window when the window gets smaller.
  const [, rerender] = useState(0);
  useEffect(() => {
    const onResize = () => rerender((n) => n + 1);
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  const shown = clampWidth(width);
  useEffect(() => {
    const root = ref.current?.parentElement;
    root?.style.setProperty('--brm-side-w', `${shown}px`);
    return () => root?.style.removeProperty('--brm-side-w');
  }, [shown]);

  const save = (w: number) => {
    setWidth(w);
    void chrome.storage.local.set({ [WIDTH_KEY]: w });
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    let w = shown;
    const move = (ev: PointerEvent) => {
      w = clampWidth(innerWidth - ev.clientX);
      setWidth(w);
    };
    const up = () => {
      handle.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      save(w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  return { width: shown, onPointerDown, reset: () => save(DEFAULT_WIDTH) };
}

const ORDER: Record<Status, number> = { review_ready: 0, in_progress: 1, open: 2, accepted: 3 };

export function Sidebar({ comments, path, connected, focusId, docked, onClose, onHover, onGoTo, onOpenPage, onChanged }: Props) {
  const [scope, setScope] = useState<Scope>('page');
  const [filter, setFilter] = useState<Filter>('active');
  const expanded = useExpanded();
  const asideRef = useRef<HTMLElement>(null);
  const size = useSidebarWidth(asideRef);

  useEffect(() => {
    if (focusId === null) return;
    const c = comments.find((x) => x.id === focusId);
    expanded.show(focusId);
    if (c && c.path !== path) setScope('site');
    if (c && !FILTERS.find((f) => f.key === filter)?.statuses.includes(c.status)) setFilter('all');
  }, [focusId]);

  const inScope = comments.filter((c) => scope === 'site' || c.path === path);
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
      aria-label="Review threads"
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
        <strong>Review</strong>
        <div class="brm-seg">
          <button class={scope === 'page' ? 'is-active' : ''} onClick={() => setScope('page')}>
            This page
          </button>
          <button class={scope === 'site' ? 'is-active' : ''} onClick={() => setScope('site')}>
            Whole site
          </button>
        </div>
        <button class="brm-icon-btn" title="Help" onClick={() => bridge.openHelp()}>
          ?
        </button>
        <button class="brm-icon-btn" title="Close (Alt+Shift+T)" onClick={onClose}>
          ✕
        </button>
      </header>
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
            title={anyOpen ? 'Collapse every thread for an overview' : 'Expand every thread'}
          >
            {anyOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </nav>
      {!connected && (
        <p class="brm-warn">
          No coding agent is connected. Your comments are saved here; your agent sees them as soon as a session with
          browser-review runs.{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              bridge.openHelp('setup');
            }}
          >
            How to set it up
          </a>
        </p>
      )}
      <div class="brm-side-list">
        {shown.length === 0 && <p class="brm-empty">Nothing here.</p>}
        {shown.map((c) => (
          <Card
            key={c.id}
            comment={c}
            showPath={scope === 'site'}
            onThisPage={c.path === path}
            open={expanded.isOpen(c.id)}
            focused={focusId === c.id}
            onToggle={() => expanded.toggle(c.id)}
            onHover={onHover}
            onGoTo={onGoTo}
            onOpenPage={onOpenPage}
            onChanged={onChanged}
          />
        ))}
      </div>
    </aside>
  );
}

interface CardProps {
  comment: Comment;
  showPath: boolean;
  onThisPage: boolean;
  open: boolean;
  /** Asked for (a pin, "Open thread"): scroll it into view. */
  focused: boolean;
  onToggle: () => void;
  onHover: (id: number | null) => void;
  onGoTo: Props['onGoTo'];
  onOpenPage: Props['onOpenPage'];
  onChanged: () => Promise<void>;
}

function Card({ comment: c, showPath, onThisPage, open, focused, onToggle, onHover, onGoTo, onOpenPage, onChanged }: CardProps) {
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

  const canUndo = c.kind !== 'comment' && (c.status === 'open' || c.status === 'in_progress');

  return (
    <article
      ref={ref}
      class={`brm-thread ${open ? 'is-open' : ''}`}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button class="brm-thread-head" onClick={onToggle} aria-expanded={open}>
        <span class="brm-id">#{c.id}</span>
        <span class={`brm-badge st-${c.status}`}>{STATUS_LABELS[c.status]}</span>
        {c.kind !== 'comment' && <span class="brm-badge brm-kind">{KIND_LABELS[c.kind]}</span>}
        <span class="brm-dim brm-when">{time(c.updatedAt)}</span>
      </button>
      <div class="brm-thread-summary" onClick={onToggle}>
        <div class="brm-where">
          {c.target ? describe(c.target.tag, c.target.text) : 'Whole page'}
          {showPath && <span class="brm-dim"> on {c.path}</span>}
        </div>
        {!open && first && <div class="brm-clamp">{first.body}</div>}
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
                    {m.author === 'user' ? 'You' : 'Agent'} <span class="brm-dim">{time(m.createdAt)}</span>
                  </div>
                )}
                <div class="brm-msg-body">{m.body}</div>
              </li>
            ))}
          </ul>

          {c.solution && (
            <div class="brm-solution">
              <div class="brm-solution-title">How the agent solved it</div>
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
              c.status === 'review_ready'
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
              if (c.status === 'review_ready' || c.status === 'accepted') void run(() => bridge.reopen(c.id, reply));
              else void run(() => bridge.reply(c.id, reply));
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
                onClick={() => void run(() => bridge.remove(c.id))}
                title="Bring the element back and drop this task"
              >
                Undo {c.kind === 'remove' ? 'removal' : 'edit'}
              </button>
            )}
            {c.kind === 'comment' && c.status !== 'in_progress' && (
              <button
                class="brm-btn"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete comment #${c.id}?`)) void run(() => bridge.remove(c.id));
                }}
              >
                Delete
              </button>
            )}
            <span class="brm-spacer" />
            {(c.status === 'review_ready' || c.status === 'accepted') && (
              <button class="brm-btn" disabled={busy} onClick={() => void run(() => bridge.reopen(c.id, reply))}>
                Reopen
              </button>
            )}
            {c.status !== 'review_ready' && c.status !== 'accepted' && (
              <button
                class="brm-btn"
                disabled={busy || !reply.trim()}
                onClick={() => void run(() => bridge.reply(c.id, reply))}
              >
                Send
              </button>
            )}
            {c.status === 'review_ready' && (
              <button class="brm-btn brm-primary" disabled={busy} onClick={() => void run(() => bridge.accept(c.id))}>
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
  const shot =
    comment.screenshots.find((s) => s.kind === 'element' && s.source === 'initial') ??
    comment.screenshots.find((s) => s.kind === 'page' && s.source === 'initial');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!shot) return;
    let live = true;
    void bridge.screenshot(shot.id).then((d) => live && setSrc(d));
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
