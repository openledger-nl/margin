// A confirm dialog in the Margin look, instead of the browser's confirm(): a native
// <dialog> (top layer, Esc cancels), opened right at the button that asked, with
// its own button exactly where that one was. So: click Delete twice, or Delete then
// Enter. Esc or a click elsewhere cancels.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export interface ConfirmProps {
  title: string;
  children?: ComponentChildren;
  /** "Delete comment". */
  confirmLabel: string;
  /** Red: it can't be undone. */
  danger?: boolean;
  /** The button that opened it: the confirm button lands on top of it. */
  anchor?: HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const MARGIN = 8;

export function Confirm({ title, children, confirmLabel, danger = false, anchor, onConfirm, onCancel }: ConfirmProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ok = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const d = dialog.current;
    const button = ok.current;
    if (!d || !button) return;
    // The compact, anchored size first, then measure.
    if (anchor) d.classList.add('is-anchored');
    if (!d.open) d.showModal();
    if (anchor) {
      // Put the confirm button's center on the anchor's center, kept inside the window.
      const a = anchor.getBoundingClientRect();
      const box = d.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const left = a.left + a.width / 2 - (b.left - box.left + b.width / 2);
      const top = a.top + a.height / 2 - (b.top - box.top + b.height / 2);
      d.style.left = `${Math.round(Math.min(Math.max(MARGIN, left), innerWidth - box.width - MARGIN))}px`;
      d.style.top = `${Math.round(Math.min(Math.max(MARGIN, top), innerHeight - box.height - MARGIN))}px`;
    }
    // Enter confirms: the confirm button has the focus.
    button.focus();
    return () => d.open && d.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      class="brm-ui brm-confirm"
      aria-labelledby="brm-confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => e.target === dialog.current && onCancel()}
    >
      <div class={`brm-confirm-box ${danger ? 'is-danger' : ''}`}>
        <h2 id="brm-confirm-title">{title}</h2>
        {children && <div class="brm-confirm-body">{children}</div>}
        <div class="brm-confirm-actions">
          <button class="brm-btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={ok} class={`brm-btn ${danger ? 'brm-danger-solid' : 'brm-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
        <p class="brm-confirm-hint">
          <kbd>Enter</kbd> or click again · <kbd>Esc</kbd> cancels
        </p>
      </div>
    </dialog>
  );
}
