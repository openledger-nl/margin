// Content script entry: mounts the overlay in a Shadow DOM on the pages it may run on (sites.ts).
import { render } from 'preact';
import css from './styles.css';
import { App } from './App.tsx';
import { HOST_TAG } from './targets.ts';
import { extensionAlive } from './bridge.ts';
import { initCapture } from './capture.ts';
import { Previews } from './previews.ts';

function mount(): void {
  if (document.querySelector(HOST_TAG)) return; // already injected (extension reloaded)
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'brm-root';
  shadow.append(style, root);

  // Keys typed in our textareas must not trigger the app's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  document.documentElement.appendChild(host);
  initCapture(shadow);
  const previews = new Previews();
  render(<App previews={previews} />, root);

  // Extension reloaded or updated: this copy can't reach it anymore. Take the
  // overlay and the previews down (no dead buttons that throw), and say how to
  // get it back. Browsers don't put the new version into open tabs by themselves.
  const watch = setInterval(() => {
    if (extensionAlive()) return;
    clearInterval(watch);
    render(null, root);
    previews.destroy();
    const note = document.createElement('div');
    note.className = 'brm-ui brm-toast brm-reload-note';
    note.setAttribute('role', 'status');
    note.textContent = 'Browser Review was reloaded. Reload this page to use it again. ';
    const button = document.createElement('button');
    button.className = 'brm-btn brm-primary';
    button.textContent = 'Reload page';
    button.addEventListener('click', () => location.reload());
    const close = document.createElement('button');
    close.className = 'brm-btn';
    close.textContent = 'Dismiss';
    close.addEventListener('click', () => note.remove());
    note.append(button, ' ', close);
    root.append(note);
  }, 1000);
}

mount();
