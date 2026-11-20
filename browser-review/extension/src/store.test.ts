import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CreateCommentInput } from '@brm/shared';
import { MemoryDb, Store, StoreError } from './store.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

const target = {
  selectors: ['#save'],
  tag: 'button',
  text: 'Opslaan',
  html: '<button id="save">Opslaan</button>',
  rect: { x: 1, y: 2, width: 3, height: 4 },
  components: ['Form', 'SaveButton'],
  source: 'src/Form.tsx:12',
};

const base: CreateCommentInput = {
  kind: 'comment',
  url: 'http://localhost:5173/cases/12/?tab=2',
  title: 'Zaak 12',
  viewport: { width: 1280, height: 800, dpr: 1 },
  target: null,
  change: null,
  body: 'Too much spacing here',
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof StoreError);
    return err.code;
  }
  assert.fail('expected a StoreError');
};

let db: MemoryDb;
let store: Store;
beforeEach(() => {
  db = new MemoryDb();
  store = new Store(db);
});

describe('create', () => {
  it('groups by origin and normalised path, stores screenshots apart', async () => {
    const c = await store.create({
      ...base,
      kind: 'remove',
      target,
      change: { kind: 'remove' },
      body: '',
      screenshots: { page: PNG, element: PNG },
    });
    assert.equal(c.origin, 'http://localhost:5173');
    assert.equal(c.path, '/cases/12');
    assert.equal(c.status, 'open');
    assert.equal(c.messages[0]?.body, 'Remove this element.');
    assert.deepEqual(c.screenshots.map((s) => `${s.kind}/${s.source}`), ['page/initial', 'element/initial']);
    assert.equal(await store.readScreenshot(c.screenshots[1]!.id), PNG);
    assert.equal((await store.latestScreenshot(c.id, 'element', 'initial'))?.id, c.screenshots[1]!.id);
  });

  it('takes any web page: dev domains and sites turned on are the background\'s call', async () => {
    const c = await store.create({ ...base, url: 'https://shop.test/cart' });
    assert.equal(c.origin, 'https://shop.test');
  });

  it('rejects bad input without leaving a half comment', async () => {
    assert.equal(await code(store.create({ ...base, body: '  ' })), 'bad_input');
    assert.equal(await code(store.create({ ...base, url: 'file:///home/me/index.html' })), 'bad_input');
    assert.equal(await code(store.create({ ...base, kind: 'remove', change: { kind: 'remove' } })), 'bad_input');
    assert.equal(await code(store.create({ ...base, kind: 'edit', target, change: { kind: 'remove' } })), 'bad_input');
    assert.equal(await code(store.create({ ...base, screenshots: { page: 'data:image/png;base64,AAAA' } })), 'bad_input');
    assert.equal(db.comments.size, 0);
    assert.equal(db.shots.size, 0);
  });
});

describe('status flow', () => {
  it('open -> in progress -> review ready -> accepted', async () => {
    const { id } = await store.create(base);
    assert.equal(await code(store.accept(id)), 'invalid_transition');
    assert.equal((await store.startWork(id)).status, 'in_progress');
    assert.equal((await store.startWork(id)).status, 'in_progress'); // twice is fine
    const ready = await store.submitSolution(id, 'Removed the margin.', [' src/App.tsx ', '']);
    assert.equal(ready.status, 'review_ready');
    assert.deepEqual(ready.solution?.files, ['src/App.tsx']);
    assert.equal(await code(store.startWork(id)), 'invalid_transition');
    assert.equal((await store.accept(id)).status, 'accepted');
    assert.equal(await code(store.submitSolution(id, 'again')), 'invalid_transition');
  });

  it('reopen moves the old solution into the thread', async () => {
    const { id } = await store.create(base);
    await store.submitSolution(id, 'Changed the padding.', ['a.css']);
    const c = await store.reopen(id, 'Still too wide');
    assert.equal(c.status, 'open');
    assert.equal(c.solution, null);
    const bodies = c.messages.map((m) => m.body);
    assert.ok(bodies.includes('Previous solution (not accepted):\nChanged the padding.\nFiles: a.css'));
    assert.ok(bodies.includes('Still too wide'));
    assert.equal(await code(store.reopen(id)), 'invalid_transition');
  });

  it('replies from user and Claude, empty ones rejected', async () => {
    const { id } = await store.create(base);
    await store.addMessage(id, 'claude', 'Which color?');
    const c = await store.addMessage(id, 'user', ' Blue ');
    assert.deepEqual(
      c.messages.map((m) => [m.author, m.body]),
      [
        ['user', 'Too much spacing here'],
        ['claude', 'Which color?'],
        ['user', 'Blue'],
      ],
    );
    assert.equal(await code(store.addMessage(id, 'user', '  ')), 'bad_input');
    assert.equal(await code(store.addMessage(999, 'user', 'x')), 'not_found');
  });
});

describe('list, delete, concurrency', () => {
  it('filters by origin, path and status', async () => {
    const a = await store.create(base);
    await store.create({ ...base, url: 'http://localhost:3000/' });
    await store.startWork(a.id);
    assert.equal((await store.list()).length, 2);
    assert.equal((await store.list({ origin: 'http://localhost:3000' })).length, 1);
    assert.deepEqual((await store.list({ statuses: ['in_progress'] })).map((c) => c.id), [a.id]);
    assert.equal((await store.list({ path: '/cases/12' })).length, 1);
  });

  it('delete removes the comment and its screenshots', async () => {
    const { id } = await store.create({ ...base, screenshots: { page: PNG } });
    await store.delete(id);
    assert.equal(await store.get(id), null);
    assert.equal(db.shots.size, 0);
    assert.equal(await code(store.delete(id)), 'not_found');
  });

  it('parallel writes to one comment are not lost', async () => {
    const { id } = await store.create(base);
    await Promise.all([
      store.addMessage(id, 'user', 'one'),
      store.addMessage(id, 'claude', 'two'),
      store.startWork(id),
      store.addScreenshot(id, 'page', 'capture', PNG),
    ]);
    const c = await store.mustGet(id);
    assert.equal(c.status, 'in_progress');
    assert.ok(c.messages.some((m) => m.body === 'one'));
    assert.ok(c.messages.some((m) => m.body === 'two'));
    assert.equal(c.screenshots.length, 1);
  });
});
