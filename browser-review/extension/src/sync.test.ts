import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDb, Store, type Comment } from '@brm/shared';
import { HubClient, HubError, normalizeHubUrl } from './hub-client.ts';
import { checkProject, pullProject, pushToHub, sendDecision, suggestDecision, type ClientFor, type Project } from './sync.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const ORIGIN = 'https://staging.acme.com';

/** The hub side: a Store like the hub's, behind the HubClient interface. */
class FakeHub {
  readonly store = new Store(new MemoryDb());
  deleted: { id: number; at: string }[] = [];
  offline = false;
  shotFetches = 0;
  calls: string[] = [];

  client(): HubClient {
    const hub = this;
    const guard = () => {
      if (hub.offline) throw new Error("Can't reach the review hub.");
    };
    return {
      async project() {
        guard();
        return { name: 'acme-shop', origin: ORIGIN, version: '1.3.0', you: 'Andor' };
      },
      async changes(since: string | null) {
        guard();
        const now = new Date().toISOString();
        const all = await hub.store.list();
        return {
          comments: since ? all.filter((c) => c.updatedAt > since) : all,
          deleted: hub.deleted.filter((d) => !since || d.at > since).map((d) => d.id),
          now,
        };
      },
      async visits() {
        guard();
        return [{ origin: ORIGIN, path: '/pricing', title: 'Pricing', by: 'Anna (client)', firstAt: '2026-11-20T10:00:00.000Z', lastAt: '2026-11-20T10:00:00.000Z', count: 1 }];
      },
      async screenshot(id: number) {
        guard();
        hub.shotFetches++;
        return (await hub.store.readScreenshot(id))!;
      },
      async startWork(id: number) {
        guard();
        hub.calls.push(`start_work ${id}`);
        return hub.store.startWork(id, 'Andor');
      },
      async reply(id: number, message: string) {
        guard();
        hub.calls.push(`reply ${id}`);
        return hub.store.addMessage(id, 'claude', message, 'Andor');
      },
      async submitSolution(id: number, note: string, files: string[]) {
        guard();
        hub.calls.push(`submit_solution ${id}`);
        return hub.store.submitSolution(id, note, files, 'Andor');
      },
    } as unknown as HubClient;
  }

  comment(body: string): Promise<Comment> {
    return this.store.create(
      { kind: 'comment', url: `${ORIGIN}/pricing`, title: 'Pricing', viewport: { width: 1280, height: 800, dpr: 1 }, target: null, change: null, body, screenshots: { page: PNG } },
      'Anna (client)',
    );
  }
}

let hub: FakeHub;
let local: Store;
let project: Project;
let clientFor: ClientFor;

beforeEach(async () => {
  hub = new FakeHub();
  local = new Store(new MemoryDb());
  clientFor = () => hub.client();
  project = await checkProject('staging.acme.com/__margin', 'mdev_abcdefghijklmnopqrstuvwxyz012345', clientFor, 'p1');
});

const later = () => new Promise((r) => setTimeout(r, 5));

describe('projects', () => {
  it('checks the token shape and fills in the name and staging site from the hub', async () => {
    assert.equal(project.name, 'acme-shop');
    assert.equal(project.origin, ORIGIN);
    assert.equal(project.hubUrl, 'https://staging.acme.com/__margin/');
    assert.equal(project.you, 'Andor');
    await assert.rejects(checkProject('https://x.test', 'mrev_abcdefghijklmnopqrstuvwxyz', clientFor), /starts with mdev_/);
  });

  it('normalizes hub URLs', () => {
    assert.equal(normalizeHubUrl(' https://a.test/__margin?x=1 '), 'https://a.test/__margin/');
    assert.throws(() => normalizeHubUrl('ftp://a.test'), /https/);
  });
});

describe('pullProject', () => {
  it('copies new feedback with its screenshots, then only what changed', async () => {
    const remote = await hub.comment('Prices are hard to compare');
    const first = await pullProject(local, project, clientFor);
    assert.deepEqual(first.summary, { project: 'acme-shop', added: 1, updated: 0, removed: 0, error: null });
    assert.deepEqual([...first.origins], [ORIGIN]);
    const copy = (await local.findRemote('p1', remote.id))!;
    assert.equal(copy.messages[0]?.name, 'Anna (client)');
    assert.equal(await local.readScreenshot(copy.screenshots[0]!.id), PNG);
    assert.equal(hub.shotFetches, 1);

    project = { ...project, lastPull: first.now };
    await later();
    await hub.store.addMessage(remote.id, 'user', 'Also on mobile', 'Anna (client)');
    const second = await pullProject(local, project, clientFor);
    assert.equal(second.summary.updated, 1);
    assert.equal(hub.shotFetches, 1, 'the screenshot is not fetched again');
    assert.equal((await local.findRemote('p1', remote.id))?.messages.length, 2);
  });

  it('drops a copy the customer deleted', async () => {
    const remote = await hub.comment('Typo');
    const first = await pullProject(local, project, clientFor);
    await later();
    await hub.store.delete(remote.id);
    hub.deleted.push({ id: remote.id, at: new Date().toISOString() });
    const second = await pullProject(local, { ...project, lastPull: first.now }, clientFor);
    assert.equal(second.summary.removed, 1);
    assert.equal(await local.findRemote('p1', remote.id), null);
  });
});

describe('pushToHub', () => {
  it('changes the status on the hub first, then takes the hub version', async () => {
    await hub.comment('Make the button green');
    await pullProject(local, project, clientFor);
    const [copy] = await local.list({ project: 'p1' });
    const updated = await pushToHub(local, project, copy!, { type: 'start_work' }, clientFor);
    assert.deepEqual(hub.calls, [`start_work ${copy!.remoteId}`]);
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.id, copy!.id);
    assert.equal((await hub.store.get(copy!.remoteId!))?.status, 'in_progress');
    const done = await pushToHub(local, project, updated, { type: 'submit_solution', note: 'Green now.', files: ['src/Button.tsx'] }, clientFor);
    assert.equal(done.status, 'review_ready');
    assert.equal(done.screenshots.length, 1, 'keeps the screenshots');
  });

  it('changes nothing locally when the hub cannot be reached', async () => {
    await hub.comment('Bigger logo');
    await pullProject(local, project, clientFor);
    const [copy] = await local.list({ project: 'p1' });
    hub.offline = true;
    await assert.rejects(pushToHub(local, project, copy!, { type: 'start_work' }, clientFor), /Nothing was changed/);
    assert.equal((await local.get(copy!.id))?.status, 'open');
  });

  it('says to add the project again when the token was revoked', async () => {
    await hub.comment('x');
    await pullProject(local, project, clientFor);
    const [copy] = await local.list({ project: 'p1' });
    const revoked: ClientFor = () =>
      ({
        startWork: async () => {
          throw new HubError(401, 'This token is not valid.');
        },
      }) as unknown as HubClient;
    await assert.rejects(pushToHub(local, project, copy!, { type: 'start_work' }, revoked), /no longer works/);
  });
});

describe('sending to the customer', () => {
  async function queuedCopy() {
    const remote = await hub.comment('The logo is too small');
    await pullProject(local, project, clientFor);
    const [copy] = await local.list({ project: 'p1' });
    await local.queueOutbox(copy!.id, { type: 'start_work' });
    await local.queueOutbox(copy!.id, { type: 'reply', message: 'internal note' });
    const queued = await local.queueOutbox(copy!.id, { type: 'submit_solution', note: 'Logo is 2x bigger now.', files: ['src/Logo.tsx'] });
    return { remote, queued };
  }

  it('suggests the agent\'s note as fixed, or its question', async () => {
    const { queued } = await queuedCopy();
    assert.deepEqual(suggestDecision(queued), { id: queued.id, decision: 'fixed', message: 'Logo is 2x bigger now.' });
    const asked = { ...queued, outbox: [{ type: 'reply' as const, message: 'Which logo?' }] };
    assert.deepEqual(suggestDecision(asked), { id: queued.id, decision: 'question', message: 'Which logo?' });
  });

  it('nothing reaches the hub until sent; fixed sends review ready with the developer\'s words', async () => {
    const { remote, queued } = await queuedCopy();
    assert.deepEqual(hub.calls, []);
    assert.equal((await hub.store.get(remote.id))?.status, 'open');
    const sent = await sendDecision(local, project, queued, { id: queued.id, decision: 'fixed', message: 'We made the logo bigger.' }, clientFor);
    const onHub = (await hub.store.get(remote.id))!;
    assert.equal(onHub.status, 'review_ready');
    assert.equal(onHub.solution?.note, 'We made the logo bigger.');
    assert.deepEqual(onHub.solution?.files, ['src/Logo.tsx']);
    assert.equal(onHub.messages.some((m) => m.body === 'internal note'), false, 'the agent\'s note stays private');
    assert.equal(sent.outbox, undefined);
    assert.equal(sent.status, 'review_ready');
  });

  it('more feedback needed sends the question and keeps it in progress', async () => {
    const { remote, queued } = await queuedCopy();
    await sendDecision(local, project, queued, { id: queued.id, decision: 'question', message: 'Bigger on mobile too?' }, clientFor);
    const onHub = (await hub.store.get(remote.id))!;
    assert.equal(onHub.status, 'in_progress');
    assert.equal(onHub.messages.at(-1)?.body, 'Bigger on mobile too?');
    assert.equal(onHub.messages.at(-1)?.name, 'Andor');
  });

  it('needs a message, and keeps the outbox when the hub is down', async () => {
    const { queued } = await queuedCopy();
    await assert.rejects(sendDecision(local, project, queued, { id: queued.id, decision: 'fixed', message: ' ' }, clientFor), /Write what was fixed/);
    hub.offline = true;
    await assert.rejects(sendDecision(local, project, queued, { id: queued.id, decision: 'fixed', message: 'x' }, clientFor), /Not sent/);
    assert.equal((await local.get(queued.id))?.outbox?.length, 3);
  });

  it('a pull copies the hub\'s visits for the overview', async () => {
    const r = await pullProject(local, project, clientFor);
    assert.equal(r.visits?.[0]?.path, '/pricing');
  });
});
