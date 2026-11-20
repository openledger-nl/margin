import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { BridgeCalls, BridgeMethod, Comment, ProjectSummary } from '@brm/shared';
import type { BridgeLike } from './bridge.ts';
import { buildMcpServer } from './mcp.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAA';

const comment: Comment = {
  id: 12,
  kind: 'edit',
  status: 'open',
  origin: 'http://localhost:5173',
  path: '/cases/12',
  url: 'http://localhost:5173/cases/12',
  title: 'Zaak 12',
  viewport: { width: 1280, height: 800, dpr: 2 },
  target: {
    selectors: ['#save'],
    tag: 'button',
    text: 'Opslaan',
    html: '<button id="save">Opslaan</button>',
    rect: { x: 1, y: 2, width: 3, height: 4 },
    components: ['Form', 'SaveButton'],
    source: 'src/Form.tsx:12',
  },
  change: { kind: 'edit', texts: [{ index: 0, before: 'Opslaan', after: 'Bewaren' }], css: 'color: red;' },
  messages: [{ id: 1, author: 'user', body: 'Rename it', createdAt: '2026-11-04T10:00:00Z' }],
  solution: null,
  screenshots: [{ id: 1, kind: 'element', source: 'initial', createdAt: '2026-11-04T10:00:00Z' }],
  createdAt: '2026-11-04T10:00:00Z',
  updatedAt: '2026-11-04T10:00:00Z',
};

const calls: { method: string; params: unknown }[] = [];

const acme: ProjectSummary = {
  id: 'p1',
  name: 'acme-shop',
  origin: 'https://staging.acme.com',
  hubUrl: 'https://staging.acme.com/__margin/',
  you: 'Andor',
  lastPull: '2026-11-20T10:00:00.000Z',
  lastError: null,
};
const feedback: Comment = { ...comment, id: 30, project: 'p1', remoteId: 4, messages: [{ ...comment.messages[0]!, name: 'Anna (client)' }] };

/** Answers like the extension would. */
const fake: BridgeLike = {
  async call<M extends BridgeMethod>(method: M, params: BridgeCalls[M]['params']) {
    calls.push({ method, params });
    const p = params as { id?: number };
    if (p.id === 404) throw new Error('Comment #404 does not exist.');
    const results: { [K in BridgeMethod]: BridgeCalls[K]['result'] } = {
      list: [comment],
      get: comment,
      screenshot: { meta: comment.screenshots[0]!, dataUrl: PNG },
      capture: { comment, page: PNG, element: PNG, note: null },
      start_work: { ...comment, status: 'in_progress' },
      reply: comment,
      submit_solution: { ...comment, status: 'review_ready' },
      projects: [acme],
      pull: [{ project: 'acme-shop', added: 1, updated: 0, removed: 0, error: null }],
    };
    if (method === 'list' && (params as { project?: string }).project) return [feedback] as BridgeCalls[M]['result'];
    return results[method];
  },
};

/** An extension from before projects: unknown calls answer undefined. */
const oldExtension: BridgeLike = {
  async call<M extends BridgeMethod>(method: M) {
    return (method === 'list' ? [comment] : undefined) as BridgeCalls[M]['result'];
  },
};

async function connect(bridge: BridgeLike, project: string | null = null): Promise<Client> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(bridge, '1.2.3', { project }).connect(b);
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(a);
  return c;
}

let client: Client;
before(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer(fake, '1.2.3').connect(b);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(a);
});

type Content = { type: string; text?: string; data?: string; mimeType?: string };
async function tool(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  return { content: res.content as Content[], isError: res.isError === true };
}

describe('MCP tools', () => {
  it('lists the nine tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'capture_screenshot',
      'get_comment',
      'get_screenshot',
      'list_comments',
      'list_projects',
      'pull_feedback',
      'reply',
      'start_work',
      'submit_solution',
    ]);
  });

  it('list_comments defaults to open and in progress', async () => {
    calls.length = 0;
    const { content } = await tool('list_comments', {});
    assert.deepEqual(calls[0], { method: 'list', params: { origin: undefined, statuses: ['open', 'in_progress'] } });
    assert.match(content[0]!.text!, /#12 \[Open\] Edit on <button> "Opslaan" in SaveButton/);
  });

  it('get_comment gives the details and the element screenshot', async () => {
    const { content } = await tool('get_comment', { id: 12 });
    assert.match(content[0]!.text!, /"Opslaan" becomes "Bewaren"/);
    assert.match(content[0]!.text!, /Rendered in: src\/Form.tsx:12/);
    assert.deepEqual(content[1], { type: 'image', data: 'iVBORw0KGgoAAAA', mimeType: 'image/png' });
  });

  it('capture_screenshot returns page and element', async () => {
    const { content } = await tool('capture_screenshot', { id: 12 });
    assert.equal(content.filter((c) => c.type === 'image').length, 2);
    assert.match(content[0]!.text!, /Fresh page screenshot of http:\/\/localhost:5173\/cases\/12/);
  });

  it('status tools report the new status', async () => {
    assert.match((await tool('start_work', { id: 12 })).content[0]!.text!, /in progress/);
    calls.length = 0;
    assert.match((await tool('submit_solution', { id: 12, note: 'Renamed.' })).content[0]!.text!, /review ready/);
    assert.deepEqual(calls[0], { method: 'submit_solution', params: { id: 12, note: 'Renamed.', files: [] } });
  });

  it('errors from the extension become readable tool errors', async () => {
    const res = await tool('get_comment', { id: 404 });
    assert.equal(res.isError, true);
    assert.match(res.content[0]!.text!, /does not exist/);
  });

  it('list_comments with a project pulls it first and shows only its feedback', async () => {
    calls.length = 0;
    const { content } = await tool('list_comments', { project: 'acme-shop' });
    assert.deepEqual(calls.map((c) => c.method), ['pull', 'list']);
    assert.deepEqual(calls[1]!.params, { origin: undefined, statuses: ['open', 'in_progress'], project: 'acme-shop' });
    assert.match(content[0]!.text!, /acme-shop: 1 new/);
    assert.match(content[0]!.text!, /#30 .*\(customer feedback from Anna \(client\)\)/);
  });

  it('list_projects and pull_feedback', async () => {
    assert.match((await tool('list_projects', {})).content[0]!.text!, /acme-shop: staging https:\/\/staging.acme.com/);
    calls.length = 0;
    assert.match((await tool('pull_feedback', {})).content[0]!.text!, /acme-shop: 1 new/);
    assert.deepEqual(calls[0], { method: 'pull', params: {} });
  });
});

describe('.margin/project.json', () => {
  it('makes list_comments show that project by default, and "" shows everything', async () => {
    const c = await connect(fake, 'acme-shop');
    calls.length = 0;
    await c.callTool({ name: 'list_comments', arguments: {} });
    assert.deepEqual(calls.map((x) => x.method), ['pull', 'list']);
    calls.length = 0;
    await c.callTool({ name: 'list_comments', arguments: { project: '' } });
    assert.deepEqual(calls.map((x) => x.method), ['list']);
    calls.length = 0;
    await c.callTool({ name: 'pull_feedback', arguments: {} });
    assert.deepEqual(calls[0], { method: 'pull', params: { project: 'acme-shop' } });
  });
});

describe('with an extension from before projects', () => {
  it('says to update the extension instead of failing oddly', async () => {
    const c = await connect(oldExtension);
    for (const [name, args] of [
      ['list_projects', {}],
      ['pull_feedback', {}],
      ['list_comments', { project: 'acme-shop' }],
    ] as const) {
      const res = await c.callTool({ name, arguments: args });
      assert.equal(res.isError, true, name);
      assert.match((res.content as Content[])[0]!.text!, /newer Margin extension/, name);
    }
    // Everything else works as before.
    const res = await c.callTool({ name: 'list_comments', arguments: {} });
    assert.notEqual(res.isError, true);
  });

describe('customer feedback updates', () => {
  it('tell the agent the customer does not see them yet', async () => {
    const queued: BridgeLike = {
      async call<M extends BridgeMethod>(method: M) {
        return { ...feedback, status: 'in_progress', outbox: [{ type: 'start_work' }] } as BridgeCalls[M]['result'];
      },
    };
    const c = await connect(queued);
    const res = await c.callTool({ name: 'start_work', arguments: { id: 30 } });
    assert.match((res.content as Content[])[0]!.text!, /does not see this yet/);
  });
});
});
