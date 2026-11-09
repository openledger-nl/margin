import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { BridgeCalls, BridgeMethod, Comment } from '@brm/shared';
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
    };
    return results[method];
  },
};

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
  it('lists the seven tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'capture_screenshot',
      'get_comment',
      'get_screenshot',
      'list_comments',
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
});
