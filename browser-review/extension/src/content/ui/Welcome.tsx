// The first thing a customer sees on staging: who it's from, what to do (with a
// small looping animation per step, in the company's colors), the pages the team
// asks them to look at, and the keys. Shown once; "?" in the toolbar shows it again.
import { useEffect, useRef } from 'preact/hooks';
import { useHost } from '../host.ts';
import { BrandMark } from './BrandMark.tsx';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const ALT = isMac ? '⌥ Option' : 'Alt';
const MAX_FOCUS_SHOWN = 6;

function Keys({ k, shift = true }: { k: string; shift?: boolean }) {
  return (
    <span class="brm-keys">
      <kbd>{ALT}</kbd>+
      {shift && (
        <>
          <kbd>Shift</kbd>+
        </>
      )}
      <kbd>{k}</kbd>
    </span>
  );
}

/** "Anna (client)" -> "Anna". */
function firstName(name: string | null | undefined): string | null {
  const n = name?.trim().split(/[\s(]/)[0];
  return n ? n : null;
}

const Cursor = () => (
  <svg class="brm-demo-cursor" viewBox="0 0 12 16" aria-hidden="true">
    <path d="M1 1v12l3.2-3 2.3 5 2-1-2.3-4.8H10z" />
  </svg>
);

/** A tiny page with the toolbar, acting out one step. Pure CSS animation, paused for reduced motion. */
function Demo({ kind }: { kind: 'pick' | 'page' | 'comments' | 'map' }) {
  return (
    <div class={`brm-demo brm-demo-${kind}`} aria-hidden="true">
      <div class="brm-demo-site">
        <i class="brm-demo-nav" />
        <i class="brm-demo-h" />
        <i class="brm-demo-line" />
        <i class="brm-demo-line brm-demo-short" />
      </div>
      {kind === 'pick' && (
        <>
          <i class="brm-demo-outline" />
          <i class="brm-demo-pop">
            <i class="brm-demo-type" />
            <i class="brm-demo-send" />
          </i>
          <i class="brm-demo-pin">1</i>
        </>
      )}
      {kind === 'page' && (
        <>
          <i class="brm-demo-pop brm-demo-pop-page">
            <i class="brm-demo-type" />
            <i class="brm-demo-send" />
          </i>
          <i class="brm-demo-bar">
            <i class="brm-demo-btn" />
            <i class="brm-demo-count">1</i>
          </i>
        </>
      )}
      {kind === 'comments' && (
        <i class="brm-demo-side">
          <i class="brm-demo-msg" />
          <i class="brm-demo-msg brm-demo-reply" />
          <i class="brm-demo-status" />
          <i class="brm-demo-accept" />
        </i>
      )}
      {kind === 'map' && (
        <i class="brm-demo-map">
          <i class="brm-demo-row" />
          <i class="brm-demo-row brm-demo-child" />
          <i class="brm-demo-row brm-demo-child" />
          <i class="brm-demo-row" />
        </i>
      )}
      <Cursor />
    </div>
  );
}

export function Welcome({ onStart }: { onStart: () => void }) {
  const host = useHost();
  const name = firstName(host.me);
  const team = host.brand?.name ?? null;
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Start at the top ("Hi Milan!"), with the start button ready for Enter: focusing it must not scroll down to it.
  useEffect(() => {
    button.current?.focus({ preventScroll: true });
    box.current?.scrollTo(0, 0);
  }, []);
  const intro = host.welcome
    ? host.welcome.replaceAll('{name}', name ?? '')
    : `Thanks for looking at the staging preview${host.project ? ` of ${host.project}` : ''}. ${team ?? 'We'} would love your feedback on what to change: anything that looks off, reads wrong or doesn't work.`;
  const focus = host.focusPages ?? [];
  return (
    <div class="brm-ui brm-welcome-back" role="dialog" aria-modal="true" aria-labelledby="brm-welcome-title">
      <div class="brm-welcome" ref={box}>
        <div class="brm-welcome-head">
          <BrandMark />
          <h2 id="brm-welcome-title">Hi{name ? ` ${name}` : ''}!</h2>
        </div>
        <p class="brm-welcome-intro">{intro}</p>

        {focus.length > 0 && (
          <div class="brm-welcome-focus">
            <strong>Please have a look at</strong>
            <ul>
              {focus.slice(0, MAX_FOCUS_SHOWN).map((f) => (
                <li key={f.path}>
                  <a href={f.path} onClick={onStart}>
                    {f.path}
                  </a>
                  {f.note && <span class="brm-dim"> {f.note}</span>}
                </li>
              ))}
            </ul>
            {focus.length > MAX_FOCUS_SHOWN && <span class="brm-dim">and {focus.length - MAX_FOCUS_SHOWN} more in the Overview.</span>}
          </div>
        )}

        <ol class="brm-welcome-steps">
          <li>
            <Demo kind="pick" />
            <div>
              <strong>Pick element</strong> <Keys k="P" />
              <p>Click the part you mean, write what should change, and press <strong>Add comment</strong>. Or choose <strong>Remove</strong> if it should go.</p>
            </div>
          </li>
          <li>
            <Demo kind="page" />
            <div>
              <strong>Page comment</strong> <Keys k="C" />
              <p>Feedback about the page as a whole.</p>
            </div>
          </li>
          <li>
            <Demo kind="comments" />
            <div>
              <strong>Comments</strong> <Keys k="C" shift={false} />
              <p>
                Everything you said, with the replies. When something is fixed you <strong>accept</strong> it, or say what is
                still wrong.
              </p>
            </div>
          </li>
          <li>
            <Demo kind="map" />
            <div>
              <strong>Overview</strong>
              <p>
                Every page you looked at, and what you said where, on a map of the site. Keep it open on a second screen:
                it follows along. <strong>Export PDF</strong> saves it.
              </p>
            </div>
          </li>
        </ol>
        <p class="brm-welcome-note">
          A screenshot goes with each comment, so no need to describe where it is.{' '}
          {host.share ? 'Everyone reviewing sees each other’s comments.' : `Only you and ${team ?? 'the team'} see your comments.`}{' '}
          <Keys k="R" /> hides or shows the toolbar.
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
