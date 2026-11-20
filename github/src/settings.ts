// Settings in chrome.storage.sync (they follow you to other machines).
// Nothing needs setting up: the defaults are the intended experience.

export const REPO_SORTS = {
  mine: 'Last pushed by you',
  pushed: 'Last pushed (anyone)',
  name: 'Name',
  stars: 'Stars',
  issues: 'Open issues and PRs',
} as const;
export type RepoSort = keyof typeof REPO_SORTS;

export const PAGE_WIDTHS = {
  full: 'Full width',
  wide: 'Wide (1800px)',
  centered: 'Centered (1280px)',
} as const;
export type PageWidth = keyof typeof PAGE_WIDTHS;

export const REPO_LAYOUTS = {
  grid: 'Grid',
  list: 'List',
} as const;
export type RepoLayout = keyof typeof REPO_LAYOUTS;

/** Bumped when a default changes for everyone, saved settings included (see toSettings). */
const SETTINGS_VERSION = 2;

export interface Settings {
  version: number;
  /** Replace the github.com homepage. Off gives the normal feed back. */
  replaceHome: boolean;
  /** Recently pushed instead of "Top repositories" in GitHub's side menu (☰). */
  sideMenuRecent: boolean;
  pageWidth: PageWidth;
  repoLayout: RepoLayout;
  showQuickLinks: boolean;
  showOrgs: boolean;
  showRecent: boolean;
  showRepos: boolean;
  /** How many repositories "Recently pushed" shows. */
  recentCount: number;
  repoSort: RepoSort;
  hideForks: boolean;
  hideArchived: boolean;
  /** Tweak id → on/off. Missing means the tweak's default. */
  tweaks: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  replaceHome: true,
  sideMenuRecent: true,
  pageWidth: 'full',
  repoLayout: 'grid',
  showQuickLinks: true,
  showOrgs: true,
  showRecent: true,
  showRepos: true,
  recentCount: 10,
  repoSort: 'mine',
  hideForks: false,
  hideArchived: true,
  tweaks: {},
};

/** Always more than GitHub's five. */
export const RECENT_MIN = 6;
export const RECENT_MAX = 30;

/** Stored settings, checked field by field: anything missing or wrong becomes the default. */
export function toSettings(value: unknown): Settings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const bool = (key: keyof Settings) =>
    typeof v[key] === 'boolean' ? (v[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
  const count = typeof v.recentCount === 'number' && Number.isFinite(v.recentCount) ? Math.round(v.recentCount) : DEFAULT_SETTINGS.recentCount;
  const tweaks: Record<string, boolean> = {};
  if (v.tweaks && typeof v.tweaks === 'object') {
    for (const [id, on] of Object.entries(v.tweaks)) if (typeof on === 'boolean') tweaks[id] = on;
  }
  const pick = <T extends string>(key: keyof Settings, options: Record<T, string>): T =>
    typeof v[key] === 'string' && (v[key] as string) in options ? (v[key] as T) : (DEFAULT_SETTINGS[key] as T);
  // Version 2 made "Last pushed by you" the sort order, also for saved settings.
  const migrated = typeof v.version === 'number' && v.version >= SETTINGS_VERSION;
  return {
    version: SETTINGS_VERSION,
    replaceHome: bool('replaceHome'),
    sideMenuRecent: bool('sideMenuRecent'),
    pageWidth: pick('pageWidth', PAGE_WIDTHS),
    repoLayout: pick('repoLayout', REPO_LAYOUTS),
    showQuickLinks: bool('showQuickLinks'),
    showOrgs: bool('showOrgs'),
    showRecent: bool('showRecent'),
    showRepos: bool('showRepos'),
    recentCount: Math.min(RECENT_MAX, Math.max(RECENT_MIN, count)),
    repoSort: migrated ? pick('repoSort', REPO_SORTS) : DEFAULT_SETTINGS.repoSort,
    hideForks: bool('hideForks'),
    hideArchived: bool('hideArchived'),
    tweaks,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = (await chrome.storage.sync.get('settings')) as { settings?: unknown };
    return toSettings(stored.settings);
  } catch {
    return toSettings(undefined);
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export function onSettingsChange(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) listener(toSettings(changes.settings.newValue));
  });
}
