// Filtering and sorting of the repository list. Pure, so it is tested.
import type { MyPush, Repo } from './github.ts';
import type { RepoSort } from './settings.ts';

/** Owner filter: '' is everyone, OTHERS is repositories of other people (not you, not your organizations). */
export const OTHERS = ':others';

export interface RepoFilter {
  query: string;
  owner: string;
  sort: RepoSort;
  hideForks: boolean;
  hideArchived: boolean;
}

export function filterRepos(repos: Repo[], f: RepoFilter, self: string, orgs: string[], myPushes: MyPush[] | null = null): Repo[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const owner = f.owner.toLowerCase();
  const isOther = otherTest(self, orgs);
  const list = repos.filter((r) => {
    if (f.hideForks && r.fork) return false;
    if (f.hideArchived && r.archived) return false;
    if (owner === OTHERS ? !isOther(r) : owner && r.owner.toLowerCase() !== owner) return false;
    if (words.length) {
      const text = `${r.fullName} ${r.description ?? ''}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  return list.sort(compare(f.sort, myPushes));
}

function compare(sort: RepoSort, myPushes: MyPush[] | null): (a: Repo, b: Repo) => number {
  const byName = (a: Repo, b: Repo) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' });
  const byPush = (a: Repo, b: Repo) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || byName(a, b);
  switch (sort) {
    case 'mine': {
      // Your pushes first, newest first; the rest after them by last push.
      const mine = new Map((myPushes ?? []).map((p) => [p.fullName.toLowerCase(), Date.parse(p.at)]));
      return (a, b) => {
        const pa = mine.get(a.fullName.toLowerCase());
        const pb = mine.get(b.fullName.toLowerCase());
        if (pa !== undefined && pb !== undefined) return pb - pa || byName(a, b);
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return byPush(a, b);
      };
    }
    case 'name':
      return byName;
    case 'stars':
      return (a, b) => b.stars - a.stars || byName(a, b);
    case 'issues':
      return (a, b) => b.issues + b.pulls - (a.issues + a.pulls) || byName(a, b);
    case 'pushed':
      return byPush;
  }
}

function otherTest(self: string, orgs: string[]): (r: Repo) => boolean {
  const mine = new Set([self, ...orgs].map((o) => o.toLowerCase()));
  return (r) => !mine.has(r.owner.toLowerCase());
}

/** Whether any repository belongs to someone else (for the "Other people" owner option). */
export function hasOthers(repos: Repo[], self: string, orgs: string[]): boolean {
  return repos.some(otherTest(self, orgs));
}

/** How many repositories `owner` has in the list. */
export function countOwned(repos: Repo[], owner: string): number {
  const o = owner.toLowerCase();
  return repos.filter((r) => r.owner.toLowerCase() === o).length;
}
