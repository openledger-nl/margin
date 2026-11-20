import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import type { FromExtension, ToExtension } from '@brm/shared';
import { Bridge, NOT_CONNECTED } from './bridge.ts';

let nextPort = 41000 + Math.floor(Math.random() * 15000);
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function bridge(port: number): Bridge {
  const b = new Bridge({ port, version: '9.9.9', callTimeoutMs: 3000 });
  cleanup.push(() => b.close());
  return b;
}

/** A fake extension: answers "get" with { id, from: name }. */
function extension(port: number, name = 'ext', origin = 'chrome-extension://abc'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
    cleanup.push(() => ws.terminate());
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ToExtension;
      if (msg.type !== 'call') return;
      const params = msg.params as { id: number };
      const reply: FromExtension =
        params.id === 404
          ? { type: 'result', id: msg.id, ok: false, error: 'Comment #404 does not exist.' }
          : { type: 'result', id: msg.id, ok: true, data: { id: params.id, from: name } };
      ws.send(JSON.stringify(reply));
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function until(fn: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail('timed out');
}

describe('hub', () => {
  it('forwards calls to the extension and back, errors included', async () => {
    const port = nextPort++;
    const b = bridge(port);
    await b.start();
    assert.equal(b.mode, 'hub');
    await assert.rejects(b.call('get', { id: 1 }), { message: NOT_CONNECTED });

    await extension(port);
    assert.deepEqual(await b.call('get', { id: 7 }), { id: 7, from: 'ext' });
    await assert.rejects(b.call('get', { id: 404 }), /does not exist/);
  });

  it('accepts the Firefox extension origin too', async () => {
    const port = nextPort++;
    const b = bridge(port);
    await b.start();
    await extension(port, 'firefox', 'moz-extension://0b9f2c3e-1d2a-4f5b-9c8d-123456789abc');
    assert.deepEqual(await b.call('get', { id: 2 }), { id: 2, from: 'firefox' });
  });

  it('uses the most recent extension connection', async () => {
    const port = nextPort++;
    const b = bridge(port);
    await b.start();
    const first = await extension(port, 'first');
    await extension(port, 'second');
    assert.deepEqual(await b.call('get', { id: 1 }), { id: 1, from: 'second' });
    first.terminate();
  });

  it('only lets the extension and local processes in', async () => {
    const port = nextPort++;
    const b = bridge(port);
    await b.start();
    await assert.rejects(extension(port, 'web', 'http://localhost:5173'), /403/);
    await assert.rejects(extension(port, 'web', 'https://evil.example'), /403/);
    await assert.rejects(extension(port, 'web', 'https://chrome-extension.evil.example'), /403/);
    // A website trying the peer endpoint (browsers always send Origin).
    await assert.rejects(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/peer`, { origin: 'https://evil.example' });
        ws.once('open', resolve);
        ws.once('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      }),
      /403/,
    );
    // DNS rebinding: wrong Host header.
    await assert.rejects(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
          origin: 'chrome-extension://abc',
          headers: { host: `evil.example:${port}` },
        });
        ws.once('open', resolve);
        ws.once('unexpected-response', (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      }),
      /403/,
    );
  });
});

describe('several Claude Code sessions', () => {
  it('the second process goes through the first', async () => {
    const port = nextPort++;
    const hub = bridge(port);
    await hub.start();
    const peer = bridge(port);
    await peer.start();
    assert.equal(peer.mode, 'peer');
    await assert.rejects(peer.call('get', { id: 1 }), { message: NOT_CONNECTED });
    await extension(port);
    assert.deepEqual(await peer.call('get', { id: 3 }), { id: 3, from: 'ext' });
    await assert.rejects(peer.call('get', { id: 404 }), /does not exist/);
  });

  it('a peer takes over when the hub session ends', async () => {
    const port = nextPort++;
    const hub = bridge(port);
    await hub.start();
    const peer = bridge(port);
    await peer.start();
    await hub.close();
    await until(() => peer.mode === 'hub');
    await extension(port, 'reconnected');
    assert.deepEqual(await peer.call('get', { id: 5 }), { id: 5, from: 'reconnected' });
  });

  it('explains when another program has the port', async () => {
    const port = nextPort++;
    const { createServer } = await import('node:http');
    const other = createServer((_req, res) => res.end('hi'));
    await new Promise<void>((r) => other.listen(port, '127.0.0.1', () => r()));
    cleanup.push(() => new Promise((r) => other.close(r)));
    const b = bridge(port);
    await b.start();
    assert.equal(b.mode, 'starting');
    await assert.rejects(b.call('get', { id: 1 }), /in use by another program/);
  });
});
