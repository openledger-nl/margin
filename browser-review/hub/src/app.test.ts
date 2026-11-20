import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type Comment, type CreateCommentInput } from '@brm/shared';
import { createHandler } from './app.ts';
import { ConfigError, readConfig, type Config } from './config.ts';
import { FsDb } from './fs-db.ts';
import { Tokens } from './tokens.ts';
import { Visits } from './visits.ts';
import { Brand } from './brand.ts';
import { Settings } from './settings.ts';

const STAGING = 'https://staging.acme.com';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

const input: CreateCommentInput = {
  kind: 'comment',
  url: `${STAGING}/pricing`,
  title: 'Pricing',
  viewport: { width: 1440, height: 900, dpr: 1 },
  target: {
    selectors: ['#trial'],
    tag: 'button',
    text: 'Start free trial',
    html: '<button id="trial">Start free trial</button>',
    rect: { x: 10, y: 20, width: 120, height: 40 },
    components: [],
    source: null,
  },
  change: null,
  body: 'The button is too light',
  screenshots: { page: PNG, element: PNG },
};

let dir: string;
let server: Server;
let base: string;
let anna: string;
let bob: string;
let andor: string;
let config: Config;
let visits: Visits;
let settings: Settings;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'margin-app-'));
  config = { project: 'acme-shop', origin: STAGING, dataDir: dir, host: '127.0.0.1', port: 0, commentsPerHour: 5, welcome: null };
  const db = await FsDb.open(dir, config.project);
  const tokens = new Tokens(dir);
  anna = await tokens.add('reviewer', 'Anna (client)');
  bob = await tokens.add('reviewer', 'Bob');
  andor = await tokens.add('developer', 'Andor');
  const overlay = { code: Buffer.from('console.log("margin")'), integrity: 'sha384-test' };
  visits = await Visits.open(dir);
  settings = await Settings.open(dir);
  // These tests are about one shared review; the private default has its own tests.
  await settings.set({ share: true });
  server = createServer(createHandler({ config, store: new Store(db), db, tokens, overlay, visits, brand: new Brand(dir), settings, log: () => {} }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

interface Answer {
  status: number;
  body: any;
  headers: Headers;
}

async function call(method: string, path: string, opts: { token?: string; origin?: string; body?: unknown } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body, headers: res.headers };
}

const asCustomer = (token: string) => ({ token, origin: STAGING });

describe('customer to developer and back', () => {
  it('runs the whole review round trip', async () => {
    const created = await call('POST', '/api/review/comments', { ...asCustomer(anna), body: input });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const c = created.body as Comment;
    assert.equal(c.messages[0]?.name, 'Anna (client)');
    assert.equal(created.headers.get('access-control-allow-origin'), STAGING);

    const project = await call('GET', '/api/dev/project', { token: andor });
    assert.deepEqual({ ...project.body, version: 'x' }, { name: 'acme-shop', origin: STAGING, version: 'x', you: 'Andor' });

    const first = await call('GET', '/api/dev/comments', { token: andor });
    assert.equal(first.status, 200);
    assert.ok(first.body.comments.some((x: Comment) => x.id === c.id));
    const since = first.body.now as string;

    const started = await call('POST', `/api/dev/comments/${c.id}/start_work`, { token: andor });
    assert.equal(started.body.status, 'in_progress');
    const solved = await call('POST', `/api/dev/comments/${c.id}/submit_solution`, {
      token: andor,
      body: { note: 'Darker blue.', files: ['src/Trial.tsx'] },
    });
    assert.equal(solved.body.status, 'review_ready');

    const changed = await call('GET', `/api/dev/comments?since=${encodeURIComponent(since)}`, { token: andor });
    assert.deepEqual(changed.body.comments.map((x: Comment) => x.id), [c.id]);

    const seen = await call('GET', `/api/review/comments/${c.id}`, asCustomer(anna));
    assert.equal(seen.body.status, 'review_ready');
    assert.equal(seen.body.solution.note, 'Darker blue.');
    const accepted = await call('POST', `/api/review/comments/${c.id}/accept`, asCustomer(anna));
    assert.equal(accepted.body.status, 'accepted');
    assert.equal(accepted.body.messages.at(-1).name, 'Anna (client)');

    const shot = await call('GET', `/api/dev/screenshots/${c.screenshots[1]!.id}`, { token: andor });
    assert.equal(shot.body.dataUrl, PNG);
  });

  it('lets customers reply and reopen with their name on it', async () => {
    const c = (await call('POST', '/api/review/comments', { ...asCustomer(anna), body: input })).body as Comment;
    const replied = await call('POST', `/api/review/comments/${c.id}/reply`, { ...asCustomer(bob), body: { body: 'Agreed' } });
    assert.equal(replied.body.messages.at(-1).name, 'Bob');
    await call('POST', `/api/dev/comments/${c.id}/submit_solution`, { token: andor, body: { note: 'Fixed.' } });
    const reopened = await call('POST', `/api/review/comments/${c.id}/reopen`, { ...asCustomer(anna), body: { body: 'Still light' } });
    assert.equal(reopened.body.status, 'open');
    const dev = await call('POST', `/api/dev/comments/${c.id}/reply`, { token: andor, body: { message: 'Which shade?' } });
    assert.deepEqual([dev.body.messages.at(-1).author, dev.body.messages.at(-1).name], ['claude', 'Andor']);
  });
});

describe('private by default, and focus pages', () => {
  it('each customer only sees their own feedback unless the developer shares it', async () => {
    // One of Anna's comments from the tests above (a new one would hit the test's rate limit).
    const all = (await call('GET', '/api/dev/comments', { token: andor })).body.comments as Comment[];
    const mine = all.find((c) => c.messages[0]?.name === 'Anna (client)')!;
    const shared = await settings.get();
    try {
      // The developer switches sharing off for the project, and on for Bob.
      const set = await call('PUT', '/api/dev/settings', { token: andor, body: { share: false, shareFor: { Bob: true }, focusPages: [{ path: '/pricing/', note: 'Check the prices' }] } });
      assert.deepEqual(set.body.focusPages, [{ path: '/pricing', note: 'Check the prices' }]);
      const forAnna = (await call('GET', '/api/review/comments', asCustomer(anna))).body as Comment[];
      assert.ok(forAnna.every((c) => c.messages[0]?.name === 'Anna (client)'));
      const forBob = (await call('GET', '/api/review/comments', asCustomer(bob))).body as Comment[];
      assert.ok(forBob.some((c) => c.id === mine.id), 'Bob shares');
      await settings.set({ share: false, focusPages: [{ path: '/pricing', note: '' }] });
      assert.equal((await call('GET', `/api/review/comments/${mine.id}`, asCustomer(bob))).status, 404);
      assert.equal((await call('POST', `/api/review/comments/${mine.id}/reply`, { ...asCustomer(bob), body: { body: 'hi' } })).status, 404);
      const me = (await call('GET', '/api/review/me', asCustomer(bob))).body;
      assert.deepEqual([me.share, me.focusPages], [false, [{ path: '/pricing', note: '' }]]);
      // Developers always see everything.
      assert.ok(((await call('GET', '/api/dev/comments', { token: andor })).body.comments as Comment[]).some((c) => c.id === mine.id));
      const reviewers = (await call('GET', '/api/dev/reviewers', { token: andor })).body.reviewers.map((r: { name: string }) => r.name);
      assert.ok(reviewers.includes('Bob') && !reviewers.includes('Andor'));
    } finally {
      await settings.set(shared);
    }
  });

  it('checks the settings', async () => {
    assert.equal((await call('PUT', '/api/dev/settings', { token: andor, body: { share: 'yes' } })).status, 400);
    assert.equal((await call('PUT', '/api/review/comments', asCustomer(anna))).status, 404);
    assert.equal((await call('PUT', '/api/dev/settings', { ...asCustomer(anna), body: {} })).status, 403);
  });
});

describe('brand', () => {
  it('serves the company look and logo, and falls back to Margin when broken', async () => {
    const { writeFile, rm: remove } = await import('node:fs/promises');
    assert.deepEqual(await (await fetch(`${base}/brand.json`)).json(), { name: null, color: null, toolbar: null, logo: null });
    await writeFile(join(dir, 'brand.json'), JSON.stringify({ name: 'Acme', color: '#E45', toolbar: 'nope' }));
    await writeFile(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
    const b = await (await fetch(`${base}/brand.json`)).json();
    assert.equal(b.name, 'Acme');
    assert.equal(b.color, '#ee4455');
    assert.equal(b.toolbar, null, 'a bad color is left out');
    const logo = await fetch(`${base}/${b.logo}`);
    assert.equal(logo.headers.get('content-type'), 'image/svg+xml');
    assert.match(logo.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.match(await (await fetch(`${base}/help`)).text(), /Powered by <a href="https:\/\/github.com\/openledger-nl\/margin"/);
    await remove(join(dir, 'brand.json'));
    await remove(join(dir, 'logo.svg'));
  });
});

describe('visits', () => {
  it('records the pages customers look at, only on the staging site, and shows them to developers', async () => {
    const ok = await call('POST', '/api/review/visits', { ...asCustomer(anna), body: { url: `${STAGING}/pricing?ref=mail`, title: 'Pricing' } });
    assert.equal(ok.status, 200);
    const off = await call('POST', '/api/review/visits', { ...asCustomer(anna), body: { url: 'https://evil.example/x', title: 'x' } });
    assert.equal(off.status, 400);
    const seen = (await call('GET', '/api/dev/visits', { token: andor })).body.visits;
    const v = seen.find((x: { path: string }) => x.path === '/pricing');
    assert.deepEqual([v.by, v.title, v.origin], ['Anna (client)', 'Pricing', STAGING]);
    assert.equal(JSON.stringify(seen).includes('ref=mail'), false, 'no query strings');
    assert.equal((await call('GET', '/api/review/visits', asCustomer(bob))).body.visits.length, seen.length);
  });

  it('serves the overview page with a strict CSP', async () => {
    const res = await fetch(`${base}/overview`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.match(await res.text(), /<script src="overview.js"><\/script>/);
  });
});

describe('tokens', () => {
  it('tells the overlay whose review token it has', async () => {
    const me = await call('GET', '/api/review/me', asCustomer(anna));
    assert.deepEqual(me.body, { name: 'Anna (client)', project: config.project, welcome: null, share: true, focusPages: [] });
    assert.equal((await call('GET', '/api/review/me', { token: andor })).status, 403);
  });

  it('needs a valid token of the right kind', async () => {
    assert.equal((await call('GET', '/api/review/comments', { origin: STAGING })).status, 401);
    assert.equal((await call('GET', '/api/review/comments', asCustomer('mrev_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))).status, 401);
    assert.equal((await call('GET', '/api/review/comments', asCustomer(andor))).status, 403);
    assert.equal((await call('GET', '/api/dev/comments', { token: anna })).status, 403);
  });

  it('refuses review tokens from another site, and developer tokens from any web page', async () => {
    const other = await call('GET', '/api/review/comments', { token: anna, origin: 'https://evil.example' });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    assert.equal((await call('GET', '/api/review/comments', { token: anna })).status, 200, 'same-origin GET sends no Origin');

    assert.equal((await call('GET', '/api/dev/project', { token: andor, origin: STAGING })).status, 403);
    assert.equal((await call('GET', '/api/dev/project', { token: andor, origin: 'chrome-extension://abcdef' })).status, 200);
    assert.equal((await call('GET', '/api/dev/project', { token: andor, origin: 'moz-extension://abcdef' })).status, 200);
  });

  it('answers the CORS preflight only for the staging site', async () => {
    const ok = await call('OPTIONS', '/api/review/comments', { origin: STAGING });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), STAGING);
    assert.match(ok.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    assert.equal((await call('OPTIONS', '/api/review/comments', { origin: 'https://evil.example' })).status, 403);
  });
});

describe('customer input', () => {
  it('only takes comments about pages on the staging site', async () => {
    const res = await call('POST', '/api/review/comments', { ...asCustomer(anna), body: { ...input, url: 'https://other.example/x' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /only for pages on https:\/\/staging\.acme\.com/);
  });

  it('checks every field', async () => {
    const bad = [
      { ...input, kind: 'hack' },
      { ...input, viewport: 'big' },
      { ...input, target: { ...input.target, selectors: 'body' } },
      { ...input, body: 'x'.repeat(20001) },
      { ...input, change: { kind: 'edit', texts: [{ index: -1, before: '', after: '' }], css: '' } },
      { ...input, screenshots: { page: 'data:image/gif;base64,R0lGOD' } },
      { ...input, body: '   ' },
    ];
    for (const body of bad) {
      const res = await call('POST', '/api/review/comments', { ...asCustomer(bob), body });
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(typeof res.body.error, 'string');
    }
  });

  it('refuses bodies over 15 MB and requests that are not JSON', async () => {
    const huge = await call('POST', '/api/review/comments', { ...asCustomer(bob), body: { ...input, body: 'x'.repeat(16 * 1024 * 1024) } });
    assert.equal(huge.status, 413);
    const res = await fetch(`${base}/api/review/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bob}`, Origin: STAGING, 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(res.status, 415);
  });

  it('limits comments per review token per hour', async () => {
    const tokens = new Tokens(dir);
    const carl = await tokens.add('reviewer', 'Carl');
    for (let i = 0; i < config.commentsPerHour; i++) {
      assert.equal((await call('POST', '/api/review/comments', { ...asCustomer(carl), body: input })).status, 201);
    }
    assert.equal((await call('POST', '/api/review/comments', { ...asCustomer(carl), body: input })).status, 429);
    assert.equal((await call('POST', '/api/review/comments', { ...asCustomer(anna), body: input })).status, 201, 'others are not affected');
  });

  it('lets customers delete only their own open comments, and tells developers', async () => {
    const c = (await call('POST', '/api/review/comments', { ...asCustomer(anna), body: input })).body as Comment;
    const since = new Date(Date.now() - 1000).toISOString();
    assert.equal((await call('DELETE', `/api/review/comments/${c.id}`, asCustomer(bob))).status, 403);
    await call('POST', `/api/dev/comments/${c.id}/start_work`, { token: andor });
    assert.equal((await call('DELETE', `/api/review/comments/${c.id}`, asCustomer(anna))).status, 409);
    await call('POST', `/api/dev/comments/${c.id}/submit_solution`, { token: andor, body: { note: 'Done' } });
    assert.equal((await call('DELETE', `/api/review/comments/${c.id}`, asCustomer(anna))).status, 200);
    assert.equal((await call('GET', `/api/review/comments/${c.id}`, asCustomer(anna))).status, 404);
    const changes = await call('GET', `/api/dev/comments?since=${encodeURIComponent(since)}`, { token: andor });
    assert.ok(changes.body.deleted.includes(c.id));
  });

  it('maps review rule errors to HTTP codes', async () => {
    const c = (await call('POST', '/api/review/comments', { ...asCustomer(anna), body: input })).body as Comment;
    const early = await call('POST', `/api/review/comments/${c.id}/accept`, asCustomer(anna));
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'invalid_transition');
    assert.equal((await call('GET', '/api/dev/comments/99999', { token: andor })).status, 404);
    assert.equal((await call('GET', '/api/dev/comments?since=yesterday', { token: andor })).status, 400);
    assert.equal((await call('GET', '/api/dev/comments?status=done', { token: andor })).status, 400);
  });
});

describe('static', () => {
  it('serves margin.js, its pinned version, help and health', async () => {
    const js = await fetch(`${base}/margin.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
    assert.equal(js.headers.get('cache-control'), 'public, max-age=300');
    const health = await call('GET', '/healthz');
    const pinned = await fetch(`${base}/margin-${health.body.version}.js`);
    assert.match(pinned.headers.get('cache-control') ?? '', /immutable/);
    const help = await fetch(`${base}/help`);
    assert.match(await help.text(), /Giving feedback/);
    assert.equal((await call('GET', '/nothing')).status, 404);
  });
});

describe('config', () => {
  it('needs a project and a staging origin, and keeps only the origin', () => {
    assert.throws(() => readConfig({ MARGIN_ORIGIN: STAGING }), ConfigError);
    assert.throws(() => readConfig({ MARGIN_PROJECT: 'acme' }), ConfigError);
    assert.throws(() => readConfig({ MARGIN_PROJECT: 'acme', MARGIN_ORIGIN: 'ftp://x' }), ConfigError);
    assert.throws(() => readConfig({ MARGIN_PROJECT: 'acme', MARGIN_ORIGIN: STAGING, PORT: 'x' }), ConfigError);
    const c = readConfig({ MARGIN_PROJECT: 'acme-shop', MARGIN_ORIGIN: `${STAGING}/some/page` });
    assert.equal(c.origin, STAGING);
    assert.equal(c.dataDir, '/data/.margin');
    assert.equal(c.port, 4780);
  });
});
