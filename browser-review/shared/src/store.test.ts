import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReviewError, type CreateCommentInput } from '@brm/shared';
import { MemoryDb, Store } from './store.ts';

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
    assert.ok(err instanceof ReviewError);
    return err.code;
  }
  assert.fail('expected a ReviewError');
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

describe('who did it', () => {
  it('stores the name on every message an action adds, and none without it', async () => {
    const c = await store.create(base, 'Anna (client)');
    assert.equal(c.messages[0]?.name, 'Anna (client)');
    await store.startWork(c.id, 'Andor');
    await store.submitSolution(c.id, 'Less padding.', [], 'Andor');
    const reopened = await store.reopen(c.id, 'Still too much', 'Anna (client)');
    assert.deepEqual(
      reopened.messages.map((m) => [m.author, m.name]),
      [
        ['user', 'Anna (client)'],
        ['system', 'Andor'],
        ['system', 'Andor'],
        ['system', 'Anna (client)'],
        ['user', 'Anna (client)'],
        ['system', 'Anna (client)'],
      ],
    );
    const local = await store.create(base);
    assert.equal('name' in local.messages[0]!, false);
  });
});

describe('copies of review-hub comments', () => {
  /** A comment as a hub returns it, made in its own store. */
  async function hubComment(body = 'Logo too small') {
    const hub = new Store(new MemoryDb());
    const c = await hub.create({ ...base, url: 'https://staging.acme.com/', body, screenshots: { page: PNG } }, 'Anna (client)');
    return { hub, c };
  }

  it('imports a hub comment with a local id, its project and the hub id, and its screenshots', async () => {
    await store.create(base); // local #1, so the copy gets another id than on the hub
    const { c } = await hubComment();
    const shotId = c.screenshots[0]!.id;
    const { comment, added } = await store.importRemote('p1', c, new Map([[shotId, PNG]]));
    assert.equal(added, true);
    assert.equal(comment.id, 2);
    assert.equal(comment.project, 'p1');
    assert.equal(comment.remoteId, c.id);
    assert.equal(comment.screenshots[0]?.remoteId, shotId);
    assert.equal(await store.readScreenshot(comment.screenshots[0]!.id), PNG);
    assert.equal(comment.messages[0]?.name, 'Anna (client)');
  });

  it('updates the same copy on the next pull, and only fetches new screenshots', async () => {
    const { hub, c } = await hubComment();
    const first = await store.importRemote('p1', c, new Map([[c.screenshots[0]!.id, PNG]]));
    const again = await store.importRemote('p1', c);
    assert.equal(again.changed, false);
    const replied = await hub.addMessage(c.id, 'user', 'Still small', 'Anna (client)');
    const second = await store.importRemote('p1', replied);
    assert.equal(second.added, false);
    assert.equal(second.comment.id, first.comment.id);
    assert.equal(second.comment.messages.length, 2);
    assert.deepEqual(second.comment.screenshots, first.comment.screenshots);
    assert.equal((await store.list()).length, 1);
  });

  it('keeps hub copies apart per project and from local comments', async () => {
    const { c } = await hubComment();
    await store.importRemote('p1', c);
    await store.importRemote('p2', c);
    await store.create(base);
    assert.equal((await store.list({ project: 'p1' })).length, 1);
    assert.equal((await store.list({ project: null })).length, 1);
    assert.equal((await store.list()).length, 3);
    assert.equal((await store.findRemote('p2', c.id))?.project, 'p2');
  });

  it('drops a copy the customer deleted, and every copy of a removed project', async () => {
    const { c } = await hubComment();
    const other = (await hubComment('Footer')).c;
    await store.importRemote('p1', c);
    await store.importRemote('p2', other);
    assert.equal(await store.deleteRemote('p1', c.id), true);
    assert.equal(await store.deleteRemote('p1', c.id), false);
    assert.equal(await store.deleteProject('p2'), 1);
    assert.equal((await store.list()).length, 0);
  });
});

describe('the outbox: agent updates the developer has not sent yet', () => {
  async function pulled() {
    const hub = new Store(new MemoryDb());
    const remote = await hub.create({ ...base, url: 'https://staging.acme.com/', body: 'Logo too small' }, 'Anna (client)');
    const { comment } = await store.importRemote('p1', remote);
    return { hub, remote, copy: comment };
  }

  it('applies agent updates here and keeps what the customer sees', async () => {
    const { copy } = await pulled();
    await store.queueOutbox(copy.id, { type: 'start_work' });
    await store.queueOutbox(copy.id, { type: 'reply', message: 'Note for the developer' });
    const c = await store.queueOutbox(copy.id, { type: 'submit_solution', note: 'Bigger logo', files: ['src/Logo.tsx'] });
    assert.equal(c.status, 'review_ready');
    assert.equal(c.remote?.status, 'open');
    assert.equal(c.outbox?.length, 3);
    assert.ok(c.messages.filter((m) => m.author !== 'user').every((m) => m.id < 0), 'local messages have their own ids');
  });

  it('keeps the outbox over a pull, with the same local messages', async () => {
    const { hub, remote, copy } = await pulled();
    const queued = await store.queueOutbox(copy.id, { type: 'reply', message: 'Which logo?' });
    const replied = await hub.addMessage(remote.id, 'user', 'And the footer', 'Anna (client)');
    const { comment } = await store.importRemote('p1', replied);
    assert.deepEqual(comment.outbox, [{ type: 'reply', message: 'Which logo?' }]);
    assert.equal(comment.remote?.messages.length, 2);
    assert.deepEqual(
      comment.messages.map((m) => m.body),
      ['Logo too small', 'And the footer', 'Which logo?'],
    );
    const mine = queued.messages.find((m) => m.body === 'Which logo?')!;
    assert.equal(comment.messages.at(-1)?.id, mine.id);
  });

  it('drops updates that no longer fit after the customer changed it, and says so', async () => {
    const { hub, remote, copy } = await pulled();
    await store.queueOutbox(copy.id, { type: 'start_work' });
    await hub.submitSolution(remote.id, 'done elsewhere', []);
    const accepted = await hub.accept(remote.id);
    const { comment } = await store.importRemote('p1', accepted);
    assert.equal(comment.outbox, undefined);
    assert.equal(comment.status, 'accepted');
    assert.match(comment.messages.at(-1)!.body, /dropped/);
  });

  it('clears the outbox once sent, and discard goes back to what the customer sees', async () => {
    const { hub, remote, copy } = await pulled();
    await store.queueOutbox(copy.id, { type: 'start_work' });
    const back = await store.discardOutbox(copy.id);
    assert.equal(back.status, 'open');
    assert.equal(back.outbox, undefined);
    await store.queueOutbox(copy.id, { type: 'start_work' });
    const sent = await hub.startWork(remote.id, 'Andor');
    const { comment } = await store.importRemote('p1', sent, new Map(), { clearOutbox: true });
    assert.equal(comment.outbox, undefined);
    assert.equal(comment.remote, undefined);
    assert.equal(comment.status, 'in_progress');
  });

  it('only queues on customer feedback', async () => {
    const local = await store.create(base);
    assert.equal(await code(store.queueOutbox(local.id, { type: 'start_work' })), 'bad_input');
  });
});
