// GitHub's side menu (the ☰ button, top left) lists "Top repositories". This
// swaps that list for your recently pushed repositories, on every page.
//
// The menu is GitHub's React UI. Its own items stay in the DOM (hidden with
// CSS, so React keeps working); ours are copies of its first item with another
// link, name and avatar, so they look native.
import type { Repo } from './github.ts';

const ITEM = '[data-testid="dynamic-side-panel-items-item"]';
const OURS = 'hb-sp-item';

interface Options {
  enabled: () => boolean;
  /** The repositories to show, or null when not known yet. */
  items: () => Repo[] | null;
  /** Called when the menu opens and there is nothing to show yet. */
  request: () => void;
}

export function watchSidePanel(options: Options): { update: () => void } {
  let queued = false;
  const update = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply(options);
    });
  };
  // <html>, not <body>: GitHub's Turbo navigation replaces <body>.
  new MutationObserver(update).observe(document.documentElement, { childList: true, subtree: true });
  return { update };
}

function apply({ enabled, items, request }: Options): void {
  const groups = new Set<HTMLElement>();
  for (const a of document.querySelectorAll<HTMLElement>(ITEM)) {
    const group = a.closest<HTMLElement>('li[class*="ActionList-Group"]');
    if (group) groups.add(group);
  }
  for (const group of document.querySelectorAll<HTMLElement>('[data-hb-recent]')) groups.add(group);

  for (const group of groups) {
    const repos = enabled() ? items() : null;
    if (enabled() && !repos) request();
    if (!repos?.length) {
      restore(group);
      continue;
    }
    const signature = repos.map((r) => r.fullName).join(',');
    if (group.dataset.hbRecent === signature && group.querySelector(`.${OURS}`)) continue;
    replace(group, repos, signature);
  }
}

function replace(group: HTMLElement, repos: Repo[], signature: string): void {
  const template = group.querySelector<HTMLElement>(`ul > li:not(.${OURS}):has(> a${ITEM})`);
  const list = template?.parentElement;
  if (!template || !list) return;

  for (const old of group.querySelectorAll(`.${OURS}`)) old.remove();
  const before = list.querySelector(`:scope > li:not(.${OURS})`);
  for (const repo of repos) list.insertBefore(itemFor(template, repo), before);

  const heading = group.querySelector('h3');
  const label = heading?.querySelector(':scope > span');
  if (heading && label) {
    if (!heading.dataset.hbLabel) heading.dataset.hbLabel = label.textContent ?? '';
    label.textContent = 'Recently pushed';
    heading.setAttribute('aria-label', 'Recently pushed');
  }
  group.dataset.hbRecent = signature;
}

function itemFor(template: HTMLElement, repo: Repo): HTMLElement {
  const li = template.cloneNode(true) as HTMLElement;
  li.classList.add(OURS);
  // Unique ids and test ids belong to GitHub's own items.
  for (const el of [li, ...li.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('id');
    el.removeAttribute('aria-labelledby');
    el.removeAttribute('data-testid');
  }
  const a = li.querySelector('a');
  if (a) {
    a.href = `/${repo.fullName}`;
    a.title = repo.fullName;
  }
  const name = li.querySelector('[data-component="ActionList.Item.Label"]');
  if (name) name.textContent = repo.fullName;
  const img = li.querySelector('img');
  if (img) img.src = `https://github.com/${encodeURIComponent(repo.owner)}.png?size=32`;
  return li;
}

function restore(group: HTMLElement): void {
  if (!group.dataset.hbRecent) return;
  for (const old of group.querySelectorAll(`.${OURS}`)) old.remove();
  const heading = group.querySelector<HTMLElement>('h3');
  const label = heading?.querySelector(':scope > span');
  if (heading?.dataset.hbLabel && label) {
    label.textContent = heading.dataset.hbLabel;
    heading.setAttribute('aria-label', heading.dataset.hbLabel);
  }
  delete group.dataset.hbRecent;
}
