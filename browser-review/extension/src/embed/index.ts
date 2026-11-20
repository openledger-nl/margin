// margin.js: the review overlay on a staging site, for customers.
//
//   <script src="/__margin/margin.js" defer></script>
//
// Does nothing for normal visitors. A customer opens their review link
// (?review_token=mrev_…): the token is kept in localStorage and removed from the
// address bar, and the overlay shows, talking to the margin review hub the
// script was loaded from (or data-hub="https://…/__margin/").
import '../main-world.ts';
import { HOST_TAG, REVIEW_ATTR } from '../content/targets.ts';
import { mountOverlay } from '../content/mount.tsx';
import { capturePage } from './capture.ts';
import { createWebHost } from './web-host.ts';

const TOKEN_PARAM = 'review_token';
const TOKEN_KEY = 'margin:review_token';
const TOKEN_SHAPE = /^mrev_[A-Za-z0-9_-]{20,100}$/;

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** The token from the link (then removed from the address bar), or the one kept from before. */
function takeToken(): string | null {
  const url = new URL(location.href);
  const fromLink = url.searchParams.get(TOKEN_PARAM);
  if (fromLink !== null) {
    url.searchParams.delete(TOKEN_PARAM);
    history.replaceState(history.state, '', url);
    if (TOKEN_SHAPE.test(fromLink)) {
      try {
        storage()?.setItem(TOKEN_KEY, fromLink);
      } catch {
        // blocked: works for this page view only
      }
      return fromLink;
    }
  }
  const kept = storage()?.getItem(TOKEN_KEY) ?? null;
  return kept && TOKEN_SHAPE.test(kept) ? kept : null;
}

function hubUrl(script: HTMLScriptElement | null): string | null {
  const given = script?.dataset.hub;
  try {
    if (given) return new URL(given.endsWith('/') ? given : `${given}/`, location.href).href;
    if (script?.src) return new URL('.', script.src).href;
  } catch {
    // bad data-hub
  }
  return null;
}

function toast(text: string): void {
  const note = document.createElement('div');
  note.setAttribute('role', 'status');
  note.textContent = text;
  note.style.cssText =
    'all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 360px; padding: 10px 14px;' +
    'border-radius: 8px; background: #1f1f24; color: #fff; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25);';
  document.documentElement.append(note);
  setTimeout(() => note.remove(), 8000);
}

async function main(script: HTMLScriptElement | null, token: string): Promise<void> {
  // The Margin extension already shows its overlay here (a developer on staging).
  if (document.querySelector(HOST_TAG)) return;
  const hub = hubUrl(script);
  if (!hub) {
    console.warn('[margin] Could not tell where the review hub is. Load margin.js from the hub, or add data-hub="https://…/__margin/".');
    return;
  }

  let overlay: { unmount(): void } | null = null;
  const host = createWebHost({
    hubUrl: hub,
    token,
    capture: capturePage,
    onUnauthorized(message) {
      try {
        storage()?.removeItem(TOKEN_KEY);
      } catch {
        // nothing to remove
      }
      overlay?.unmount();
      overlay = null;
      toast(`${message} Ask for a new review link.`);
    },
  });
  // Checks the token (and learns our name) before showing anything.
  // Offline: show it anyway, it says so and catches up when the hub is back.
  if ((await host.start()) === 'unauthorized') return; // onUnauthorized already said why
  if (document.querySelector(HOST_TAG)) return;
  overlay = mountOverlay(host);
}

// currentScript is only set while the script first runs, so read it now.
const script = document.currentScript as HTMLScriptElement | null;
const token = takeToken();
if (token) {
  // Before the extension's overlay loads (document_idle): this tab is a review, so it stays out.
  document.documentElement.setAttribute(REVIEW_ATTR, '');
  const run = () => void main(script, token);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}
