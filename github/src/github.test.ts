import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FetchError, type RawRepo, type Repo, describeError, mergeRepos, parseOrgs, recentlyPushed, toRepo } from './github.ts';

function raw(patch: Partial<RawRepo> = {}): RawRepo {
  return {
    type: 'Public',
    name: 'site',
    owner: 'acme',
    isFork: false,
    description: 'Our site',
    primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
    starsCount: 3,
    issueCount: 2,
    pullRequestCount: 1,
    lastUpdated: { hasBeenPushedTo: true, timestamp: '2026-11-01T00:00:00Z' },
    ...patch,
  };
}

const repo = (fullName: string, patch: Partial<Repo> = {}): Repo => {
  const [owner = '', name = ''] = fullName.split('/');
  return { ...toRepo(raw({ owner, name }), false), ...patch };
};

test('toRepo reads the repository type', () => {
  assert.deepEqual(
    ['Public', 'Private', 'Private archive', 'Public archive', 'Internal'].map((type) => {
      const r = toRepo(raw({ type }), false);
      return [r.private, r.archived];
    }),
    [
      [false, false],
      [true, false],
      [true, true],
      [false, true],
      [true, false],
    ],
  );
});

test('toRepo keeps the fields the page shows', () => {
  const r = toRepo(raw({ description: '', primaryLanguage: null }), true);
  assert.equal(r.fullName, 'acme/site');
  assert.equal(r.description, null);
  assert.equal(r.language, null);
  assert.equal(r.contributed, true);
  assert.equal(r.issues, 2);
  assert.equal(r.pulls, 1);
});

test('parseOrgs reads the account switcher', () => {
  const html = `
    <a href="/" role="option">me</a>
    <a id="item-1" href="/orgs/openledger-nl/dashboard" role="option">openledger-nl</a>
    <a href="/orgs/Stabilo-International/dashboard">Stabilo</a>
    <a href="/orgs/openledger-nl/dashboard">again</a>
    <a href="/orgs/other/people">not a dashboard</a>`;
  assert.deepEqual(
    parseOrgs(html).map((o) => o.login),
    ['openledger-nl', 'Stabilo-International'],
  );
  assert.equal(parseOrgs(html)[0]?.avatar, 'https://github.com/openledger-nl.png');
});

test('mergeRepos dedupes case-insensitively and keeps "contributed"', () => {
  const merged = mergeRepos([repo('me/a', { contributed: true })], [repo('Me/A'), repo('me/b')]);
  assert.deepEqual(
    merged.map((r) => [r.fullName, r.contributed]),
    [
      ['Me/A', true],
      ['me/b', false],
    ],
  );
});

test('recentlyPushed: contributed, pushed, yours or private; newest first', () => {
  const repos = [
    repo('me/old', { contributed: true, updatedAt: '2026-01-01T00:00:00Z' }),
    repo('Acme/new', { contributed: true, updatedAt: '2026-11-01T00:00:00Z' }),
    repo('acme/notmine', { contributed: false, updatedAt: '2026-11-10T00:00:00Z' }),
    repo('me/empty', { contributed: true, pushed: false, updatedAt: '2026-11-11T00:00:00Z' }),
    repo('bigproject/upstream', { contributed: true, updatedAt: '2026-11-12T00:00:00Z' }),
    repo('friend/private', { contributed: true, private: true, updatedAt: '2026-06-01T00:00:00Z' }),
    repo('me/archived', { contributed: true, archived: true, updatedAt: '2026-11-13T00:00:00Z' }),
  ];
  assert.deepEqual(
    recentlyPushed(repos, 5, ['me', 'acme']).map((r) => r.fullName),
    ['Acme/new', 'friend/private', 'me/old'],
  );
  assert.equal(recentlyPushed(repos, 1, ['me', 'acme']).length, 1);
});

test('describeError', () => {
  assert.match(describeError(new FetchError(404, 'x')), /still logged in/);
  assert.match(describeError(new FetchError(429, 'x')), /slow down/);
  assert.match(describeError(new TypeError('Failed to fetch')), /Could not reach/);
});
