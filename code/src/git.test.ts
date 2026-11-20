// Runs the real git against throwaway repositories.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapLine, relocate, splitLines } from './anchor';
import { Git } from './git';

const git = new Git();
let repo: string;
let bare: string;

function g(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test Person', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } },
  ).trim();
}

const original = ['header', 'function a() {', '  return 1;', '}', '', 'function b() {', '  return 2;', '}', ''].join('\n');

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'margin-git-'));
  bare = await mkdtemp(path.join(tmpdir(), 'margin-bare-'));
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'config', 'user.name', 'Test Person');
  await writeFile(path.join(repo, 'a.ts'), original);
  await writeFile(path.join(repo, 'gone.txt'), 'bye\n');
  await writeFile(path.join(repo, 'old name.txt'), 'same content\nfor rename\ndetection\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'first');
  g(repo, 'checkout', '-q', '-b', 'feat/x');
  await writeFile(path.join(repo, 'a.ts'), ['header', 'inserted', 'more', 'function a() {', '  return 1;', '}', '', 'function b() {', '  return 22;', '}', ''].join('\n'));
  await rm(path.join(repo, 'gone.txt'));
  g(repo, 'mv', 'old name.txt', 'new name.txt');
  await writeFile(path.join(repo, 'added.md'), '# new\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-q', '-m', 'second');
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
});

describe('Git', () => {
  it('finds the root, HEAD and branch', async () => {
    expect(await git.toplevel(path.join(repo))).toBe(path.resolve(repo));
    expect(await git.toplevel(tmpdir())).toBeUndefined();
    expect(await git.head(repo)).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.currentBranch(repo)).toBe('feat/x');
    expect(await git.userName(repo)).toBe('Test Person');
  });

  it('defaults the base to the merge base with main', async () => {
    const def = await git.defaultBranch(repo);
    expect(def).toEqual({ ref: 'main', name: 'main' });
    const base = await git.mergeBase(repo, 'HEAD', def!.ref);
    expect(base).toBe(await git.resolveCommit(repo, 'main'));
    expect(await git.resolveCommit(repo, '-x')).toBeUndefined();
    expect(await git.resolveCommit(repo, 'nope')).toBeUndefined();
    expect(await git.isBranch(repo, 'main')).toBe(true);
    expect(await git.isBranch(repo, 'HEAD~1')).toBe(false);
  });

  it('lists changed files with renames', async () => {
    const base = (await git.resolveCommit(repo, 'main'))!;
    const head = (await git.head(repo))!;
    const files = await git.changedFiles(repo, base, head);
    expect(files).toEqual(
      expect.arrayContaining([
        { status: 'M', path: 'a.ts' },
        { status: 'D', path: 'gone.txt' },
        { status: 'A', path: 'added.md' },
        { status: 'R', path: 'new name.txt', oldPath: 'old name.txt' },
      ]),
    );
    expect(files).toHaveLength(4);
  });

  it('shows a file at a commit, and nothing for a path that is not there', async () => {
    const base = (await git.resolveCommit(repo, 'main'))!;
    expect((await git.show(repo, base, 'a.ts'))?.toString('utf8')).toBe(original);
    expect(await git.show(repo, base, 'added.md')).toBeUndefined();
    expect(await git.show(repo, base, 'old name.txt')).toBeDefined();
  });

  it('maps a line through the diff and finds the code again', async () => {
    const base = (await git.resolveCommit(repo, 'main'))!;
    const head = (await git.head(repo))!;
    const hunks = await git.hunks(repo, base, head, 'a.ts', 'a.ts');
    expect(mapLine(hunks, 3)).toBe(5); // "  return 1;" moved down by two inserted lines
    const now = splitLines((await git.show(repo, head, 'a.ts'))!.toString('utf8'));
    expect(relocate({ code: '  return 1;\n', codeBefore: 'function a() {\n' }, now, mapLine(hunks, 3))).toEqual({ line: 5, endLine: 5 });
    expect(relocate({ code: '  return 2;\n' }, now, mapLine(hunks, 7))).toBeUndefined();
    expect(await git.hunks(repo, base, head, 'old name.txt', 'new name.txt')).toEqual([]);
  });

  it('names a repo without remotes after its root commit, and one with remotes after origin', async () => {
    const first = g(repo, 'rev-list', '--max-parents=0', 'HEAD');
    expect(await git.identity(repo)).toBe(`git:${first}`);
    g(repo, 'remote', 'add', 'upstream', 'https://Example.com/up/stream.git');
    expect(await git.identity(repo)).toBe('example.com/up/stream');
    g(repo, 'remote', 'add', 'origin', 'git@github.com:openledger-nl/margin.git');
    expect(await git.identity(repo)).toBe('github.com/openledger-nl/margin');
    g(repo, 'remote', 'remove', 'origin');
    g(repo, 'remote', 'remove', 'upstream');
  });

  it('prefers origin/HEAD as the default branch', async () => {
    g(bare, 'init', '-q', '--bare');
    g(repo, 'remote', 'add', 'origin', bare);
    g(repo, 'push', '-q', 'origin', 'main');
    g(repo, 'fetch', '-q', 'origin');
    g(repo, 'remote', 'set-head', 'origin', 'main');
    expect(await git.defaultBranch(repo)).toEqual({ ref: 'origin/main', name: 'main' });
    // A local path remote has no host: the identity falls back to the root commit.
    expect(await git.identity(repo)).toMatch(/^git:[0-9a-f]{40}$/);
    const branches = await git.branches(repo);
    expect(branches.map((b) => b.name)).toEqual(expect.arrayContaining(['main', 'feat/x', 'origin/main']));
    expect(branches.find((b) => b.name === 'origin/main')?.remote).toBe(true);
  });

  it('lists recent commits and knows which commits it has', async () => {
    const commits = await git.recentCommits(repo, 5);
    expect(commits.map((c) => c.subject)).toEqual(['second', 'first']);
    expect(await git.hasCommit(repo, commits[0]!.sha)).toBe(true);
    expect(await git.hasCommit(repo, 'f'.repeat(40))).toBe(false);
    expect(await git.hasCommit(repo, '--help')).toBe(false);
    expect(await git.isAncestor(repo, commits[1]!.sha, commits[0]!.sha)).toBe(true);
    expect(await git.isAncestor(repo, commits[0]!.sha, commits[1]!.sha)).toBe(false);
  });
});
