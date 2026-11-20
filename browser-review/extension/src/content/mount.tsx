// Mounts the overlay in a Shadow DOM, with the given host.
import { render } from 'preact';
import css from './styles.css';
import { App } from './App.tsx';
import { HOST_TAG } from './targets.ts';
import { initCapture } from './capture.ts';
import { brandTokens } from '@brm/shared';
import { HostContext, type Host } from './host.ts';
import { Previews } from './previews.ts';

/** Shadow DOM host, styles, key isolation, previews and <App> inside a HostContext. */
export function mountOverlay(host: Host): { previews: Previews; unmount(): void } {
  const el = document.createElement(HOST_TAG);
  el.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'brm-root';
  // A company's own colors (margin.js with brand.json on the hub); the extension never has one.
  for (const [role, value] of Object.entries(brandTokens(host.brand ?? { color: null, toolbar: null }))) {
    root.style.setProperty(`--brm-${role}`, value);
  }
  shadow.append(style, root);

  // Keys typed in our textareas must not trigger the app's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    root.addEventListener(type, (e) => e.stopPropagation());
  }

  document.documentElement.appendChild(el);
  initCapture(shadow);
  const previews = new Previews();
  render(
    <HostContext.Provider value={host}>
      <App previews={previews} />
    </HostContext.Provider>,
    root,
  );

  const takeDown = () => {
    clearInterval(watch);
    render(null, root);
    previews.destroy();
  };

  // Host gone (the extension was reloaded or updated): this copy can't reach it
  // anymore. Take the overlay and the previews down (no dead buttons that throw),
  // and say how to get it back. Browsers don't put the new version into open tabs by themselves.
  const watch = setInterval(() => {
    if (host.alive()) return;
    takeDown();
    const note = document.createElement('div');
    note.className = 'brm-ui brm-toast brm-reload-note';
    note.setAttribute('role', 'status');
    note.textContent = 'Margin Browser Review was reloaded. Reload this page to use it again. ';
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

  return {
    previews,
    unmount() {
      takeDown();
      el.remove();
    },
  };
}
