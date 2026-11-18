// The homepage: quick links, your organizations, where you pushed last, and
// all your repositories, across the full width of the window.
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { languageColor, timeAgo } from '../format.ts';
import { type HomeData, type Repo, avatarUrl, recentItems } from '../github.ts';
import { OTHERS, countOwned, filterRepos, hasOthers } from '../repos.ts';
import { REPO_SORTS, type RepoSort, type Settings } from '../settings.ts';
import {
  BellIcon,
  BranchIcon,
  ExternalIcon,
  IssueIcon,
  LockIcon,
  PersonIcon,
  PlusIcon,
  PullRequestIcon,
  RefreshIcon,
  StarIcon,
} from './icons.tsx';

export interface HomeState {
  login: string;
  data: HomeData | null;
  loading: boolean;
  /** The organization whose repositories are being loaded. */
  loadingOrg: string | null;
  error: string | null;
}

interface Props {
  state: HomeState;
  settings: Settings;
  onRefresh: () => void;
  onSettings: (settings: Settings) => void;
  /** Load all repositories of an organization (the lists only hold yours). */
  onLoadOrg: (org: string) => void;
}

/** Repositories shown before "Show all". */
const PAGE = 90;

export function Home({ state, settings, onRefresh, onSettings, onLoadOrg }: Props) {
  const [owner, setOwnerState] = useState('');
  const { login, data } = state;

  const setOwner = (next: string) => {
    setOwnerState(next);
    const org = data?.orgs.find((o) => o.login.toLowerCase() === next.toLowerCase());
    if (org && !data?.loadedOrgs.some((l) => l.toLowerCase() === org.login.toLowerCase())) onLoadOrg(org.login);
  };

  const pickOwner = (next: string) => {
    setOwner(next);
    const list = document.getElementById('hb-repos');
    if (list && list.getBoundingClientRect().top > window.innerHeight * 0.6) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div class={`hb hb-width-${settings.pageWidth}`}>
      <header class="hb-top">
        <h1 class="hb-title">
          <img class="hb-avatar" src={avatar(avatarUrl(login), 32)} alt="" width={32} height={32} />
          <span>{login}</span>
        </h1>
        {settings.showQuickLinks && <QuickLinks login={login} />}
        <div class="hb-actions">
          <span class="hb-muted hb-small" role="status">
            {state.loading ? 'Refreshing…' : data ? `Updated ${timeAgo(new Date(data.fetchedAt).toISOString())}` : ''}
          </span>
          <button class="hb-btn hb-icon-btn" type="button" title="Refresh" aria-label="Refresh" onClick={onRefresh} disabled={state.loading}>
            <RefreshIcon class={state.loading ? 'hb-spin' : undefined} />
          </button>
        </div>
      </header>

      {state.error && <div class="hb-banner hb-banner-error">{state.error}</div>}

      {!data ? (
        <div class="hb-card hb-empty">{state.error ? 'Nothing to show yet.' : 'Loading your repositories…'}</div>
      ) : (
        <Layout
          side={[
            settings.showOrgs && <Owners key="orgs" data={data} owner={owner} loadingOrg={state.loadingOrg} onPick={pickOwner} />,
            settings.showRecent && <Recent key="recent" data={data} count={settings.recentCount} />,
          ]}
          main={
            settings.showRepos && (
              <Repos data={data} owner={owner} loadingOrg={state.loadingOrg} onOwner={setOwner} settings={settings} onSettings={onSettings} />
            )
          }
        />
      )}
    </div>
  );
}

/** Organizations and recent pushes in a column on the left, repositories in the rest. */
function Layout({ side, main }: { side: (JSX.Element | false)[]; main: JSX.Element | false }) {
  const sideCards = side.filter(Boolean);
  if (!main && !sideCards.length) {
    return <div class="hb-card hb-empty">Everything is turned off. Turn sections back on in the Margin popup.</div>;
  }
  if (!main) return <div class="hb-side-only">{sideCards}</div>;
  if (!sideCards.length) return <div class="hb-main">{main}</div>;
  return (
    <div class="hb-grid">
      <aside class="hb-side">{sideCards}</aside>
      <div class="hb-main">{main}</div>
    </div>
  );
}

function QuickLinks({ login }: { login: string }) {
  const links = [
    { href: '/pulls', label: 'Pull requests', icon: <PullRequestIcon /> },
    { href: '/issues', label: 'Issues', icon: <IssueIcon /> },
    { href: '/notifications', label: 'Notifications', icon: <BellIcon /> },
    { href: `/${login}?tab=stars`, label: 'Stars', icon: <StarIcon /> },
    { href: `/${login}`, label: 'Profile', icon: <PersonIcon /> },
  ];
  return (
    <nav class="hb-quick" aria-label="Quick links">
      {links.map((l) => (
        <a class="hb-btn" href={l.href} key={l.href}>
          {l.icon}
          {l.label}
        </a>
      ))}
    </nav>
  );
}

function Owners(props: { data: HomeData; owner: string; loadingOrg: string | null; onPick: (owner: string) => void }) {
  const { data, owner, loadingOrg, onPick } = props;
  const rows = [
    { login: data.login, avatar: avatarUrl(data.login), you: true },
    ...data.orgs.map((o) => ({ login: o.login, avatar: o.avatar, you: false })),
  ];
  return (
    <section class="hb-card">
      <div class="hb-card-head">
        <h2>Organizations</h2>
        {owner && (
          <button class="hb-link hb-small" type="button" onClick={() => onPick('')}>
            Show all
          </button>
        )}
      </div>
      <ul class="hb-owners">
        {rows.map((r) => {
          const active = owner.toLowerCase() === r.login.toLowerCase();
          const loading = loadingOrg?.toLowerCase() === r.login.toLowerCase();
          return (
            <li key={r.login} class={active ? 'hb-owner hb-active' : 'hb-owner'}>
              <button
                type="button"
                class="hb-owner-pick"
                aria-pressed={active}
                title={active ? 'Show all repositories' : `Show only repositories of ${r.login}`}
                onClick={() => onPick(active ? '' : r.login)}
              >
                <img class="hb-avatar hb-avatar-small" src={avatar(r.avatar, 20)} alt="" width={20} height={20} />
                <span class="hb-owner-name">
                  {r.login}
                  {r.you && <span class="hb-muted"> (you)</span>}
                </span>
                {loading ? <RefreshIcon class="hb-spin hb-muted" label="Loading" /> : <span class="hb-counter">{countOwned(data.repos, r.login)}</span>}
              </button>
              <a class="hb-owner-open" href={`/${r.login}`} title={`Open ${r.login} on GitHub`} aria-label={`Open ${r.login} on GitHub`}>
                <ExternalIcon />
              </a>
            </li>
          );
        })}
      </ul>
      {data.orgs.length === 0 && <p class="hb-pad hb-muted hb-small">You are not in any organizations.</p>}
    </section>
  );
}

function Recent({ data, count }: { data: HomeData; count: number }) {
  const items = useMemo(() => recentItems(data, count), [data, count]);
  return (
    <section class="hb-card">
      <div class="hb-card-head">
        <h2>{data.myPushes ? 'Recently pushed by you' : 'Recently pushed'}</h2>
      </div>
      {items.length ? (
        <ul class="hb-recent">
          {items.map(({ repo: r, at, branch }) => (
            <li key={r.fullName}>
              <a class="hb-recent-item" href={`/${r.fullName}`} title={branch ? `${r.fullName} · ${branch}` : r.fullName}>
                <span class="hb-lang-dot" style={{ backgroundColor: r.languageColor ?? languageColor(r.language ?? '') }} />
                <span class="hb-recent-text">
                  <span class="hb-recent-name">
                    <span class="hb-muted">{r.owner}/</span>
                    {r.name}
                  </span>
                  {branch && (
                    <span class="hb-recent-branch">
                      <BranchIcon />
                      {branch}
                    </span>
                  )}
                </span>
                {r.private && <LockIcon class="hb-muted" label="Private" />}
                <span class="hb-recent-time" title={new Date(at).toLocaleString()}>
                  {timeAgo(at)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p class="hb-pad hb-muted hb-small">No repositories with your commits yet.</p>
      )}
    </section>
  );
}

function Repos(props: {
  data: HomeData;
  owner: string;
  loadingOrg: string | null;
  onOwner: (owner: string) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
}) {
  const { data, owner, loadingOrg, onOwner, settings, onSettings } = props;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const orgLogins = useMemo(() => data.orgs.map((o) => o.login), [data]);
  const list = useMemo(
    () =>
      filterRepos(
        data.repos,
        { query, owner, sort: settings.repoSort, hideForks: settings.hideForks, hideArchived: settings.hideArchived },
        data.login,
        orgLogins,
        data.myPushes,
      ),
    [data, orgLogins, query, owner, settings.repoSort, settings.hideForks, settings.hideArchived],
  );
  useEffect(() => setLimit(PAGE), [query, owner]);

  const ownerOptions: [string, string][] = [
    ['', 'All owners'],
    [data.login, `${data.login} (you)`],
    ...orgLogins.map((o): [string, string] => [o, o]),
    ...(hasOthers(data.repos, data.login, orgLogins) ? [[OTHERS, 'Other people'] as [string, string]] : []),
  ];
  const ownerValue = ownerOptions.find(([v]) => v.toLowerCase() === owner.toLowerCase())?.[0] ?? '';
  const loadingThis = !!loadingOrg && loadingOrg.toLowerCase() === owner.toLowerCase();

  return (
    <section class="hb-card" id="hb-repos">
      <div class="hb-card-head">
        <h2>
          Repositories <span class="hb-counter">{list.length}</span>
          {loadingThis && <span class="hb-muted hb-small">Loading all of {loadingOrg}…</span>}
        </h2>
        <a class="hb-btn hb-btn-primary hb-btn-small" href="/new">
          <PlusIcon />
          New
        </a>
      </div>
      <div class="hb-toolbar">
        <input
          class="hb-input hb-grow"
          type="search"
          placeholder="Find a repository…"
          aria-label="Find a repository"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && list[0]) window.location.assign(`/${list[0].fullName}`);
            if (e.key === 'Escape') setQuery('');
          }}
        />
        <select class="hb-input" aria-label="Owner" value={ownerValue} onChange={(e) => onOwner(e.currentTarget.value)}>
          {ownerOptions.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          class="hb-input"
          aria-label="Sort"
          value={settings.repoSort}
          onChange={(e) => onSettings({ ...settings, repoSort: e.currentTarget.value as RepoSort })}
        >
          {Object.entries(REPO_SORTS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <label class="hb-toggle">
          <input type="checkbox" checked={!settings.hideForks} onChange={(e) => onSettings({ ...settings, hideForks: !e.currentTarget.checked })} />
          Forks
        </label>
        <label class="hb-toggle">
          <input
            type="checkbox"
            checked={!settings.hideArchived}
            onChange={(e) => onSettings({ ...settings, hideArchived: !e.currentTarget.checked })}
          />
          Archived
        </label>
      </div>
      {list.length ? (
        <ul class={`hb-repos hb-repos-${settings.repoLayout}`}>
          {list.slice(0, limit).map((r) => (
            <RepoCell key={r.fullName} repo={r} showOwner={!owner && r.owner.toLowerCase() !== data.login.toLowerCase()} />
          ))}
        </ul>
      ) : (
        <p class="hb-pad hb-muted">
          {loadingThis
            ? 'Loading…'
            : data.repos.length
              ? `No repositories match${settings.hideForks || settings.hideArchived ? ' (forks or archived ones are hidden)' : ''}.`
              : 'No repositories yet.'}
        </p>
      )}
      {list.length > limit && (
        <button class="hb-more" type="button" onClick={() => setLimit(list.length)}>
          Show all {list.length}
        </button>
      )}
    </section>
  );
}

function RepoCell({ repo: r, showOwner }: { repo: Repo; showOwner: boolean }) {
  const url = `/${r.fullName}`;
  return (
    <li class="hb-repo">
      <div class="hb-repo-head">
        <a class="hb-repo-name" href={url}>
          {showOwner && <span class="hb-repo-owner">{r.owner}/</span>}
          {r.name}
        </a>
        {r.private && <span class="hb-label">Private</span>}
        {r.fork && <span class="hb-label">Fork</span>}
        {r.archived && <span class="hb-label hb-label-attention">Archived</span>}
      </div>
      {r.description && <p class="hb-repo-desc">{r.description}</p>}
      <div class="hb-repo-meta">
        {r.language && <Language repo={r} />}
        {r.stars > 0 && (
          <a href={`${url}/stargazers`}>
            <StarIcon label="Stars" /> {r.stars.toLocaleString()}
          </a>
        )}
        {r.issues > 0 && (
          <a href={`${url}/issues`}>
            <IssueIcon label="Open issues" /> {r.issues.toLocaleString()}
          </a>
        )}
        {r.pulls > 0 && (
          <a href={`${url}/pulls`}>
            <PullRequestIcon label="Open pull requests" /> {r.pulls.toLocaleString()}
          </a>
        )}
        <span title={new Date(r.updatedAt).toLocaleString()}>
          {r.pushed ? 'Pushed' : 'Updated'} {timeAgo(r.updatedAt)}
        </span>
      </div>
    </li>
  );
}

function Language({ repo }: { repo: Repo }) {
  return (
    <span class="hb-lang">
      <span class="hb-lang-dot" style={{ backgroundColor: repo.languageColor ?? languageColor(repo.language ?? '') }} />
      {repo.language}
    </span>
  );
}

/** An avatar at twice the display size, for sharp images on HiDPI screens. */
function avatar(url: string, size: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}size=${size * 2}`;
}
