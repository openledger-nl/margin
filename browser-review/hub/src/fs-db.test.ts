import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type CreateCommentInput } from '@brm/shared';
import { FsDb } from './fs-db.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

const input: CreateCommentInput = {
  kind: 'comment',
  url: 'https://staging.acme.com/pricing',
  title: 'Pricing',
  viewport: { width: 1440, height: 900, dpr: 1 },
  target: null,
  change: null,
  body: 'The button is too light',
  screenshots: { page: PNG },
};

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'margin-hub-'));
  dirs.push(d);
  return d;
}

describe('FsDb', () => {
  it('stores a comment as JSON, Markdown and PNG, and reads it back after a restart', async () => {
    const dir = await tempDir();
    const store = new Store(await FsDb.open(dir, 'acme-shop'));
    const c = await store.create(input, 'Anna (client)');
    assert.deepEqual((await readdir(join(dir, 'feedback'))).sort(), ['0001-1.png', '0001.md']);
    assert.deepEqual(await readdir(join(dir, 'comments')), ['0001.json']);

    const md = await readFile(join(dir, 'feedback', '0001.md'), 'utf8');
    assert.match(md, /^---\nid: 1\nproject: "acme-shop"\nstatus: "open"/);
    assert.match(md, /reviewers: "Anna \(client\)"/);
    assert.match(md, /- User "Anna \(client\)" \(.+\): The button is too light/);
    assert.match(md, /!\[Page, when the comment was made\]\(0001-1\.png\)/);

    const again = new Store(await FsDb.open(dir, 'acme-shop'));
    assert.deepEqual(await again.mustGet(c.id), c);
    assert.equal(await again.readScreenshot(c.screenshots[0]!.id), PNG);
    const next = await again.create({ ...input, screenshots: undefined });
    assert.equal(next.id, 2, 'ids continue after a restart');
  });

  it('rewrites the Markdown on every change', async () => {
    const dir = await tempDir();
    const store = new Store(await FsDb.open(dir, 'acme-shop'));
    const c = await store.create(input, 'Anna (client)');
    await store.startWork(c.id, 'Andor');
    await store.submitSolution(c.id, 'Darker blue, contrast 7:1.', ['src/Button.tsx'], 'Andor');
    const md = await readFile(join(dir, 'feedback', '0001.md'), 'utf8');
    assert.match(md, /status: "review_ready"/);
    assert.match(md, /## Submitted solution\nDarker blue, contrast 7:1\.\nFiles: src\/Button\.tsx/);
  });

  it('removes every file of a deleted comment and remembers the deletion', async () => {
    const dir = await tempDir();
    const db = await FsDb.open(dir, 'acme-shop');
    const store = new Store(db);
    const c = await store.create(input);
    const before = new Date(Date.now() - 1000).toISOString();
    await store.delete(c.id);
    assert.deepEqual(await readdir(join(dir, 'feedback')), []);
    assert.deepEqual(await readdir(join(dir, 'comments')), []);
    assert.deepEqual(db.deletedSince(before), [c.id]);
    assert.deepEqual(db.deletedSince(new Date(Date.now() + 1000).toISOString()), []);
    assert.deepEqual((await FsDb.open(dir, 'acme-shop')).deletedSince(null), [c.id]);
  });

  it('leaves no temporary files behind', async () => {
    const dir = await tempDir();
    const store = new Store(await FsDb.open(dir, 'acme-shop'));
    await Promise.all([store.create(input), store.create(input), store.create(input)]);
    const all = [...(await readdir(dir)), ...(await readdir(join(dir, 'comments'))), ...(await readdir(join(dir, 'feedback')))];
    assert.equal(all.filter((f) => f.endsWith('.tmp')).length, 0);
  });
});
