// The first thing a customer sees on staging: who it's from, what to do, and the
// keys. Shown once (remembered in this browser); "?" in the toolbar shows it again.
import { useEffect, useRef } from 'preact/hooks';
import { useHost } from '../host.ts';
import { Mark } from './Mark.tsx';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const ALT = isMac ? '⌥ Option' : 'Alt';

function Keys({ k, shift = true }: { k: string; shift?: boolean }) {
  return (
    <span class="brm-keys">
      <kbd>{ALT}</kbd>+{shift && (<><kbd>Shift</kbd>+</>)}<kbd>{k}</kbd>
    </span>
  );
}

/** "Anna (client)" -> "Anna". */
function firstName(name: string | null | undefined): string | null {
  const n = name?.trim().split(/[\s(]/)[0];
  return n ? n : null;
}

export function Welcome({ onStart }: { onStart: () => void }) {
  const host = useHost();
  const name = firstName(host.me);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  const intro = host.welcome
    ? host.welcome.replaceAll('{name}', name ?? '')
    : `Thanks for looking at the staging preview${host.project ? ` of ${host.project}` : ''}. We'd love your feedback on what to change: anything that looks off, reads wrong or doesn't work.`;
  return (
    <div class="brm-ui brm-welcome-back" role="dialog" aria-modal="true" aria-labelledby="brm-welcome-title">
      <div class="brm-welcome">
        <div class="brm-welcome-head">
          <Mark />
          <h2 id="brm-welcome-title">Hi{name ? ` ${name}` : ''}!</h2>
        </div>
        <p class="brm-welcome-intro">{intro}</p>
        <ol class="brm-welcome-steps">
          <li>
            <strong>Pick element</strong> <Keys k="P" />: click the part you mean, write what should change, and press{' '}
            <strong>Add comment</strong>. Or choose <strong>Remove</strong> if it should go.
          </li>
          <li>
            <strong>Page comment</strong> <Keys k="C" />: feedback about the page as a whole.
          </li>
          <li>
            <strong>Comments</strong> <Keys k="C" shift={false} />: everything you said, with the replies. When something is fixed you
            <strong> accept</strong> it, or say what is still wrong.
          </li>
        </ol>
        <p class="brm-welcome-note">
          A screenshot goes with each comment, so no need to describe where it is. <Keys k="R" /> hides or shows the
          toolbar.
        </p>
        <div class="brm-welcome-actions">
          <button ref={button} class="brm-btn brm-primary brm-welcome-start" onClick={onStart}>
            Start giving feedback
          </button>
        </div>
      </div>
    </div>
  );
}
