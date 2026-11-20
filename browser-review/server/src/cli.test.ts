// End to end: start the CLI over stdio like Claude Code does, with a fake extension.
// BRM_CLI=dist/cli.js runs it against the published bundle instead of the source.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import WebSocket from 'ws';
import type { FromExtension, ToExtension } from '@brm/shared';

const cli = fileURLToPath(new URL(`../${process.env.BRM_CLI ?? 'src/cli.ts'}`, import.meta.url));
const port = 41000 + Math.floor(Math.random() * 15000);

let client: Client;
let ext: WebSocket | null = null;

before(async () => {
  client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [cli], env: { ...process.env, BRM_PORT: String(port) } as Record<string, string>, stderr: 'ignore' }),
  );
});

after(async () => {
  ext?.terminate();
  await client.close();
});

function connectExtension(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryOnce = (left: number) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'chrome-extension://abc' });
      ws.once('open', () => {
        ext = ws;
        resolve();
      });
      ws.once('error', (err) => (left > 0 ? setTimeout(() => tryOnce(left - 1), 100) : reject(err)));
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data)) as ToExtension;
        if (msg.type !== 'call') return;
        const reply: FromExtension = { type: 'result', id: msg.id, ok: true, data: [] };
        ws.send(JSON.stringify(reply));
      });
    };
    tryOnce(50);
  });
}

describe('browser-review-mcp over stdio', () => {
  it('reports the version from package.json', () => {
    assert.equal(client.getServerVersion()?.name, 'browser-review');
    assert.match(client.getServerVersion()?.version ?? '', /^\d+\.\d+\.\d+$/);
  });

  it('says clearly when the extension is not connected', async () => {
    const res = await client.callTool({ name: 'list_comments', arguments: {} });
    assert.equal(res.isError, true);
    assert.match((res.content as { text: string }[])[0]!.text, /extension is not connected/);
  });

  it('reaches the extension once it connects', async () => {
    await connectExtension();
    const res = await client.callTool({ name: 'list_comments', arguments: {} });
    assert.equal(res.isError, undefined);
    assert.match((res.content as { text: string }[])[0]!.text, /No comments with status open, in progress/);
  });
});
