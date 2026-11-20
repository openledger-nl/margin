// The popover to write a comment, remove an element, or edit it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { pageKey, type Change, type Comment, type Kind, type TextChange } from '@brm/shared';
import { bridge } from '../bridge.ts';
import { withCapture } from '../capture.ts';
import { textNodesOf, type Previews } from '../previews.ts';
import { buildTarget, describe, probeReact, textOf } from '../targets.ts';
import { useSendKey, useTrackedRect } from '../hooks.ts';
import { isSendKey, sendKeyName } from '../../settings.ts';
import { composerDraft, type ComposerDraft } from '../drafts.ts';
import { px } from '../px.ts';

interface Props {
  el: Element | null;
  initialKind: Kind;
  /** Restored after a reload of the app. */
  draft?: ComposerDraft;
  /** Shown above the form, e.g. when a restored element could not be found. */
  notice?: string;
  previews: Previews;
  /** `openThread`: the user wants to see the new thread in the sidebar. */
  onCreated: (c: Comment, openThread: boolean) => Promise<void>;
  onCancel: () => void;
}

const WIDTH = 340;
/** Height the user dragged the popover to, shared by all sites. */
const HEIGHT_KEY = 'composerHeight';
const MIN_HEIGHT = 180;
/** Open the thread in the sidebar after sending. Off: only the Threads count goes up. */
const OPEN_THREAD_KEY = 'openThreadAfterSend';

export function Composer({ el, initialKind, draft, notice, previews, onCreated, onCancel }: Props) {
  const [kind, setKind] = useState<Kind>(el ? (draft?.kind ?? initialKind) : 'comment');
  const [body, setBody] = useState(draft?.body ?? '');
  const textNodes = useMemo(() => (el ? textNodesOf(el) : []), [el]);
  const originals = useMemo(() => textNodes.map((n) => n.nodeValue ?? ''), [textNodes]);
  const [texts, setTexts] = useState<string[]>(() =>
    draft && draft.texts.length === originals.length ? draft.texts : originals,
  );
  const [css, setCss] = useState(draft?.css ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const sendKey = useSendKey();
  const [openThread, setOpenThread] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get(OPEN_THREAD_KEY).then((r) => setOpenThread(r[OPEN_THREAD_KEY] === true));
  }, []);
  const toggleOpenThread = (value: boolean) => {
    setOpenThread(value);
    void chrome.storage.local.set({ [OPEN_THREAD_KEY]: value });
  };

  const textChanges = useMemo<TextChange[]>(
    () =>
      texts
        .map((after, index) => ({ index, before: originals[index] ?? '', after }))
        .filter((t) => t.before !== t.after),
    [texts, originals],
  );

  const change = useMemo<Change | null>(() => {
    if (kind === 'remove') return { kind: 'remove' };
    if (kind === 'edit') return { kind: 'edit', texts: textChanges, css };
    return null;
  }, [kind, textChanges, css]);

  // Live preview while composing.
  useEffect(() => {
    if (el && change) previews.setDraft(el, change);
    else previews.clearDraft();
  }, [el, change, previews]);
  useEffect(() => () => previews.clearDraft(), [previews]);

  useEffect(() => {
    bodyRef.current?.focus();
  }, [kind]);

  // Keep what was typed so it survives a reload of the app. A reload never
  // unmounts us, so clearing on unmount only happens on save, cancel or close.
  const draftTarget = useMemo(() => (el ? buildTarget(el) : null), [el]);
  useEffect(() => {
    const typed = body.trim() || css.trim() || textChanges.length > 0 || kind !== 'comment';
    composerDraft.set(
      typed ? { path: pageKey(location.href).path, target: draftTarget, kind, body, texts, css } : null,
    );
  }, [kind, body, texts, css, textChanges, draftTarget]);
  useEffect(() => () => composerDraft.set(null), []);

  const resolve = useMemo(() => (el ? () => el : null), [el]);
  const tracked = useTrackedRect(kind === 'remove' ? null : resolve);
  // When the element is hidden (remove preview) keep the last known spot.
  const anchor = useRef(el?.getBoundingClientRect() ?? null);
  if (tracked) anchor.current = new DOMRect(tracked.x, tracked.y, tracked.width, tracked.height);

  const label = useMemo(() => {
    if (!el) return 'Whole page';
    const comp = probeReact(el).components.at(-1);
    const d = describe(el.tagName.toLowerCase(), textOf(el, 40), el.getAttribute('class') ?? '');
    return comp ? `${comp}  ${d}` : d;
  }, [el]);

  async function save() {
    if (saving) return;
    if (kind === 'comment' && !body.trim()) return setError('Write a comment first.');
    if (kind === 'edit' && textChanges.length === 0 && !css.trim()) return setError('Change a text or add some CSS first.');
    setSaving(true);
    setError(null);
    try {
      // Screenshot and target info from the original, unchanged element.
      previews.clearDraft();
      const target = el ? buildTarget(el) : null;
      const screenshots = await withCapture(el, (rect) => bridge.capture(rect));
      if (el && change) previews.setDraft(el, change);
      const created = await bridge.createComment({
        kind,
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        target,
        change,
        body,
        screenshots,
      });
      await onCreated(created, openThread);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (isSendKey(e, sendKey)) {
      e.preventDefault();
      void save();
    }
  }

  // ---------- size: the user can drag it taller (or shorter); we remember that ----------

  const cardRef = useRef<HTMLDivElement>(null);
  const [userHeight, setUserHeight] = useState<number | null>(null);
  const userHeightRef = useRef(userHeight);
  userHeightRef.current = userHeight;
  useEffect(() => {
    void chrome.storage.local.get(HEIGHT_KEY).then((r) => {
      const h = r[HEIGHT_KEY];
      if (typeof h === 'number' && h >= MIN_HEIGHT) setUserHeight(h);
    });
  }, []);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let timer = 0;
    // The browser writes an inline height while the resize handle is dragged.
    const ro = new ResizeObserver(() => {
      const dragged = parseFloat(card.style.height);
      if (!dragged || Math.abs(dragged - (userHeightRef.current ?? 0)) < 1) return;
      userHeightRef.current = dragged;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        setUserHeight(dragged);
        void chrome.storage.local.set({ [HEIGHT_KEY]: Math.round(dragged) });
      }, 200);
    });
    ro.observe(card);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);
  // Height used to decide where it goes. Measured once, then fixed, so resizing
  // only moves the bottom edge (the handle stays under the mouse).
  const placeHeight = useRef<number | null>(null);
  const [, relayout] = useState(0);
  useLayoutEffect(() => {
    if (placeHeight.current === null && cardRef.current) {
      placeHeight.current = cardRef.current.offsetHeight;
      relayout((n) => n + 1);
    }
  });

  // Place below the element, or above when there is no room, inside the viewport.
  // Always positioned from the top, so the resize handle grows it downward.
  const style = useMemo(() => {
    const h = Math.max(MIN_HEIGHT, userHeight ?? placeHeight.current ?? 260);
    const r = anchor.current;
    let left: number | undefined;
    let right: number | undefined;
    let top: number;
    if (!r) {
      right = 16;
      top = Math.max(8, innerHeight - 72 - h);
    } else {
      left = Math.max(8, Math.min(innerWidth - WIDTH - 8, r.left));
      const below = r.bottom + 10;
      const above = r.top - 10 - h;
      if (below + h < innerHeight - 8) top = below;
      else if (above >= 8) top = above;
      else top = Math.max(8, innerHeight / 2 - h / 2);
    }
    return px({
      left,
      right,
      top,
      width: WIDTH,
      height: userHeight ?? undefined,
      maxHeight: Math.max(MIN_HEIGHT, innerHeight - top - 8),
    });
  }, [tracked?.x, tracked?.y, tracked?.width, tracked?.height, userHeight, placeHeight.current]);

  return (
    <>
      {tracked && kind !== 'remove' && (
        <div class="brm-selected" style={px({ left: tracked.x, top: tracked.y, width: tracked.width, height: tracked.height })} />
      )}
      <div
        ref={cardRef}
        class={`brm-ui brm-card brm-composer ${el ? '' : 'is-page'}`}
        style={style}
        onKeyDown={onKeyDown}
      >
        <div class="brm-composer-head">
          <span class="brm-target-label" title={label}>
            {label}
          </span>
          <button class="brm-icon-btn" title="Cancel (Esc)" onClick={onCancel}>
            ✕
          </button>
        </div>
        {el && (
          <div class="brm-tabs" role="tablist">
            {(['comment', 'remove', 'edit'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                class={`brm-tab ${kind === k ? 'is-active' : ''}`}
                aria-selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setError(null);
                }}
              >
                {k === 'comment' ? 'Comment' : k === 'remove' ? 'Remove' : 'Edit'}
              </button>
            ))}
          </div>
        )}

        {notice && <p class="brm-note">{notice}</p>}

        {kind === 'remove' && (
          <p class="brm-help">The element is hidden now. Claude removes it in the code. You can undo this in the sidebar.</p>
        )}

        {kind === 'edit' && (
          <div class="brm-edit">
            {textNodes.length === 0 && <p class="brm-help">This element has no text. You can still add CSS.</p>}
            {texts.map((t, i) => (
              <label key={i} class="brm-field">
                <span class="brm-field-label">Text {texts.length > 1 ? i + 1 : ''}</span>
                <textarea
                  rows={Math.min(4, Math.max(1, Math.ceil(t.length / 40)))}
                  value={t}
                  onInput={(e) => {
                    const v = (e.target as HTMLTextAreaElement).value;
                    setTexts((prev) => prev.map((p, j) => (j === i ? v : p)));
                  }}
                />
              </label>
            ))}
            <label class="brm-field">
              <span class="brm-field-label">CSS</span>
              <textarea
                rows={2}
                class="brm-mono"
                placeholder="color: #333; font-size: 14px; margin-top: 8px"
                value={css}
                onInput={(e) => setCss((e.target as HTMLTextAreaElement).value)}
              />
            </label>
          </div>
        )}

        <label class="brm-field brm-grow">
          <span class="brm-field-label">
            {kind === 'comment' ? 'Comment' : kind === 'remove' ? 'Why? (optional)' : 'Note (optional)'}
          </span>
          <textarea
            ref={bodyRef}
            rows={3}
            value={body}
            placeholder={kind === 'comment' ? (el ? 'What should change here?' : 'What should change on this page?') : ''}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        {error && <p class="brm-error">{error}</p>}

        <div class="brm-actions">
          <label class="brm-check" title="Show the new thread in the sidebar after sending">
            <input type="checkbox" checked={openThread} onChange={(e) => toggleOpenThread((e.target as HTMLInputElement).checked)} />
            Open thread
          </label>
          <button class="brm-btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button class="brm-btn brm-primary" title={sendKeyName(sendKey)} onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving' : kind === 'comment' ? 'Add comment' : kind === 'remove' ? 'Remove element' : 'Save edit'}
          </button>
        </div>
      </div>
    </>
  );
}
