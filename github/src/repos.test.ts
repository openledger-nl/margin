import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Repo } from './github.ts';
import { OTHERS, type RepoFilter, countOwned, filterRepos, hasOthers } from './repos.ts';

function repo(fullName: string, patch: Partial<Repo> = {}): Repo {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    fullName,
    name,
    owner,
    private: false,
    archived: false,
    fork: false,
    description: null,
    language: null,
    languageColor: null,
    stars: 0,
    issues: 0,
    pulls: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    pushed: true,
    contributed: true,
    ...patch,
  };
}

const repos = [
  repo('me/alpha', { updatedAt: '2026-03-01T00:00:00Z', stars: 5, description: 'The website', issues: 1 }),
  repo('me/beta', { updatedAt: '2026-05-01T00:00:00Z', fork: true }),
  repo('acme/gamma', { updatedAt: '2026-04-01T00:00:00Z', stars: 50, issues: 4, pulls: 3 }),
  repo('acme/delta', { archived: true, updatedAt: '2026-06-01T00:00:00Z' }),
  repo('friend/epsilon', { updatedAt: '2025-01-01T00:00:00Z' }),
];
const orgs = ['acme'];

const all: RepoFilter = { query: '', owner: '', sort: 'pushed', hideForks: false, hideArchived: false };
const names = (list: Repo[]) => list.map((r) => r.fullName);

test('sorts by last push', () => {
  assert.deepEqual(names(filterRepos(repos, all, 'me', orgs)), ['acme/delta', 'me/beta', 'acme/gamma', 'me/alpha', 'friend/epsilon']);
});

test('sorts by stars, by open issues and PRs, and by name', () => {
  assert.deepEqual(names(filterRepos(repos, { ...all, sort: 'stars' }, 'me', orgs)).slice(0, 2), ['acme/gamma', 'me/alpha']);
  assert.deepEqual(names(filterRepos(repos, { ...all, sort: 'issues' }, 'me', orgs)).slice(0, 2), ['acme/gamma', 'me/alpha']);
  assert.deepEqual(names(filterRepos(repos, { ...all, sort: 'name' }, 'me', orgs)), [
    'acme/delta',
    'acme/gamma',
    'friend/epsilon',
    'me/alpha',
    'me/beta',
  ]);
});

test('hides forks and archived repositories', () => {
  assert.deepEqual(names(filterRepos(repos, { ...all, hideForks: true, hideArchived: true }, 'me', orgs)), [
    'acme/gamma',
    'me/alpha',
    'friend/epsilon',
  ]);
});

test('filters by owner, case-insensitively, and by "other people"', () => {
  assert.deepEqual(names(filterRepos(repos, { ...all, owner: 'ACME' }, 'me', orgs)), ['acme/delta', 'acme/gamma']);
  assert.deepEqual(names(filterRepos(repos, { ...all, owner: OTHERS }, 'Me', ['ACME'])), ['friend/epsilon']);
});

test('every query word must match the name or description', () => {
  assert.deepEqual(names(filterRepos(repos, { ...all, query: 'me web' }, 'me', orgs)), ['me/alpha']);
  assert.deepEqual(names(filterRepos(repos, { ...all, query: 'GAMMA' }, 'me', orgs)), ['acme/gamma']);
  assert.deepEqual(names(filterRepos(repos, { ...all, query: 'nothing' }, 'me', orgs)), []);
});

test('sorts by your pushes first, then the rest by last push', () => {
  const pushes = [
    { fullName: 'friend/epsilon', branch: 'main', isDefault: true, at: '2025-01-01T00:00:00Z' },
    { fullName: 'me/alpha', branch: 'x', isDefault: false, at: '2026-03-01T00:00:00Z' },
  ];
  assert.deepEqual(names(filterRepos(repos, { ...all, sort: 'mine' }, 'me', orgs, pushes)), [
    'me/alpha',
    'friend/epsilon',
    'acme/delta',
    'me/beta',
    'acme/gamma',
  ]);
});

test('hasOthers and countOwned', () => {
  assert.equal(hasOthers(repos, 'me', orgs), true);
  assert.equal(hasOthers(repos.slice(0, 4), 'me', orgs), false);
  assert.equal(countOwned(repos, 'Me'), 2);
});
