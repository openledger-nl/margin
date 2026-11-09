import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isPreviewActive, pageKey, type Comment, type Kind } from '@brm/shared';
import type { GoToResponse, PanelState, PrepareCaptureResponse, TabRequest } from '../messages.ts';
import { bridge } from './bridge.ts';
import { enterCapture, nextFrames } from './capture.ts';
import { useHref } from './hooks.ts';
import { composerDraft, type ComposerDraft } from './drafts.ts';
import type { Previews } from './previews.ts';
import { findTarget } from './targets.ts';
import { DEFAULT_HOLD_KEY, HOLD_KEY, HOLD_KEYS, toHoldKey, type HoldKey } from '../settings.ts';
import { Composer } from './ui/Composer.tsx';
import { Picker } from './ui/Picker.tsx';
import { Outline, Pins } from './ui/Pins.tsx';
import { Sidebar } from './ui/Sidebar.tsx';
import { Toolbar } from './ui/Toolbar.tsx';

type Mode =
  | { type: 'idle' }
  /** `held`: started by holding the hold-to-pick key; releasing it stops. */
  | { type: 'picking'; held?: boolean }
  | { type: 'compose'; el: Element | null; kind: Kind; draft?: ComposerDraft; notice?: string };

const hiddenKey = (origin: string) => `hidden:${origin}`;
/** sessionStorage key: comment to jump to after "Go to" navigated to its page. */
const GOTO_KEY = 'brm-goto';
const sidebarKey = (origin: string) => `sidebar:${origin}`;

export function App({ previews }: { previews: Previews }) {
  const href = useHref();
  const { origin, path } = pageKey(href);
  const [comments, setComments] = useState<Comment[]>([]);
  /** A Claude Code session is connected. */
  const [connected, setConnected] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mode, setMode] = useState<Mode>({ type: 'idle' });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  /** The browser's side panel shows the threads; null until known. */
  const [panel, setPanel] = useState<PanelState | null>(null);
  const usePanel = panel?.supported === true;
  /** Shown above the toolbar when the browser would not open the panel from a click in the page. */
  const [hint, setHint] = useState<string | null>(null);

  // ---------- data ----------

  const load = useCallback(async () => {
    try {
      setComments(await bridge.listComments(origin));
    } catch {
      // extension reloaded: keep what we have
    }
  }, [origin]);

  useEffect(() => {
    void load();
    return bridge.subscribe((ev) => {
      if (ev.type === 'status') {
        setConnected(ev.connected);
      } else if (ev.type === 'comments-changed' && ev.origin === origin) {
        void load();
      }
    });
  }, [origin, load]);

  const pageComments = useMemo(() => comments.filter((c) => c.path === path), [comments, path]);

  // Previews run even when the overlay is hidden: removed stays removed.
  useEffect(() => {
    previews.setComments(pageComments.filter(isPreviewActive));
  }, [pageComments, previews]);

  useEffect(() => {
    void bridge.panelState().then((p) => p && setPanel(p));
  }, []);

  // ---------- show / hide, per site ----------

  useEffect(() => {
    void chrome.storage.local.get([hiddenKey(origin), sidebarKey(origin)]).then((r) => {
      setHidden(r[hiddenKey(origin)] === true);
      setSidebarOpen(r[sidebarKey(origin)] === true);
    });
  }, [origin]);

  const setSidebarStored = useCallback(
    (value: boolean) => {
      setSidebarOpen(value);
      void chrome.storage.local.set({ [sidebarKey(origin)]: value });
    },
    [origin],
  );

  const setHiddenStored = useCallback(
    (value: boolean) => {
      setHidden(value);
      if (value) setMode({ type: 'idle' });
      void chrome.storage.local.set({ [hiddenKey(origin)]: value });
    },
    [origin],
  );

  // ---------- messages from the background (toggle, live capture for Claude) ----------

  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const exitCapture = useRef<(() => void) | null>(null);

  useEffect(() => {
    const finish = () => {
      exitCapture.current?.();
      exitCapture.current = null;
      previews.suspend(false);
    };
    const onMessage = (req: TabRequest, _sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      if (req.type === 'toggle') {
        // Extension icon / Alt+Shift+R: show the overlay with the sidebar open.
        // When the sidebar is already showing, hide everything.
        if (hiddenRef.current || !sidebarOpenRef.current) {
          setHiddenStored(false);
          setSidebarStored(true);
        } else {
          setHiddenStored(true);
        }
        return false;
      }
      if (req.type === 'command') {
        // Shortcuts also bring the overlay back when it is hidden.
        if (hiddenRef.current) setHiddenStored(false);
        if (req.command === 'pick-element') {
          setMode((m) => (m.type === 'picking' && !m.held ? { type: 'idle' } : { type: 'picking' }));
        } else if (req.command === 'page-comment') {
          setMode({ type: 'compose', el: null, kind: 'comment' });
        } else {
          setSidebarStored(hiddenRef.current ? true : !sidebarOpenRef.current);
        }
        return false;
      }
      if (req.type === 'capture-done') {
        finish();
        return false;
      }
      if (req.type === 'show') {
        setHiddenStored(!req.visible);
        return false;
      }
      if (req.type === 'panel-state') {
        setPanel({ supported: true, open: req.open });
        if (req.open) setHint(null);
        return false;
      }
      if (req.type === 'hover') {
        setHoverId(req.id);
        return false;
      }
      if (req.type === 'go-to') {
        sendResponse({ note: goToRef.current(req.comment) } satisfies GoToResponse);
        return false;
      }
      if (req.type === 'prepare-capture') {
        void (async (): Promise<PrepareCaptureResponse> => {
          finish();
          // Claude wants to see what the code does now, so switch previews off.
          previews.suspend(true);
          const target = req.comment.target;
          const el = target ? findTarget(target) : null;
          let note: string | null = null;
          if (target && !el) {
            note =
              req.comment.kind === 'remove'
                ? 'The element was not found on the page, so it looks removed.'
                : 'The element was not found on the page with the stored selectors.';
          }
          if (el) {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            await nextFrames(3);
          }
          const { rect, exit } = await enterCapture(el);
          exitCapture.current = exit;
          setTimeout(finish, 10_000); // safety net
          return { rect, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, note };
        })().then(sendResponse);
        return true;
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [previews, setHiddenStored, setSidebarStored]);

  // ---------- hold a key (Left Alt by default) to pick, release to stop ----------

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [holdKey, setHoldKey] = useState<HoldKey>(DEFAULT_HOLD_KEY);
  useEffect(() => {
    void chrome.storage.local.get(HOLD_KEY).then((r) => setHoldKey(toHoldKey(r[HOLD_KEY])));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && HOLD_KEY in changes) setHoldKey(toHoldKey(changes[HOLD_KEY]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // Where the mouse is, so a picker started from the keyboard highlights at once.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    addEventListener('mousemove', onMove, { capture: true, passive: true });
    return () => removeEventListener('mousemove', onMove, { capture: true });
  }, []);

  useEffect(() => {
    if (holdKey === 'off') return;
    const isHeld = () => modeRef.current.type === 'picking' && modeRef.current.held === true;
    const stop = () => {
      if (isHeld()) setMode({ type: 'idle' });
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === holdKey) {
        if (e.repeat || hiddenRef.current || modeRef.current.type !== 'idle') return;
        setMode({ type: 'picking', held: true });
        return;
      }
      // Another key while holding it: a key combination (Alt+Shift+P, Alt+Tab), not
      // a hold, so stop again. The picker's own keys still work.
      if (isHeld() && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) setMode({ type: 'idle' });
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== holdKey) return;
      // Alt alone would otherwise focus the browser's menu (Firefox, Windows).
      if (isHeld()) e.preventDefault();
      stop();
    };
    // Alt+Tab and the like: the key comes up in another window, so stop here.
    const onBlur = () => stop();
    const opts = { capture: true };
    addEventListener('keydown', onDown, opts);
    addEventListener('keyup', onUp, opts);
    addEventListener('blur', onBlur);
    return () => {
      removeEventListener('keydown', onDown, opts);
      removeEventListener('keyup', onUp, opts);
      removeEventListener('blur', onBlur);
    };
  }, [holdKey]);

  // ---------- actions ----------

  const showHint = () => {
    setHint('Your browser only opens the side panel from the extension icon or Alt+Shift+T. Use one of those.');
    setTimeout(() => setHint(null), 6000);
  };

  const openPanel = (focus?: number) => {
    void bridge.openPanel(focus).then((ok) => {
      if (!ok) showHint();
    });
  };

  const openThread = (id: number) => {
    if (usePanel) {
      if (panel?.open) bridge.focusThread(id);
      else openPanel(id);
      return;
    }
    setFocusId(null);
    setSidebarStored(true);
    // set after a tick so the same id can be focused twice
    setTimeout(() => setFocusId(id), 0);
  };

  const toggleThreads = () => {
    if (!usePanel) setSidebarStored(!sidebarOpen);
    else if (panel?.open) bridge.closePanel();
    else openPanel();
  };

  /**
   * "Go to": on another page, navigate there (the element is shown after the load).
   * On this page, scroll to the element. When it is gone, the page itself is the
   * best we can do, so scroll to the top and say why. Returns that note.
   */
  const goTo = useCallback(
    (c: Comment): string | null => {
      if (c.path !== path) {
        sessionStorage.setItem(GOTO_KEY, String(c.id));
        location.href = c.url;
        return null;
      }
      if (!c.target) {
        scrollTo({ top: 0, behavior: 'smooth' });
        return null;
      }
      const el = findTarget(c.target);
      if (!el || el.getClientRects().length === 0) {
        scrollTo({ top: 0, behavior: 'smooth' });
        if (el && c.kind === 'remove') return 'The element is hidden by this removal.';
        return 'The element is not on the page anymore.';
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashId(c.id);
      setTimeout(() => setFlashId((f) => (f === c.id ? null : f)), 1600);
      return null;
    },
    [path],
  );
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Reopen the popover with what was being typed before the app reloaded.
  // The app may still be rendering, so look for the element for a few seconds.
  useEffect(() => {
    const draft = composerDraft.get();
    if (!draft || draft.path !== path) return;
    if (!draft.target) {
      setMode({ type: 'compose', el: null, kind: 'comment', draft });
      return;
    }
    const target = draft.target;
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      const el = findTarget(target);
      if (el) {
        setMode({ type: 'compose', el, kind: draft.kind, draft });
      } else if (tries++ < 15) {
        timer = window.setTimeout(attempt, 200);
      } else {
        setMode({
          type: 'compose',
          el: null,
          kind: 'comment',
          draft: { ...draft, kind: 'comment' },
          notice: `The element you picked (${target.tag}) is not on the page anymore, so this is now a page comment.`,
        });
      }
    };
    attempt();
    return () => clearTimeout(timer);
  }, []);

  // Finish a "Go to" from another page: open the thread and show the element.
  // The app may still be rendering, so try for a moment before giving up.
  useEffect(() => {
    const id = Number(sessionStorage.getItem(GOTO_KEY));
    if (!id) return;
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    sessionStorage.removeItem(GOTO_KEY);
    setHiddenStored(false);
    if (usePanel) bridge.focusThread(id);
    else openThread(id);
    let tries = 0;
    const attempt = () => {
      const visible = c.target ? findTarget(c.target)?.getClientRects().length : 0;
      if (visible || tries++ >= 10) goTo(c);
      else setTimeout(attempt, 200);
    };
    attempt();
  }, [comments]);

  const onCreated = async (c: Comment, open: boolean) => {
    await load();
    setMode({ type: 'idle' });
    // By default only the Threads count goes up; the composer's "Open thread"
    // box shows the new thread in the sidebar instead.
    if (open) openThread(c.id);
  };

  if (hidden) return null;

  const pinned = pageComments.filter((c) => c.target && c.status !== 'accepted' && !isPreviewActiveRemove(c));
  const outlined = pageComments.find((c) => c.id === (flashId ?? hoverId));
  const openCount = pageComments.filter((c) => c.status === 'open' || c.status === 'in_progress').length;
  const reviewCount = pageComments.filter((c) => c.status === 'review_ready').length;

  return (
    <>
      {/* Sidebar first: popovers, pins and the picker render on top of it. */}
      {!usePanel && panel !== null && sidebarOpen && (
        <Sidebar
          comments={comments}
          path={path}
          connected={connected}
          focusId={focusId}
          onClose={() => setSidebarStored(false)}
          onHover={setHoverId}
          onGoTo={goTo}
          onOpenPage={(c) => (location.href = c.url)}
          onChanged={load}
        />
      )}

      {mode.type !== 'picking' && <Pins comments={pinned} onOpen={openThread} onHover={setHoverId} />}
      {outlined?.target && mode.type === 'idle' && <Outline target={outlined.target} flash={flashId === outlined.id} />}

      {mode.type === 'picking' && (
        <Picker
          releaseKey={mode.held && holdKey !== 'off' ? HOLD_KEYS[holdKey] : null}
          start={pointer.current}
          onPick={(el) => setMode({ type: 'compose', el, kind: 'comment' })}
          onCancel={() => setMode({ type: 'idle' })}
        />
      )}
      {mode.type === 'compose' && (
        <Composer
          key={mode.el ? 'el' : 'page'}
          el={mode.el}
          initialKind={mode.kind}
          draft={mode.draft}
          notice={mode.notice}
          previews={previews}
          onCreated={onCreated}
          onCancel={() => setMode({ type: 'idle' })}
        />
      )}

      {hint && (
        <div class="brm-ui brm-toast" role="status">
          {hint}
        </div>
      )}
      <Toolbar
        connected={connected}
        picking={mode.type === 'picking'}
        openCount={openCount}
        reviewCount={reviewCount}
        sidebarOpen={usePanel ? panel.open : sidebarOpen}
        onPick={() => setMode(mode.type === 'picking' && !mode.held ? { type: 'idle' } : { type: 'picking' })}
        onPageComment={() => setMode({ type: 'compose', el: null, kind: 'comment' })}
        onToggleSidebar={toggleThreads}
        onHide={() => setHiddenStored(true)}
        onHelp={() => bridge.openHelp()}
      />
    </>
  );
}

/** A removed element is hidden by its own preview, so it gets no pin. */
function isPreviewActiveRemove(c: Comment): boolean {
  return c.kind === 'remove' && isPreviewActive(c);
}
