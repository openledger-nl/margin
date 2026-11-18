// Declutter tweaks: each one hides a list of selectors with `display: none`.
//
// GitHub changes its markup now and then. When a tweak stops working, fix its
// selectors here. Several alternatives per tweak are fine: selectors that match
// nothing cost nothing.

export const TWEAK_GROUPS = ['Everywhere', 'Top bar', 'Repository pages', 'Profile pages'] as const;
export type TweakGroup = (typeof TWEAK_GROUPS)[number];

export interface Tweak {
  id: string;
  group: TweakGroup;
  label: string;
  hint?: string;
  /** On for new installs. */
  default: boolean;
  selectors: string[];
}

/** A section in the repository sidebar (About, Releases, Packages…) that contains `sel`. */
const sidebarRow = (sel: string) => `.Layout-sidebar .BorderGrid-row:has(${sel})`;

export const TWEAKS: Tweak[] = [
  {
    id: 'copilot',
    group: 'Everywhere',
    default: true,
    label: 'Hide Copilot',
    hint: 'The Copilot button in the top bar, the chat panel and the "Ask Copilot" buttons.',
    selectors: [
      '.AppHeader-CopilotChat',
      '#copilot-chat-header-button',
      '[data-testid="copilot-chat-button"]',
      'react-partial[partial-name="copilot-chat"]',
      'react-partial[partial-name="copilot-code-chat"]',
      'copilot-diff-entry',
      'button[aria-label*="Copilot"]',
      'a[aria-label*="Copilot"]',
      '.AppHeader a[href="/copilot"]',
    ],
  },
  {
    id: 'notices',
    group: 'Everywhere',
    default: true,
    label: 'Hide promo banners',
    hint: 'Announcement and upsell banners at the top of pages.',
    selectors: ['.js-notice', '.js-upsell-banner', '[data-testid="upsell-banner"]'],
  },
  {
    id: 'footer',
    group: 'Everywhere',
    default: true,
    label: 'Hide the page footer',
    selectors: ['footer.footer', 'footer[role="contentinfo"]', '.footer[role="contentinfo"]'],
  },
  {
    id: 'topIssuesPrs',
    group: 'Top bar',
    default: false,
    label: 'Hide the Issues and Pull requests buttons',
    hint: 'The homepage has them too.',
    selectors: ['.AppHeader-globalBar-end a[href="/issues"]', '.AppHeader-globalBar-end a[href="/pulls"]'],
  },
  {
    id: 'topCreate',
    group: 'Top bar',
    default: false,
    label: 'Hide the "+" create menu',
    selectors: ['.AppHeader-globalBar-end [aria-label="Create something new"]'],
  },
  {
    id: 'repoSponsor',
    group: 'Repository pages',
    default: true,
    label: 'Hide Sponsor buttons and sections',
    selectors: ['.js-sponsor-button', 'a.btn[href^="/sponsors/"]', sidebarRow('a[href^="/sponsors/"]')],
  },
  {
    id: 'repoPackages',
    group: 'Repository pages',
    default: true,
    label: 'Hide "Packages" in the sidebar',
    selectors: [sidebarRow('a[href*="packages?repo_name="]')],
  },
  {
    id: 'repoDeployments',
    group: 'Repository pages',
    default: true,
    label: 'Hide "Deployments" and "Environments" in the sidebar',
    selectors: [sidebarRow('a[href*="/deployments"]')],
  },
  {
    id: 'repoUsedBy',
    group: 'Repository pages',
    default: true,
    label: 'Hide "Used by" in the sidebar',
    selectors: [sidebarRow('a[href*="/network/dependents"]')],
  },
  {
    id: 'repoContributors',
    group: 'Repository pages',
    default: false,
    label: 'Hide "Contributors" in the sidebar',
    selectors: [sidebarRow('a[href$="/graphs/contributors"]')],
  },
  {
    id: 'repoReleases',
    group: 'Repository pages',
    default: false,
    label: 'Hide "Releases" in the sidebar',
    selectors: [sidebarRow('a[href$="/releases"]')],
  },
  {
    id: 'repoLanguages',
    group: 'Repository pages',
    default: false,
    label: 'Hide "Languages" in the sidebar',
    selectors: [sidebarRow('a[href*="search?l="]')],
  },
  {
    id: 'profileAchievements',
    group: 'Profile pages',
    default: true,
    label: 'Hide achievement badges',
    selectors: [
      '.Layout-sidebar .border-top:has(a[href*="tab=achievements"])',
      '.Layout-sidebar .border-top:has(.achievement-badge-sidebar)',
    ],
  },
  {
    id: 'profileGraph',
    group: 'Profile pages',
    default: false,
    label: 'Hide the contribution graph',
    selectors: ['.js-yearly-contributions'],
  },
  {
    id: 'profileActivity',
    group: 'Profile pages',
    default: false,
    label: 'Hide "Contribution activity"',
    selectors: ['#js-contribution-activity', '.js-profile-timeline-year-list'],
  },
];

export function tweakEnabled(choices: Record<string, boolean>, tweak: Tweak): boolean {
  return choices[tweak.id] ?? tweak.default;
}

/** The stylesheet for the tweaks that are on. */
export function tweakCss(choices: Record<string, boolean>): string {
  return TWEAKS.filter((t) => tweakEnabled(choices, t))
    .map((t) => `${t.selectors.join(',\n')} { display: none !important; }`)
    .join('\n\n');
}
