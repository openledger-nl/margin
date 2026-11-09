// The link between this MCP process and the browser extension.
//
// Claude Code starts one MCP process per session. The first one to get port
// 4777 is the "hub": it accepts the extension's WebSocket (/ws) and the other
// MCP processes (/peer). The others are "peers" and send their calls through the
// hub. When the hub's session ends, a peer takes the port over and the
// extension reconnects to it.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { BridgeCalls, BridgeMethod, FromExtension, ToExtension } from '@brm/shared';

export interface BridgeLike {
  call<M extends BridgeMethod>(method: M, params: BridgeCalls[M]['params']): Promise<BridgeCalls[M]['result']>;
}

export interface BridgeOptions {
  port: number;
  version: string;
  log?: (msg: string) => void;
  callTimeoutMs?: number;
}

export const NOT_CONNECTED =
  'The Browser Review extension is not connected. Ask the user to open their browser (Brave, Chrome or Firefox) with the Browser Review extension installed and enabled. ' +
  'It connects by itself within a few seconds; its help page (right-click the extension icon, Options or Manage Extension) shows the status.';

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  socket: WebSocket;
}

type Mode = 'starting' | 'hub' | 'peer' | 'closed';

/** Host header must be the loopback address we listen on (blocks DNS rebinding). */
function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/**
 * The extension's WebSocket always carries its extension origin: chrome-extension://
 * (Chrome, Brave, Edge) or moz-extension:// (Firefox). Websites can't fake that.
 */
function isExtension(req: IncomingMessage): boolean {
  return /^(chrome|moz)-extension:\/\//.test(req.headers.origin ?? '');
}

/** Another MCP process: not a browser, so no Origin and no Sec-Fetch-* headers. */
function isLocalProcess(req: IncomingMessage): boolean {
  return req.headers.origin === undefined && req.headers['sec-fetch-site'] === undefined;
}

export class Bridge implements BridgeLike {
  readonly #opts: Required<BridgeOptions>;
  #mode: Mode = 'starting';
  #lastError: string | null = null;

  // hub
  #http: Server | null = null;
  #wss: WebSocketServer | null = null;
  readonly #extensions: WebSocket[] = [];
  #pingTimer: NodeJS.Timeout | null = null;

  // peer
  #upstream: WebSocket | null = null;

  #nextId = 1;
  readonly #pending = new Map<number, Pending>();
  #retryTimer: NodeJS.Timeout | null = null;

  constructor(opts: BridgeOptions) {
    this.#opts = { log: () => {}, callTimeoutMs: 30_000, ...opts };
  }

  get mode(): Mode {
    return this.#mode;
  }

  /** Becomes hub or peer. Never throws: on trouble it keeps retrying in the background. */
  async start(): Promise<void> {
    if (this.#mode === 'closed') return;
    try {
      await this.#listen();
      this.#mode = 'hub';
      this.#lastError = null;
      this.#opts.log(`listening on 127.0.0.1:${this.#opts.port} for the extension`);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        this.#retry(`Could not listen on port ${this.#opts.port}: ${String(err)}`);
        return;
      }
    }
    try {
      await this.#connectPeer();
      this.#mode = 'peer';
      this.#lastError = null;
      this.#opts.log(`another Claude Code session has port ${this.#opts.port}, going through it`);
    } catch (err) {
      this.#retry(
        `Port ${this.#opts.port} is in use by another program (not Browser Review), so the extension can't connect. ` +
          `Free the port, then reconnect browser-review in Claude Code with /mcp. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  #retry(reason: string): void {
    this.#mode = 'starting';
    this.#lastError = reason;
    if (this.#retryTimer || this.#closed) return;
    // Random delay so several peers don't all grab the port at the same moment.
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.start();
    }, 300 + Math.floor(Math.random() * 700));
    this.#retryTimer.unref();
  }

  get #closed(): boolean {
    return this.#mode === 'closed';
  }

  // ---------- hub ----------

  #listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const http = createServer((req, res) => {
        if (!hostAllowed(req, this.#opts.port)) {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(req.url === '/' ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(req.url === '/' ? `Browser Review MCP ${this.#opts.version}\n` : 'Not found.\n');
      });
      const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
      http.on('upgrade', (req, socket, head) => this.#onUpgrade(wss, req, socket, head));
      http.once('error', reject);
      http.listen(this.#opts.port, '127.0.0.1', () => {
        http.off('error', reject);
        http.on('error', (err) => this.#opts.log(`server error: ${String(err)}`));
        this.#http = http;
        this.#wss = wss;
        this.#pingTimer = setInterval(() => {
          // MV3 service workers sleep after ~30s without traffic. This keeps the extension awake.
          for (const ws of this.#extensions) this.#send(ws, { type: 'ping' });
        }, 20_000);
        this.#pingTimer.unref();
        resolve();
      });
    });
  }

  #onUpgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const ok =
      hostAllowed(req, this.#opts.port) &&
      ((path === '/ws' && isExtension(req)) || (path === '/peer' && isLocalProcess(req)));
    if (!ok) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => (path === '/ws' ? this.#onExtension(ws) : this.#onPeer(ws)));
  }

  #onExtension(ws: WebSocket): void {
    this.#extensions.push(ws);
    this.#opts.log('extension connected');
    this.#send(ws, { type: 'hello', version: this.#opts.version });
    ws.on('message', (data) => {
      let msg: FromExtension;
      try {
        msg = JSON.parse(String(data)) as FromExtension;
      } catch {
        return;
      }
      if (msg.type === 'result') this.#settle(msg);
    });
    ws.on('close', () => {
      const i = this.#extensions.indexOf(ws);
      if (i >= 0) this.#extensions.splice(i, 1);
      this.#opts.log('extension disconnected');
      this.#failPending(ws, 'The extension disconnected during the call. Try again.');
    });
    ws.on('error', () => ws.close());
  }

  /** A peer sends calls like we would, and gets results like the extension sends them. */
  #onPeer(ws: WebSocket): void {
    this.#send(ws, { type: 'hello', version: this.#opts.version });
    ws.on('message', (data) => {
      let msg: ToExtension;
      try {
        msg = JSON.parse(String(data)) as ToExtension;
      } catch {
        return;
      }
      if (msg.type !== 'call') return;
      this.#callExtension(msg.method, msg.params)
        .then((result) => this.#send(ws, { type: 'result', id: msg.id, ok: true, data: result }))
        .catch((err: unknown) =>
          this.#send(ws, { type: 'result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    });
    ws.on('error', () => ws.close());
  }

  #callExtension(method: BridgeMethod, params: unknown): Promise<unknown> {
    const ws = this.#extensions.at(-1); // the most recent, if a browser restarted
    if (!ws) return Promise.reject(new Error(NOT_CONNECTED));
    return this.#request(ws, method, params);
  }

  // ---------- peer ----------

  #connectPeer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.#opts.port}/peer`);
      let opened = false;
      ws.once('open', () => {
        opened = true;
        this.#upstream = ws;
        resolve();
      });
      ws.once('unexpected-response', (_req, res) => {
        reject(new Error(`it answered HTTP ${res.statusCode}`));
        ws.terminate();
      });
      ws.on('message', (data) => {
        let msg: FromExtension | ToExtension;
        try {
          msg = JSON.parse(String(data)) as FromExtension | ToExtension;
        } catch {
          return;
        }
        if (msg.type === 'result') this.#settle(msg);
      });
      ws.on('error', (err) => {
        if (!opened) reject(err);
      });
      ws.on('close', () => {
        if (!opened) return;
        if (this.#upstream === ws) this.#upstream = null;
        this.#failPending(ws, 'The Claude Code session that connected to the extension closed. Try again in a moment.');
        if (!this.#closed) {
          this.#opts.log('the hub went away, taking over');
          this.#retry('Reconnecting to the extension.');
        }
      });
    });
  }

  // ---------- calls ----------

  call<M extends BridgeMethod>(method: M, params: BridgeCalls[M]['params']): Promise<BridgeCalls[M]['result']> {
    if (this.#mode === 'hub') return this.#callExtension(method, params) as Promise<BridgeCalls[M]['result']>;
    if (this.#mode === 'peer' && this.#upstream) {
      return this.#request(this.#upstream, method, params) as Promise<BridgeCalls[M]['result']>;
    }
    return Promise.reject(new Error(this.#lastError ?? NOT_CONNECTED));
  }

  #request(ws: WebSocket, method: BridgeMethod, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`No answer from the extension within ${this.#opts.callTimeoutMs / 1000}s.`));
      }, this.#opts.callTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer, socket: ws });
      this.#send(ws, { type: 'call', id, method, params });
    });
  }

  #settle(msg: Extract<FromExtension, { type: 'result' }>): void {
    const p = this.#pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.#pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error));
  }

  #failPending(ws: WebSocket, reason: string): void {
    for (const [id, p] of this.#pending) {
      if (p.socket !== ws) continue;
      clearTimeout(p.timer);
      this.#pending.delete(id);
      p.reject(new Error(reason));
    }
  }

  #send(ws: WebSocket, msg: ToExtension | FromExtension): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  async close(): Promise<void> {
    this.#mode = 'closed';
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#upstream?.terminate();
    for (const ws of this.#extensions) ws.terminate();
    for (const client of this.#wss?.clients ?? []) client.terminate();
    this.#wss?.close();
    const http = this.#http;
    if (http) await new Promise<void>((r) => http.close(() => r()));
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Shutting down.'));
    }
    this.#pending.clear();
  }
}
