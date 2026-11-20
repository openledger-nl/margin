// Fetches what the homepage shows from github.com itself, with the session you
// are logged in with: the same requests GitHub's own pages make. No token, no
// setup.
//
//   /repos?q=<search>                 JSON (with Accept: application/json), the
//                                     "Repositories" page: 30 per page
//   /dashboard/ajax_context_list      HTML, the dashboard's account switcher:
//                                     your organizations
//   /<owner>/<repo>/branches/yours    JSON, "Your branches": the branches you
//                                     pushed to (not the default branch)
//   /<owner>/<repo>/commits?author=…  JSON, your commits on the default branch,
//                                     with when they were pushed
//
// These are GitHub's internal endpoints. If GitHub changes them, this file is
// the one to fix.

/** At most this many pages of 30 repositories per query. */
const MAX_PAGES = 20;
/** Repositories asked at a time (two requests each), and at most in total, while finding your pushes. */
const PUSH_BATCH = 6;
const MAX_PUSH_REPOS = 40;

/** The repository queries merged into "your repositories". */
export const REPO_QUERIES = ['contributed-by:@me', 'owner:@me', 'admin:@me'] as const;
/** The query whose repositories count as "you pushed to". */
const CONTRIBUTED = 'contributed-by:@me';

export interface Repo {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  stars: number;
  issues: number;
  pulls: number;
  /** Last push, or last update when never pushed to. */
  updatedAt: string;
  pushed: boolean;
  /** You committed to it. */
  contributed: boolean;
}

export interface Org {
  login: string;
  avatar: string;
}

/** Your latest push to a repository. */
export interface MyPush {
  fullName: string;
  branch: string;
  isDefault: boolean;
  /** When you pushed (default branch), or the date of the newest commit on your branch. */
  at: string;
}

export interface HomeData {
  login: string;
  fetchedAt: number;
  repos: Repo[];
  orgs: Org[];
  /** Organizations whose repositories are all loaded (after picking one). */
  loadedOrgs: string[];
  /** Your latest pushes, newest first; null when GitHub would not tell. */
  myPushes: MyPush[] | null;
}

/** One line of "Recently pushed". */
export interface RecentItem {
  repo: Repo;
  at: string;
  /** The branch you pushed to, when it is not the default branch. */
  branch: string | null;
}

export class FetchError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- raw shapes (only the fields used) ----------

export interface RawRepo {
  type: string; // "Public", "Private", "Private archive", "Public archive", "Internal", …
  name: string;
  owner: string;
  isFork: boolean;
  description: string | null;
  primaryLanguage: { name: string; color: string } | null;
  starsCount: number;
  issueCount: number;
  pullRequestCount: number;
  lastUpdated: { hasBeenPushedTo: boolean; timestamp: string };
}

export interface RawBranch {
  name: string;
  isDefault: boolean;
  authoredDate: string;
  author?: { login: string } | null;
}

export interface RawCommit {
  authoredDate: string;
  committedDate: string;
  pushedDate?: string | null;
  authors?: { login: string }[];
}

export interface RawCommitsRoute {
  repo?: { defaultBranch?: string };
  commitGroups?: { commits?: RawCommit[] }[];
}

interface RawRepoPage {
  payload: { reposFinderPageRoute: { pageCount: number; repositoryCount: number; repositories: RawRepo[] } };
}

// ---------- HTTP ----------

/**
 * fetch as the page. Firefox runs a content script's own fetch with the
 * extension's identity; `content.fetch` is the page's. Chrome's is the page's.
 */
declare const content: { fetch?: typeof fetch } | undefined;
const pageFetch: typeof fetch =
  typeof content !== 'undefined' && typeof content?.fetch === 'function' ? content.fetch.bind(content) : fetch.bind(globalThis);

async function get(path: string, headers: Record<string, string>): Promise<Response> {
  const res = await pageFetch(new URL(path, 'https://github.com').href, { headers, credentials: 'include' });
  if (!res.ok) throw new FetchError(res.status, `GitHub answered ${res.status} for ${path.split('?')[0]}`);
  return res;
}

async function repoPage(query: string, page: number): Promise<RawRepoPage['payload']['reposFinderPageRoute']> {
  const res = await get(`/repos?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`, { Accept: 'application/json' });
  const data = (await res.json()) as Partial<RawRepoPage>;
  const route = data.payload?.reposFinderPageRoute;
  if (!route || !Array.isArray(route.repositories)) throw new FetchError(0, 'GitHub changed its repositories page; Margin needs an update.');
  return route;
}

/** All repositories of a /repos search. */
export async function fetchRepoQuery(query: string): Promise<Repo[]> {
  const first = await repoPage(query, 1);
  const pages = Math.min(first.pageCount, MAX_PAGES);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => repoPage(query, i + 2)));
  const contributed = query === CONTRIBUTED;
  return [first, ...rest].flatMap((p) => p.repositories.map((r) => toRepo(r, contributed)));
}

export async function fetchOrgs(login: string): Promise<Org[]> {
  const res = await get(`/dashboard/ajax_context_list?current_context=${encodeURIComponent(login)}`, {
    Accept: 'text/html',
    'X-Requested-With': 'XMLHttpRequest',
  });
  return parseOrgs(await res.text());
}

// ---------- shaping ----------

export function toRepo(r: RawRepo, contributed: boolean): Repo {
  const type = r.type.toLowerCase();
  return {
    fullName: `${r.owner}/${r.name}`,
    name: r.name,
    owner: r.owner,
    private: type.includes('private') || type.includes('internal'),
    archived: type.includes('archive'),
    fork: r.isFork,
    description: r.description || null,
    language: r.primaryLanguage?.name ?? null,
    languageColor: r.primaryLanguage?.color ?? null,
    stars: r.starsCount ?? 0,
    issues: r.issueCount ?? 0,
    pulls: r.pullRequestCount ?? 0,
    updatedAt: r.lastUpdated.timestamp,
    pushed: r.lastUpdated.hasBeenPushedTo,
    contributed,
  };
}

/** Organizations from the account switcher's HTML: links to /orgs/<name>/dashboard. */
export function parseOrgs(html: string): Org[] {
  const seen = new Map<string, Org>();
  for (const m of html.matchAll(/href="\/orgs\/([^/"?#]+)\/dashboard"/g)) {
    const login = decodeURIComponent(m[1]!);
    if (!seen.has(login.toLowerCase())) seen.set(login.toLowerCase(), { login, avatar: avatarUrl(login) });
  }
  return [...seen.values()];
}

export function avatarUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png`;
}

/** Your newest branch in a "Your branches" list. */
export function newestOwnBranch(branches: RawBranch[], login: string): { branch: string; isDefault: boolean; at: string } | null {
  const me = login.toLowerCase();
  let best: RawBranch | null = null;
  for (const b of branches) {
    if (b.author && b.author.login.toLowerCase() !== me) continue;
    if (Number.isNaN(Date.parse(b.authoredDate))) continue;
    if (!best || Date.parse(b.authoredDate) > Date.parse(best.authoredDate)) best = b;
  }
  return best && { branch: best.name, isDefault: best.isDefault, at: best.authoredDate };
}

/** Your newest commit on the default branch, from a commits page filtered on you. */
export function newestDefaultCommit(route: RawCommitsRoute): { branch: string; isDefault: boolean; at: string } | null {
  const commit = route.commitGroups?.[0]?.commits?.[0]; // newest first
  if (!commit) return null;
  const at = commit.pushedDate || commit.committedDate || commit.authoredDate;
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return { branch: route.repo?.defaultBranch ?? 'main', isDefault: true, at };
}

/** Repositories that may hold a push of yours, last pushed (by anyone) first. */
export function pushCandidates(repos: Repo[], login: string): Repo[] {
  const me = login.toLowerCase();
  return repos
    .filter((r) => r.pushed && !r.archived && (r.contributed || r.owner.toLowerCase() === me))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * Whether the pushes found so far settle the top `count`: a repository's last
 * push (by anyone) is never older than your last push to it, so once the
 * `count`th newest push of yours is newer than the next candidate's last push,
 * no later candidate can get in.
 */
export function pushesSettled(found: MyPush[], count: number, next: Repo | undefined): boolean {
  if (!next) return true;
  const sorted = [...found].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const nth = sorted[count - 1];
  return !!nth && Date.parse(nth.at) >= Date.parse(next.updatedAt);
}

/** Your latest push to a repository: your newest feature branch or your newest default-branch commit. */
async function fetchMyPush(repo: Repo, login: string): Promise<MyPush | null> {
  const json = { Accept: 'application/json' };
  const [branches, commits] = await Promise.allSettled([
    get(`/${repo.fullName}/branches/yours`, json)
      .then((r) => r.json() as Promise<{ payload?: { branches?: RawBranch[] } }>)
      .then((d) => newestOwnBranch(d.payload?.branches ?? [], login)),
    get(`/${repo.fullName}/commits?author=${encodeURIComponent(login)}`, json)
      .then((r) => r.json() as Promise<{ payload?: { commitsRoute?: RawCommitsRoute } }>)
      .then((d) => newestDefaultCommit(d.payload?.commitsRoute ?? {})),
  ]);
  if (branches.status === 'rejected' && commits.status === 'rejected') throw branches.reason;
  const options = [branches, commits].flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  const newest = options.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return newest ? { fullName: repo.fullName, ...newest } : null;
}

/** Your `count` latest pushes, asking as few repositories as possible. */
export async function fetchMyPushes(repos: Repo[], login: string, count: number): Promise<MyPush[]> {
  const candidates = pushCandidates(repos, login).slice(0, MAX_PUSH_REPOS);
  const found: MyPush[] = [];
  let failures = 0;
  for (let i = 0; i < candidates.length; i += PUSH_BATCH) {
    const batch = candidates.slice(i, i + PUSH_BATCH);
    const results = await Promise.all(batch.map((r) => fetchMyPush(r, login).catch(() => (failures++, null))));
    for (const r of results) if (r) found.push(r);
    // Every repository failing means GitHub changed these pages: let the caller fall back.
    if (failures === i + batch.length) throw new FetchError(0, 'Your pushes could not be read.');
    if (pushesSettled(found, count, candidates[i + PUSH_BATCH])) break;
  }
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, count);
}

/** "Recently pushed": your own pushes when known, otherwise the best guess from the repositories. */
export function recentItems(data: HomeData, count: number): RecentItem[] {
  const byName = new Map(data.repos.map((r) => [r.fullName.toLowerCase(), r]));
  if (data.myPushes) {
    return data.myPushes
      .map((p) => ({ push: p, repo: byName.get(p.fullName.toLowerCase()) }))
      .filter((x): x is { push: MyPush; repo: Repo } => !!x.repo)
      .slice(0, count)
      .map(({ push, repo }) => ({ repo, at: push.at, branch: push.isDefault ? null : push.branch }));
  }
  return recentlyPushed(data.repos, count, [data.login, ...data.orgs.map((o) => o.login)]).map((repo) => ({
    repo,
    at: repo.updatedAt,
    branch: null,
  }));
}

/** One entry per repository; "contributed" sticks when any list says so. */
export function mergeRepos(...lists: Repo[][]): Repo[] {
  const byName = new Map<string, Repo>();
  for (const list of lists) {
    for (const r of list) {
      const key = r.fullName.toLowerCase();
      const seen = byName.get(key);
      byName.set(key, seen ? { ...r, contributed: seen.contributed || r.contributed } : r);
    }
  }
  return [...byName.values()];
}

/**
 * The repositories you contribute to, last pushed first. GitHub only says when
 * a repository was pushed to last, not by whom, so busy public projects of
 * others (one old pull request of yours) are left out: they would always be
 * on top. `mine` is your login and your organizations.
 */
export function recentlyPushed(repos: Repo[], count: number, mine: string[]): Repo[] {
  const own = new Set(mine.map((m) => m.toLowerCase()));
  return repos
    .filter((r) => r.contributed && r.pushed && !r.archived && (r.private || own.has(r.owner.toLowerCase())))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, count);
}

// ---------- the homepage's data ----------

/** Repositories and organizations; `myPushes` is carried over from `previous` until fetchMyPushes updates it. */
export async function fetchHome(login: string, keepOrgs: string[] = [], previous: MyPush[] | null = null): Promise<HomeData> {
  const [orgs, ...lists] = await Promise.all([
    fetchOrgs(login).catch((): Org[] => []), // an extra: the page works without it
    ...REPO_QUERIES.map((q) => fetchRepoQuery(q)),
    // Organizations picked before stay complete after a refresh.
    ...keepOrgs.map((org) => fetchRepoQuery(`org:${org}`).catch((): Repo[] => [])),
  ]);
  return { login, fetchedAt: Date.now(), repos: mergeRepos(...lists), orgs, loadedOrgs: keepOrgs, myPushes: previous };
}

/** Adds all repositories of an organization. */
export async function withOrgRepos(data: HomeData, org: string): Promise<HomeData> {
  const repos = await fetchRepoQuery(`org:${org}`);
  return {
    ...data,
    repos: mergeRepos(data.repos, repos.map((r) => ({ ...r, contributed: false }))),
    loadedOrgs: [...new Set([...data.loadedOrgs, org])],
  };
}

/** What to tell the user when fetching failed. */
export function describeError(err: unknown): string {
  if (err instanceof FetchError) {
    if (err.status === 401 || err.status === 403 || err.status === 404) {
      return 'GitHub did not return your repositories. Are you still logged in? Reload the page to try again.';
    }
    if (err.status === 429) return 'GitHub asks to slow down. Try again in a minute.';
    return err.message;
  }
  return 'Could not reach GitHub. Check your connection.';
}
