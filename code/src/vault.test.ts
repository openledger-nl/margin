import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomic';
import { locateVault } from './locate';
import { buildConversations, resumable, suggestProject, suggestThread } from './model';
import { UnsupportedFormatError, Vault } from './vault';

let root: string;
let vault: Vault;
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

async function put(rel: string, text: string) {
  const file = path.join(root, ...rel.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'margin-vault-'));
  vault = new Vault(root);
  await put('projects/web/project.md', '---\nname: Web app\n---\n');
  await put('projects/alpha/project.md', '---\ncolumns: []\n---\n');
  await put('projects/web/threads/existing/thread.md', '---\ntitle: Existing thread\ncreatedAt: 2026-11-01T00:00:00.000Z\n---\n');
  await put('projects/.hidden/project.md', '---\nname: no\n---\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const newReview = (over: Partial<Parameters<Vault['createReview']>[2]> = {}) => ({
  repo: 'github.com/o/r',
  repoName: 'r',
  base: SHA,
  baseRef: 'main',
  head: SHA2,
  headRef: 'feat/x',
  author: 'Milan',
  ...over,
});

describe('Vault', () => {
  it("lists Ledger's projects (name, else folder) and threads", async () => {
    expect(await vault.listProjects()).toEqual([
      { slug: 'alpha', name: 'alpha' },
      { slug: 'web', name: 'Web app' },
    ]);
    expect(await vault.listThreads('web')).toEqual([
      { project: 'web', slug: 'existing', title: 'Existing thread', createdAt: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(await vault.listThreads('nope')).toEqual([]);
  });

  it('creates threads the way Ledger names them, never reusing a folder', async () => {
    const a = await vault.createThread('web', 'Existing thread');
    const b = await vault.createThread('web', 'Existing thread');
    const c = await vault.createThread('alpha', 'r: feat/x');
    expect([a.slug, b.slug, c.slug]).toEqual(['existing-thread', 'existing-thread-2', 'r-feat-x']);
    const text = await readFile(path.join(root, 'projects/web/threads/existing-thread/thread.md'), 'utf8');
    expect(text).toMatch(/^---\ntitle: Existing thread\ncreatedAt: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\n---\n$/);
  });

  it('writes a draft review and reads it back', async () => {
    const r = await vault.createReview('web', 'existing', newReview());
    expect(vault.relative(r.file)).toBe(`projects/web/threads/existing/reviews/${r.id}.md`);
    const back = await vault.readReview(r.file);
    expect(back).toMatchObject({ id: r.id, project: 'web', thread: 'existing', supported: true, summary: '' });
    expect(back?.meta).toEqual(r.meta);
    expect(r.meta.state).toBe('draft');
    expect(r.meta.createdAt).toBe(r.meta.updatedAt);
  });

  it('submits a review, keeping keys it does not know', async () => {
    const r = await vault.createReview('web', 'existing', newReview());
    const original = await readFile(r.file, 'utf8');
    await writeFile(r.file, original.replace('state: draft\n', 'state: draft\nledgerNote: keep # me\n'));
    const done = await vault.updateReview(
      r.file,
      { state: 'submitted', verdict: 'approve', submittedAt: '2026-11-09T11:00:00.000Z' },
      'Ship it.',
    );
    expect(done.meta).toMatchObject({ state: 'submitted', verdict: 'approve', submittedAt: '2026-11-09T11:00:00.000Z' });
    expect(done.summary).toBe('Ship it.');
    const text = await readFile(r.file, 'utf8');
    expect(text).toContain('state: submitted\nverdict: approve\nledgerNote: keep # me\n');
    expect(text.endsWith('---\n\nShip it.\n')).toBe(true);
  });

  it('writes, edits and deletes comments and replies', async () => {
    const r = await vault.createReview('web', 'existing', newReview());
    const c = await vault.createComment(
      r.file,
      { path: 'src/a.ts', side: 'new', line: 3, endLine: 4, commit: SHA2, code: 'x\ny\n', codeBefore: 'w\n', resolved: false, author: 'Milan' },
      'Why?',
    );
    const reply = await vault.createComment(r.file, { replyTo: c.id, author: 'Milan' }, 'Because.');
    expect(await vault.countComments(r.file)).toBe(2);

    const listed = await vault.listComments(r.file);
    expect(listed.map((x) => x.id)).toEqual([c.id, reply.id]);
    expect(listed[0]?.meta).toMatchObject({ path: 'src/a.ts', side: 'new', line: 3, endLine: 4, code: 'x\ny\n', resolved: false });
    expect(listed[1]?.meta.path).toBeUndefined();

    const edited = await vault.updateComment(c.file, { resolved: true }, 'Why, though?');
    expect(edited.body).toBe('Why, though?');
    expect(edited.meta.resolved).toBe(true);
    expect(edited.meta.updatedAt >= edited.meta.createdAt).toBe(true);

    await vault.deleteComment(reply.file);
    await vault.deleteComment(c.file);
    expect(await vault.listComments(r.file)).toEqual([]);
    // The emptied comments folder goes too.
    expect(await readdir(path.dirname(r.file))).toEqual([`${r.id}.md`]);
  });

  it('leaves files of a newer format alone', async () => {
    const r = await vault.createReview('web', 'existing', newReview());
    const dir = vault.commentsDir(r.file);
    await put(vault.relative(path.join(dir, '1-future00.md')), '---\nformat: 2\npath: a\n---\nFrom the future\n');
    const [future] = await vault.listComments(r.file);
    expect(future?.supported).toBe(false);
    await expect(vault.updateComment(future!.file, { resolved: true })).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expect(vault.deleteComment(future!.file)).rejects.toBeInstanceOf(UnsupportedFormatError);

    await writeFile(r.file, (await readFile(r.file, 'utf8')).replace('format: 1', 'format: 3'));
    expect((await vault.readReview(r.file))?.supported).toBe(false);
    await expect(vault.updateReview(r.file, { state: 'submitted' })).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('finds every review, and suggests the project and thread to continue in', async () => {
    const t = await vault.createThread('alpha', 'Other');
    const first = await vault.createReview('web', 'existing', newReview());
    await vault.updateReview(first.file, { state: 'submitted', verdict: 'changes' });
    const second = await vault.createReview(t.project, t.slug, newReview({ headRef: 'feat/y' }));
    await vault.createReview('web', 'existing', newReview({ repo: 'github.com/o/other' }));
    await put('projects/web/threads/existing/reviews/.tmp.md', '---\nrepo: x\n---\n');
    await put('projects/web/threads/existing/reviews/notes.md', 'not a review');

    const reviews = await vault.listReviews();
    expect(reviews).toHaveLength(3);
    expect(suggestProject(reviews, 'github.com/o/r')).toBe('alpha');
    expect(suggestProject(reviews, 'github.com/o/none')).toBeUndefined();
    expect(suggestThread(reviews, 'github.com/o/r', 'web', { ref: 'feat/x', sha: SHA2 })).toBe('existing');
    expect(suggestThread(reviews, 'github.com/o/r', 'alpha', { ref: 'feat/x', sha: SHA2 })).toBeUndefined();
    expect(suggestThread(reviews, 'github.com/o/r', 'alpha', { ref: 'feat/y', sha: SHA2 })).toBe(t.slug);
    expect(suggestThread(reviews, 'github.com/o/r', 'web', { sha: SHA2 })).toBe('existing');

    const drafts = resumable(reviews, new Set(['github.com/o/r']));
    expect(drafts.map((d) => d.id)).toEqual([second.id]);
  });
});

describe('conversations', () => {
  it('groups replies under the first comment and keeps orphans apart', async () => {
    const r = await vault.createReview('web', 'existing', newReview());
    const root = await vault.createComment(r.file, { path: 'a', side: 'new', line: 1, endLine: 1, commit: SHA2, code: 'a\n', resolved: false, author: 'M' }, 'Root');
    const reply = await vault.createComment(r.file, { replyTo: root.id, author: 'M' }, 'Reply');
    const nested = await vault.createComment(r.file, { replyTo: reply.id, author: 'M' }, 'Reply to reply');
    const orphan = await vault.createComment(r.file, { replyTo: '1-gone0000', author: 'M' }, 'Orphan');
    const { conversations, orphans } = buildConversations(await vault.listComments(r.file));
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.root.id).toBe(root.id);
    expect(conversations[0]?.replies.map((c) => c.id)).toEqual([reply.id, nested.id]);
    expect(orphans.map((c) => c.id)).toEqual([orphan.id]);
  });
});

describe('writeFileAtomic', () => {
  it('replaces the file and leaves no temp file behind', async () => {
    const file = path.join(root, 'x.md');
    await writeFileAtomic(file, 'one');
    await writeFileAtomic(file, 'two');
    expect(await readFile(file, 'utf8')).toBe('two');
    expect(await readdir(root)).toEqual(expect.not.arrayContaining([expect.stringMatching(/^\./)]));
  });
});

describe('locateVault', () => {
  // `root` is set per test, so the input is made per test too. No Documents folder unless a test gives one.
  const base = () => ({ platform: process.platform, homedir: root, documents: async () => undefined });

  it('takes the setting first, then LEDGER_VAULT, then Ledger config.json', async () => {
    const cfg = path.join(root, 'cfg');
    await mkdir(cfg);
    await writeFile(path.join(cfg, 'config.json'), JSON.stringify({ vaultPath: root, updates: { automatic: true } }));
    const env = { LEDGER_CONFIG_DIR: cfg };
    expect(await locateVault({ ...base(), setting: root, env: { LEDGER_VAULT: '/nope' } })).toEqual({ ok: true, path: root, source: 'setting' });
    expect(await locateVault({ ...base(), setting: '', env: { ...env, LEDGER_VAULT: root } })).toEqual({ ok: true, path: root, source: 'env' });
    expect(await locateVault({ ...base(), setting: undefined, env })).toEqual({ ok: true, path: root, source: 'config' });
  });

  it("falls back to Ledger's default: Ledger in Documents", async () => {
    const documents = path.join(root, 'My Documents');
    await mkdir(path.join(documents, 'Ledger'), { recursive: true });
    const input = { ...base(), documents: async () => documents, setting: undefined };
    const expected = { ok: true, path: path.join(documents, 'Ledger'), source: 'default' };
    // No config.json, one without vaultPath, an unreadable one: Ledger reads all three as "use the default".
    const cfg = path.join(root, 'cfg');
    expect(await locateVault({ ...input, env: { LEDGER_CONFIG_DIR: cfg } })).toEqual(expected);
    await mkdir(cfg);
    for (const text of ['{"updates":{}}', '{"vaultPath":"  "}', '{"vaultPath":42}', 'not json', 'null']) {
      await writeFile(path.join(cfg, 'config.json'), text);
      expect(await locateVault({ ...input, env: { LEDGER_CONFIG_DIR: cfg } }), text).toEqual(expected);
    }
  });

  it('falls back to vault in Ledger\'s config folder when there is no Documents folder', async () => {
    const cfg = path.join(root, 'cfg');
    await mkdir(path.join(cfg, 'vault'), { recursive: true });
    expect(await locateVault({ ...base(), setting: undefined, env: { LEDGER_CONFIG_DIR: cfg } })).toEqual({
      ok: true,
      path: path.join(cfg, 'vault'),
      source: 'default',
    });
  });

  it('says plainly why there is no vault', async () => {
    const documents = path.join(root, 'Documents');
    await mkdir(documents);
    const missing = await locateVault({ ...base(), documents: async () => documents, setting: undefined, env: { LEDGER_CONFIG_DIR: path.join(root, 'none') } });
    expect(missing).toEqual({
      ok: false,
      reason: `margin.vaultPath, LEDGER_VAULT and Ledger's config.json name no vault, and Ledger's default vault (${path.join(documents, 'Ledger')}) isn't there.`,
    });
    const wrong = await locateVault({ ...base(), setting: path.join(root, 'nope'), env: {} });
    expect(wrong).toMatchObject({ ok: false, reason: expect.stringContaining("isn't a folder") });
    // A config.json that names a folder that isn't there is an error, not a reason to try the default.
    const cfg = path.join(root, 'cfg');
    await mkdir(cfg);
    await mkdir(path.join(documents, 'Ledger'));
    await writeFile(path.join(cfg, 'config.json'), JSON.stringify({ vaultPath: path.join(root, 'moved') }));
    expect(await locateVault({ ...base(), documents: async () => documents, setting: undefined, env: { LEDGER_CONFIG_DIR: cfg } })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Ledger's config.json points to"),
    });
  });
});
