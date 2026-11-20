// The site as a tree of pages, from the comments and the page visits: which pages
// were looked at, by whom, and what feedback was given where. The overview page
// shows it; the review hub also writes it as site-map.md for the agent.
import { STATUSES, STATUS_LABELS, type Comment, type PageVisit, type Status } from './index.ts';

export interface SiteNode {
  path: string;
  /** The last path segment ("launch" for /blog/launch), "/" for the root. */
  segment: string;
  /** From a visit or a comment, or null for a path nobody opened (only its children). */
  title: string | null;
  visited: boolean;
  /** Who looked at this page, most recent first. */
  visitors: { by: string; lastAt: string; count: number }[];
  lastAt: string | null;
  comments: Comment[];
  counts: Record<Status, number>;
  /** This page and everything under it. */
  total: number;
  children: SiteNode[];
}

function node(path: string): SiteNode {
  const segment = path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1);
  return { path, segment, title: null, visited: false, visitors: [], lastAt: null, comments: [], counts: { open: 0, in_progress: 0, review_ready: 0, accepted: 0 }, total: 0, children: [] };
}

function later(a: string | null, b: string): string {
  return a && a > b ? a : b;
}

/** Merges one page view into a visit list (same origin, path and person: one entry). Returns the new list. */
export function mergeVisit(list: PageVisit[], v: { origin: string; path: string; title: string; by: string; at: string }, max = 5000): PageVisit[] {
  const i = list.findIndex((x) => x.origin === v.origin && x.path === v.path && x.by === v.by);
  const next = [...list];
  if (i >= 0) {
    const old = next[i]!;
    // At most one view per minute counted: a reload is not a second look.
    const counted = Date.parse(v.at) - Date.parse(old.lastAt) >= 60_000 ? 1 : 0;
    next[i] = { ...old, title: v.title || old.title, lastAt: v.at, count: old.count + counted };
  } else {
    next.push({ origin: v.origin, path: v.path, title: v.title, by: v.by, firstAt: v.at, lastAt: v.at, count: 1 });
  }
  if (next.length > max) next.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).length = max;
  return next;
}

/** The tree for one site. Parents of visited or commented pages are there too, even if nobody opened them. */
export function buildSiteMap(comments: Comment[], visits: PageVisit[]): SiteNode {
  const nodes = new Map<string, SiteNode>();
  const get = (path: string): SiteNode => {
    let n = nodes.get(path);
    if (!n) {
      n = node(path);
      nodes.set(path, n);
      if (path !== '/') {
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        get(parent).children.push(n);
      }
    }
    return n;
  };
  const root = get('/');
  for (const v of visits) {
    const n = get(v.path);
    n.visited = true;
    n.title = v.title || n.title;
    n.lastAt = later(n.lastAt, v.lastAt);
    n.visitors.push({ by: v.by, lastAt: v.lastAt, count: v.count });
  }
  for (const c of comments) {
    const n = get(c.path);
    n.comments.push(c);
    n.counts[c.status]++;
    n.title ??= c.title || null;
    n.lastAt = later(n.lastAt, c.updatedAt);
  }
  const finish = (n: SiteNode): number => {
    n.visitors.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    n.comments.sort((a, b) => a.id - b.id);
    n.children.sort((a, b) => a.path.localeCompare(b.path));
    n.total = n.comments.length + n.children.reduce((sum, ch) => sum + finish(ch), 0);
    return n.total;
  };
  finish(root);
  return root;
}

/** The tree as Markdown, for the agent: pages, who looked, and the comment ids with their status. */
export function formatSiteMap(root: SiteNode, info: { project: string; origin: string }): string {
  const out: string[] = [`# Site map: ${info.project}`, '', `${info.origin}, the pages reviewers looked at and their feedback.`, ''];
  const walk = (n: SiteNode, depth: number) => {
    const indent = '  '.repeat(depth);
    const who = n.visitors.map((v) => v.by).join(', ');
    const counts = STATUSES.filter((s) => n.counts[s]).map((s) => `${n.counts[s]} ${STATUS_LABELS[s].toLowerCase()}`).join(', ');
    const facts = [n.title ? JSON.stringify(n.title) : null, n.visited ? `visited by ${who}` : 'not visited', counts || (n.visited ? 'no feedback' : null)].filter(Boolean);
    out.push(`${indent}- \`${n.path}\` ${facts.join(', ')}`);
    for (const c of n.comments) {
      const first = c.messages.find((m) => m.author === 'user');
      const text = (first?.body ?? '').replace(/\s+/g, ' ').slice(0, 80);
      out.push(`${indent}  - #${c.id} [${STATUS_LABELS[c.status]}]${first?.name ? ` ${first.name}:` : ''} ${text} (feedback/${String(c.id).padStart(4, '0')}.md)`);
    }
    for (const ch of n.children) walk(ch, depth + 1);
  };
  walk(root, 0);
  return `${out.join('\n')}\n`;
}
