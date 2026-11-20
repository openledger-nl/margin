// Small formatting helpers for the homepage.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", "Mar 4", "Mar 4, 2024". */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Linguist colors for common languages; others get a stable color from their name. */
const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  PHP: '#4f5d95',
  Ruby: '#701516',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  Dart: '#00b4ab',
  HTML: '#e34c26',
  CSS: '#663399',
  SCSS: '#c6538c',
  Shell: '#89e051',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  Lua: '#000080',
  Elixir: '#6e4a7e',
  Dockerfile: '#384d54',
  'Jupyter Notebook': '#da5b0b',
  Nix: '#7e7eff',
  Zig: '#ec915c',
  MDX: '#fcb32c',
  Blade: '#f7523f',
  Twig: '#c1d026',
};

export function languageColor(language: string): string {
  const known = LANGUAGE_COLORS[language];
  if (known) return known;
  let hash = 0;
  for (const ch of language) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 55%)`;
}
