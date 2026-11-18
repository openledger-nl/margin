import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HomeData, MyPush, RawBranch, RawCommit, Repo } from './github.ts';

// github.ts binds fetch when it loads, so the fake goes in first.
const requests: string[] = [];
let branchesFor: (path: string) => RawBranch[] | 'fail' = () => [];
let commitsFor: (path: string) => RawCommit[] | 'fail' = () => [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const path = new URL(String(input)).pathname;
  requests.push(path);
  if (path.endsWith('/commits')) {
    const commits = commitsFor(path);
    if (commits === 'fail') return new Response('nope', { status: 404 });
    return new Response(JSON.stringify({ payload: { commitsRoute: { repo: { defaultBranch: 'main' }, commitGroups: [{ commits }] } } }));
  }
  const branches = branchesFor(path);
  if (branches === 'fail') return new Response('nope', { status: 404 });
  return new Response(JSON.stringify({ payload: { branches } }), { status: 200 });
}) as typeof fetch;
const { fetchMyPushes, newestDefaultCommit, newestOwnBranch, pushCandidates, pushesSettled, recentItems } = await import('./github.ts');
const commit = (pushedDate: string | null, committedDate: string): RawCommit => ({ authoredDate: committedDate, committedDate, pushedDate });

function repo(fullName: string, updatedAt: string, patch: Partial<Repo> = {}): Repo {
  const [owner = '', name = ''] = fullName.split('/');
  return {
    fullName, name, owner, private: true, archived: false, fork: false, description: null, language: null,
    languageColor: null, stars: 0, issues: 0, pulls: 0, updatedAt, pushed: true, contributed: true, ...patch,
  };
}
const branch = (name: string, authoredDate: string, login = 'me', isDefault = false): RawBranch => ({ name, isDefault, authoredDate, author: { login } });

test('newestOwnBranch: newest of yours, others ignored, time zones compared as times', () => {
  const pick = newestOwnBranch(
    [
      branch('main', '2026-11-17T10:00:00Z', 'me', true),
      branch('feature/x', '2026-11-18T12:16:55.000+01:00'), // 11:16 UTC
      branch('theirs', '2026-11-18T20:00:00Z', 'someone'),
      branch('later-local', '2026-11-18T11:30:00.000+00:00'),
    ],
    'Me',
  );
  assert.deepEqual(pick, { branch: 'later-local', isDefault: false, at: '2026-11-18T11:30:00.000+00:00' });
  assert.equal(newestOwnBranch([], 'me'), null);
});

test('newestDefaultCommit: the push date when known, else the commit date', () => {
  const route = (commits: RawCommit[]) => ({ repo: { defaultBranch: 'trunk' }, commitGroups: [{ commits }] });
  assert.deepEqual(newestDefaultCommit(route([commit('2026-11-10T13:00:00Z', '2026-11-10T12:00:00Z')])), {
    branch: 'trunk',
    isDefault: true,
    at: '2026-11-10T13:00:00Z',
  });
  assert.equal(newestDefaultCommit(route([commit(null, '2026-11-10T12:00:00Z')]))?.at, '2026-11-10T12:00:00Z');
  assert.equal(newestDefaultCommit(route([])), null);
  assert.equal(newestDefaultCommit({}), null);
});

test('pushCandidates: yours or contributed, pushed, not archived, last pushed first', () => {
  const repos = [
    repo('me/old', '2026-01-01T00:00:00Z', { contributed: false }),
    repo('acme/new', '2026-11-01T00:00:00Z'),
    repo('acme/notmine', '2026-11-10T00:00:00Z', { contributed: false }),
    repo('me/archived', '2026-11-11T00:00:00Z', { archived: true }),
    repo('me/empty', '2026-11-12T00:00:00Z', { pushed: false }),
  ];
  assert.deepEqual(pushCandidates(repos, 'me').map((r) => r.fullName), ['acme/new', 'me/old']);
});

test('pushesSettled: the nth push of yours must be newer than the next repository', () => {
  const found: MyPush[] = [
    { fullName: 'a/a', branch: 'main', isDefault: true, at: '2026-11-10T00:00:00Z' },
    { fullName: 'b/b', branch: 'main', isDefault: true, at: '2026-11-05T00:00:00Z' },
  ];
  assert.equal(pushesSettled(found, 2, repo('c/c', '2026-11-04T00:00:00Z')), true);
  assert.equal(pushesSettled(found, 2, repo('c/c', '2026-11-06T00:00:00Z')), false);
  assert.equal(pushesSettled(found, 3, repo('c/c', '2026-01-01T00:00:00Z')), false, 'not enough found yet');
  assert.equal(pushesSettled(found, 3, undefined), true, 'no candidates left');
});

test('fetchMyPushes stops asking once the top is settled', async () => {
  // 20 repositories, pushed a day apart; you pushed to each a minute after it was created... except where noted.
  const repos = Array.from({ length: 20 }, (_, i) => repo(`me/r${i}`, new Date(Date.UTC(2026, 10, 30 - i)).toISOString()));
  const day = (i: number) => Date.UTC(2026, 10, 30 - i);
  // r0: your feature branch. r2: a direct push to main, newer than your old feature branch there. r1: not you.
  branchesFor = (path) => {
    const i = Number(/r(\d+)\//.exec(path)?.[1]);
    if (i === 0) return [branch('feature/new', new Date(day(0) - 3600e3).toISOString())];
    if (i === 2) return [branch('feature/old', new Date(day(9)).toISOString())];
    return [];
  };
  commitsFor = (path) => {
    const i = Number(/r(\d+)\//.exec(path)?.[1]);
    if (i === 0 || i === 1) return [];
    if (i === 4) return 'fail'; // the other request still counts
    return [commit(new Date(day(i) - 60e3).toISOString(), new Date(day(i) - 120e3).toISOString())];
  };
  requests.length = 0;
  const pushes = await fetchMyPushes(repos, 'me', 3);
  assert.deepEqual(
    pushes.map((p) => [p.fullName, p.branch, p.isDefault]),
    [
      ['me/r0', 'feature/new', false],
      ['me/r2', 'main', true],
      ['me/r3', 'main', true],
    ],
  );
  assert.equal(requests.length, 12, 'one batch of six repositories, two requests each, was enough');
});

test('fetchMyPushes throws when GitHub answers none of the requests', async () => {
  branchesFor = () => 'fail';
  commitsFor = () => 'fail';
  await assert.rejects(fetchMyPushes([repo('me/a', '2026-11-01T00:00:00Z')], 'me', 3));
});

test('recentItems: your pushes with non-default branches; the guess without them', () => {
  const data: HomeData = {
    login: 'me', fetchedAt: 0, orgs: [], loadedOrgs: [],
    repos: [repo('me/a', '2026-11-10T00:00:00Z'), repo('me/b', '2026-11-12T00:00:00Z')],
    myPushes: [
      { fullName: 'me/a', branch: 'feature/x', isDefault: false, at: '2026-11-09T00:00:00Z' },
      { fullName: 'me/b', branch: 'main', isDefault: true, at: '2026-11-01T00:00:00Z' },
      { fullName: 'gone/repo', branch: 'main', isDefault: true, at: '2026-10-01T00:00:00Z' },
    ],
  };
  assert.deepEqual(recentItems(data, 5).map((i) => [i.repo.fullName, i.branch]), [['me/a', 'feature/x'], ['me/b', null]]);
  assert.deepEqual(recentItems({ ...data, myPushes: null }, 5).map((i) => i.repo.fullName), ['me/b', 'me/a']);
});
