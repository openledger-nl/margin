// A whole review against a real repository and a real vault folder.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Frontmatter } from './frontmatter';
import { Git } from './git';
import { MissingCommitError, ReadOnlyError, ReviewSession } from './session';
import { Vault } from './vault';

const git = new Git();
let repo: string;
let vaultRoot: string;
let vault: Vault;

function g(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Rev Iewer', '-c', 'user.email=r@example.com', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, encoding: 'utf8' },
  ).trim();
}

async function commit(files: Record<string, string | null>, message: string): Promise<string> {
  for (const [name, text] of Object.entries(files)) {
    if (text === null) await rm(path.join(repo, name));
    else await writeFile(path.join(repo, name), text);
  }
  g('add', '-A');
  g('commit', '-q', '-m', message);
  return g('rev-parse', 'HEAD');
}

const v1 = ['// app', 'export function total(xs) {', '  let sum = 0;', '  for (const x of xs) sum += x;', '  return sum;', '}', ''].join('\n');

let base: string;
let head: string;

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'margin-session-repo-'));
  vaultRoot = await mkdtemp(path.join(tmpdir(), 'margin-session-vault-'));
  vault = new Vault(vaultRoot);
  await mkdir(path.join(vaultRoot, 'projects', 'p', 'threads', 't'), { recursive: true });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Rev Iewer');
  base = await commit({ 'app.js': '// app\n', 'old.txt': 'old\n' }, 'base');
  g('checkout', '-q', '-b', 'feat');
  head = await commit({ 'app.js': v1, 'old.txt': null, 'new.txt': 'new\n' }, 'feature');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(vaultRoot, { recursive: true, force: true });
});

async function open(): Promise<ReviewSession> {
  const record = await vault.createReview('p', 't', { repo: 'github.com/o/r', repoName: 'r', base, baseRef: 'main', head, headRef: 'feat', author: 'Rev Iewer' });
  return ReviewSession.open(vault, git, record.file, repo);
}

describe('ReviewSession', () => {
  it('lists the changed files and writes a comment with its code at once', async () => {
    const s = await open();
    expect(s.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual(['A new.txt', 'D old.txt', 'M app.js']);
    let changes = 0;
    s.onDidChange(() => changes++);

    const c = await s.addComment({ side: 'new', path: 'app.js', line: 3, endLine: 4 }, 'Use reduce?');
    expect(changes).toBe(1);
    const fm = Frontmatter.parse(await readFile(c.file, 'utf8'))!;
    expect(fm.get('path')).toBe('app.js');
    expect(fm.get('side')).toBe('new');
    expect(fm.get('commit')).toBe(head);
    expect(fm.get('code')).toBe('  let sum = 0;\n  for (const x of xs) sum += x;\n');
    expect(fm.get('codeBefore')).toBe('// app\nexport function total(xs) {\n');
    expect(fm.get('codeAfter')).toBe('  return sum;\n}\n');
    expect(fm.get('resolved')).toBe(false);
    expect(fm.get('author')).toBe('Rev Iewer');
    expect(fm.body).toBe('Use reduce?');
    expect(s.placements.get(c.id)).toEqual({ kind: 'line', side: 'new', path: 'app.js', line: 3, endLine: 4 });
  });

  it('comments on the base side and on whole files', async () => {
    const s = await open();
    const old = await s.addComment({ side: 'old', path: 'old.txt', line: 1 }, 'Why remove this?');
    const whole = await s.addComment({ side: 'new', path: 'new.txt' }, 'Is this file needed?');
    expect(old.meta).toMatchObject({ side: 'old', commit: base, line: 1, endLine: 1, code: 'old\n' });
    expect(whole.meta.line).toBeUndefined();
    expect(whole.meta.code).toBeUndefined();
    expect(s.placements.get(whole.id)).toEqual({ kind: 'file', side: 'new', path: 'new.txt' });
  });

  it('replies, edits, resolves and deletes conversations', async () => {
    const s = await open();
    const root = await s.addComment({ side: 'new', path: 'app.js', line: 2 }, 'Name?');
    const reply = await s.reply(root.id, 'Fine as is.');
    expect(reply.meta).toMatchObject({ replyTo: root.id });
    expect(reply.meta.path).toBeUndefined();
    expect(s.conversations[0]?.replies.map((r) => r.id)).toEqual([reply.id]);

    await s.edit(reply.id, 'Fine as it is.');
    await s.setResolved(root.id, true);
    expect(s.comments.find((c) => c.id === reply.id)?.body).toBe('Fine as it is.');
    expect(s.conversations[0]?.root.meta.resolved).toBe(true);

    await s.remove(reply.id);
    expect(s.comments.map((c) => c.id)).toEqual([root.id]);
    await s.reply(root.id, 'again');
    await s.remove(root.id);
    expect(s.comments).toEqual([]);
  });

  it('picks up changes made elsewhere on reload', async () => {
    const s = await open();
    const other = await ReviewSession.open(vault, git, s.file, repo);
    const c = await other.addComment({ side: 'new', path: 'app.js', line: 5 }, 'From my laptop');
    expect(s.comments).toEqual([]);
    expect(await s.reload()).toBe('loaded');
    expect(s.comments.map((x) => x.id)).toEqual([c.id]);
    await rm(s.file);
    expect(await s.reload()).toBe('gone');
  });

  it('finds comments again after the review moves to a newer commit, and lists the rest as outdated', async () => {
    const s = await open();
    const moving = await s.addComment({ side: 'new', path: 'app.js', line: 5 }, 'return early?');
    const vanishing = await s.addComment({ side: 'new', path: 'app.js', line: 4 }, 'loop');
    const removed = await s.addComment({ side: 'new', path: 'new.txt', line: 1 }, 'gone later');
    const v2 = ['// app', '// docs', '// more docs', 'export function total(xs) {', '  let sum = 0;', '  xs.forEach((x) => { sum += x; });', '  return sum;', '}', ''].join('\n');
    const next = await commit({ 'app.js': v2, 'new.txt': null }, 'follow-up');

    await s.moveHead(next, 'feat');
    expect(s.review.head).toBe(next);
    expect(s.placements.get(moving.id)).toEqual({
      kind: 'line', side: 'new', path: 'app.js', line: 7, endLine: 7, moved: { line: 5, commit: head, path: 'app.js' },
    });
    expect(s.placements.get(vanishing.id)).toMatchObject({ kind: 'outdated' });
    expect(s.placements.get(removed.id)).toMatchObject({ kind: 'outdated', reason: expect.stringContaining('removed') });
  });

  it('submits once, and is read-only after', async () => {
    const s = await open();
    await s.addComment({ side: 'new', path: 'app.js', line: 2 }, 'nit');
    await s.saveSummary('Draft summary');
    expect(s.record.summary).toBe('Draft summary');
    await s.submit('changes', 'Please fix the nit.');
    expect(s.review).toMatchObject({ state: 'submitted', verdict: 'changes' });
    expect(s.review.submittedAt).toBe(s.review.updatedAt);
    expect(s.readOnly).toBe(true);
    await expect(s.addComment({ side: 'new', path: 'app.js', line: 1 }, 'late')).rejects.toBeInstanceOf(ReadOnlyError);
    const text = await readFile(s.file, 'utf8');
    expect(text).toMatch(/state: submitted\nverdict: changes\nauthor: Rev Iewer\n/);
    expect(text.endsWith('\nPlease fix the nit.\n')).toBe(true);
  });

  it('says which commits a clone is missing', async () => {
    const record = await vault.createReview('p', 't', { repo: 'x', repoName: 'r', base, head: 'f'.repeat(40), author: 'R' });
    await expect(ReviewSession.open(vault, git, record.file, repo)).rejects.toBeInstanceOf(MissingCommitError);
  });
});
