import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  connected: boolean;
  picking: boolean;
  openCount: number;
  reviewCount: number;
  sidebarOpen: boolean;
  onPageComment: () => void;
  onPick: () => void;
  onToggleSidebar: () => void;
  onHide: () => void;
  onHelp: () => void;
}

/** Adds "is-bumped" for a moment whenever n goes up. */
function useBump(n: number): boolean {
  const prev = useRef(n);
  const [bumped, setBumped] = useState(false);
  useEffect(() => {
    if (n > prev.current) {
      setBumped(true);
      const t = setTimeout(() => setBumped(false), 650);
      prev.current = n;
      return () => clearTimeout(t);
    }
    prev.current = n;
  }, [n]);
  return bumped;
}

export function Toolbar(p: Props) {
  const openBumped = useBump(p.openCount);
  return (
    <div class="brm-ui brm-toolbar" role="toolbar" aria-label="Browser Review">
      <span
        class={`brm-dot ${p.connected ? 'is-on' : 'is-off'}`}
        title={
          p.connected
            ? 'Claude Code is connected'
            : 'Claude Code is not connected. Your comments are saved; Claude sees them when a session with browser-review runs. Click ? for setup.'
        }
      />
      <button class={`brm-tool ${p.picking ? 'is-active' : ''}`} onClick={p.onPick} title="Pick an element to comment on, remove or edit (Alt+Shift+P)">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 2l9 4.5-4 1.2L6.8 12z" />
        </svg>
        Pick element
      </button>
      <button class="brm-tool" onClick={p.onPageComment} title="Comment on the whole page (Alt+Shift+C)">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 3h11v7.5h-6L4.5 13v-2.5h-2z" />
        </svg>
        Page comment
      </button>
      <button class={`brm-tool ${p.sidebarOpen ? 'is-active' : ''}`} onClick={p.onToggleSidebar} title="Open or close the threads (Alt+Shift+T)">
        Threads
        {p.openCount > 0 && <span class={`brm-count ${openBumped ? 'is-bumped' : ''}`}>{p.openCount}</span>}
        {p.reviewCount > 0 && <span class="brm-count st-review_ready" title="Review ready">{p.reviewCount}</span>}
      </button>
      <button class="brm-icon-btn" onClick={p.onHelp} title="Help: setup and how to use">
        ?
      </button>
      <button class="brm-icon-btn" onClick={p.onHide} title="Hide the overlay (Alt+Shift+R or the extension icon brings it back)">
        ✕
      </button>
    </div>
  );
}
