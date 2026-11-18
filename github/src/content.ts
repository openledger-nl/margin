// Content script on github.com, from document_start.
//  - Applies the declutter tweaks on every page.
//  - On the homepage (signed in), hides GitHub's feed and shows Margin.
//  - In GitHub's side menu (☰), shows your recent pushes (src/sidepanel.ts).
//
// GitHub navigates without page loads (Turbo and React), so the route is
// checked on its navigation events and on a short timer.
import { h, render } from 'preact';
import { readCache, writeCache } from './cache.ts';
import { type HomeData, describeError, fetchHome, fetchMyPushes, recentItems, withOrgRepos } from './github.ts';
import { DEFAULT_SETTINGS, type Settings, loadSettings, onSettingsChange, saveSettings } from './settings.ts';
import { watchSidePanel } from './sidepanel.ts';
import { tweakCss } from './tweaks.ts';
import { Home, type HomeState } from './ui/Home.tsx';

/** Data younger than this is shown as it is; older data is shown and refreshed. */
const MAX_AGE = 2 * 60_000;

const html = document.documentElement;
let settings: Settings = DEFAULT_SETTINGS;
let settingsLoaded = false;
let state: HomeState | null = null;
let root: HTMLElement | null = null;
/** Data for the side menu on pages other than the homepage (cache, or fetched once). */
let sideData: HomeData | null = null;
let sideRequested = false;

// The tweaks live in a <style> on <html> itself: Turbo replaces <body> and
// merges <head>, but leaves this alone.
const tweakStyle = document.createElement('style');
tweakStyle.id = 'hb-tweaks';
html.append(tweakStyle);

const sidePanel = watchSidePanel({
  enabled: () => settingsLoaded && settings.sideMenuRecent,
  items: () => {
    const data = state?.data ?? sideData;
    return data && recentItems(data, settings.recentCount).map((item) => item.repo);
  },
  request: () => void loadSideData(),
});

const isHomePath = () => location.pathname === '/' || location.pathname === '/dashboard';

// Hide GitHub's feed until Margin is up, so it does not flash. Only when
// signed in (GitHub's own cookie), and never for long.
if (isHomePath() && /(?:^|;\s*)logged_in=yes(?:;|$)/.test(document.cookie)) {
  html.classList.add('hb-pending');
  setTimeout(() => html.classList.remove('hb-pending'), 3000);
}

void loadSettings().then((s) => {
  applySettings(s);
  settingsLoaded = true;
  if (!s.replaceHome) html.classList.remove('hb-pending');
  tick();
});

onSettingsChange((s) => {
  // More recent pushes than were looked up: look again.
  const more = s.recentCount > settings.recentCount;
  applySettings(s);
  tick();
  draw();
  if (more) void refresh(true);
});

/** The side menu opened before any data was loaded on this page: use the cache, refresh when stale. */
async function loadSideData(): Promise<void> {
  const login = currentLogin();
  if (sideRequested || !login) return;
  sideRequested = true;
  sideData = await readCache(login);
  sidePanel.update();
  if (sideData && Date.now() - sideData.fetchedAt < MAX_AGE) return;
  try {
    sideData = await fetchHome(login, sideData?.loadedOrgs ?? [], sideData?.myPushes ?? null);
    sidePanel.update();
    sideData = { ...sideData, myPushes: await fetchMyPushes(sideData.repos, login, settings.recentCount).catch(() => null) };
    void writeCache(sideData);
    sidePanel.update();
  } catch {
    // The menu keeps GitHub's own list.
  }
}

for (const event of ['DOMContentLoaded', 'turbo:load', 'turbo:render']) document.addEventListener(event, tick);
window.addEventListener('popstate', tick);
setInterval(tick, 400);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && root) void refresh(false);
});

function applySettings(s: Settings): void {
  settings = s;
  tweakStyle.textContent = tweakCss(s.tweaks);
  sidePanel.update();
}

/** The signed-in user, from GitHub's own meta tag. */
function currentLogin(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content || null;
}

/** Where GitHub puts the page content, below the top bar. Its other children get hidden. */
function pageContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.application-main') ?? document.querySelector('main');
}

function tick(): void {
  if (!tweakStyle.isConnected) html.append(tweakStyle);
  if (!settingsLoaded || document.readyState === 'loading') return;
  const login = currentLogin();
  if (settings.replaceHome && isHomePath() && login) mount(login);
  else unmount();
}

function mount(login: string): void {
  const container = pageContainer();
  if (!container) return;
  html.classList.add('hb-home');
  html.classList.remove('hb-pending');
  if (root?.isConnected && root.parentElement === container) return;

  // First visit, or GitHub replaced the page under us.
  if (root) render(null, root);
  root = document.createElement('div');
  root.id = 'hb-root';
  container.classList.add('hb-container');
  container.prepend(root);

  if (state?.login !== login) {
    state = { login, data: null, loading: false, loadingOrg: null, error: null };
    draw();
    void readCache(login).then((cached) => {
      if (state?.login === login && !state.data && cached) {
        state = { ...state, data: cached };
        draw();
      }
      void refresh(false);
    });
  } else {
    draw();
    void refresh(false);
  }
}

function unmount(): void {
  html.classList.remove('hb-home', 'hb-pending');
  if (!root) return;
  render(null, root);
  root.remove();
  root = null;
}

function draw(): void {
  sidePanel.update();
  if (!root || !state) return;
  render(
    h(Home, {
      state,
      settings,
      onRefresh: () => void refresh(true),
      onSettings: (s: Settings) => {
        // Show the change at once; storage tells the other tabs.
        applySettings(s);
        draw();
        void saveSettings(s);
      },
      onLoadOrg: (org: string) => void loadOrg(org),
    }),
    root,
  );
}

async function refresh(force: boolean): Promise<void> {
  if (!state || state.loading) return;
  const login = state.login;
  const data = state.data;
  if (!force && data && Date.now() - data.fetchedAt < MAX_AGE) return;

  state = { ...state, loading: true, error: null };
  draw();
  try {
    // Repositories first; your pushes (a request or two per repository) right after.
    const fresh = await fetchHome(login, data?.loadedOrgs ?? [], data?.myPushes ?? null);
    if (state?.login !== login) return;
    state = { ...state, data: fresh };
    draw();
    const myPushes = await fetchMyPushes(fresh.repos, login, settings.recentCount).catch(() => null);
    if (state?.login !== login || !state.data) return;
    state = { ...state, data: { ...state.data, myPushes }, loading: false };
    void writeCache(state.data!);
  } catch (err) {
    if (state?.login !== login) return;
    state = { ...state, loading: false, error: describeError(err) };
  }
  draw();
}

/** All repositories of an organization, when it is picked. */
async function loadOrg(org: string): Promise<void> {
  if (!state?.data || state.loadingOrg) return;
  const login = state.login;
  state = { ...state, loadingOrg: org };
  draw();
  try {
    const current = state.data;
    if (!current) return;
    const data = await withOrgRepos(current, org);
    if (state?.login !== login) return;
    state = { ...state, data, loadingOrg: null };
    void writeCache(data);
  } catch (err) {
    if (state?.login !== login) return;
    state = { ...state, loadingOrg: null, error: describeError(err) };
  }
  draw();
}
