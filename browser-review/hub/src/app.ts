// The hub's HTTP API.
//
//   /api/review/*   customers, with a review token from their link. Only from the staging site.
//   /api/dev/*      developers (the Margin extension), with a developer token. Never from a web page.
//   /margin.js      the overlay for the staging site (and /margin-<version>.js to pin with SRI)
//   /help, /healthz
//
// Tokens are only managed with the CLI inside the container: there is no admin API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { canDelete, isWebUrl, pageKey, ReviewError, STATUSES, type Comment, type Status, type Store } from '@brm/shared';
import type { Config } from './config.ts';
import type { FsDb } from './fs-db.ts';
import { HELP_HTML } from './help.ts';
import type { Overlay } from './overlay.ts';
import type { Caller, TokenKind, Tokens } from './tokens.ts';
import { InputError, parseCreateInput, parseObject, str } from './validate.ts';
import { VERSION } from './version.ts';

export interface HubDeps {
  config: Config;
  store: Store;
  db: FsDb;
  tokens: Tokens;
  overlay: Overlay | null;
  log?: (msg: string) => void;
  now?: () => Date;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const SMALL_BODY = 64 * 1024;
const COMMENT_BODY = 15 * 1024 * 1024;

const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(json);
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, `The request is too large (at most ${Math.round(limit / 1024 / 1024) || 1} MB).`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, `The request is too large (at most ${Math.round(limit / 1024 / 1024) || 1} MB).`);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON (Content-Type: application/json).');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request is not valid JSON.');
  }
}

function idParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'Not found.');
  return id;
}

/** At most `limit` events per caller per hour, counted in memory. */
class RateLimit {
  readonly #hits = new Map<string, number[]>();
  readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  take(key: string, now: number): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return true;
  }
}

export function createHandler(deps: HubDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { config, store, db, tokens, overlay } = deps;
  const log = deps.log ?? ((msg: string) => console.error(`[margin-hub] ${msg}`));
  const now = deps.now ?? (() => new Date());
  const commentLimit = new RateLimit(config.commentsPerHour);

  async function caller(req: IncomingMessage, kind: TokenKind): Promise<Caller> {
    const auth = req.headers.authorization ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    if (!token) throw new HttpError(401, 'Add your token: Authorization: Bearer <token>.');
    const who = await tokens.verify(token, now());
    if (!who) throw new HttpError(401, 'This token is not valid. It may have been revoked or expired.');
    if (who.kind !== kind) {
      throw new HttpError(403, kind === 'developer' ? 'This is a review token. Developers need a developer token.' : 'This is a developer token. Review links need a review token.');
    }
    return who;
  }

  // ---------- customers ----------

  /** Review tokens only work from the staging site. A request without Origin (same-origin GET) is fine. */
  function reviewCors(req: IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    if (origin === undefined) return {};
    if (origin !== config.origin) throw new HttpError(403, `This review link only works on ${config.origin}.`);
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }

  async function review(req: IncomingMessage, parts: string[]): Promise<{ status: number; body: unknown }> {
    const who = await caller(req, 'reviewer');
    const method = req.method ?? 'GET';
    const [resource, rawId, action] = parts;

    if (resource === 'comments' && !rawId) {
      if (method === 'GET') return { status: 200, body: await store.list() };
      if (method === 'POST') {
        const input = parseCreateInput(await readBody(req, COMMENT_BODY));
        if (!isWebUrl(input.url) || pageKey(input.url).origin !== config.origin) {
          throw new HttpError(400, `Comments are only for pages on ${config.origin}.`);
        }
        if (!commentLimit.take(who.name, now().getTime())) {
          throw new HttpError(429, 'Too many comments in the last hour. Try again later.');
        }
        return { status: 201, body: await store.create(input, who.name) };
      }
    }
    if (resource === 'comments' && rawId) {
      const id = idParam(rawId);
      if (method === 'GET' && !action) return { status: 200, body: await store.mustGet(id) };
      if (method === 'DELETE' && !action) {
        const c = await store.mustGet(id);
        const first = c.messages[0];
        if (first?.author !== 'user' || first.name !== who.name) throw new HttpError(403, 'You can only delete your own comments.');
        if (!canDelete(c)) throw new HttpError(409, `Comment #${id} can't be deleted while it is ${c.status.replace('_', ' ')}.`);
        await store.delete(id);
        return { status: 200, body: { ok: true } };
      }
      if (method === 'POST') {
        const body = parseObject(await readBody(req, SMALL_BODY));
        if (action === 'reply') return { status: 200, body: await store.addMessage(id, 'user', str(body.body, 'body', 20000), who.name) };
        if (action === 'accept') return { status: 200, body: await store.accept(id, who.name) };
        if (action === 'reopen') {
          const text = body.body === undefined ? undefined : str(body.body, 'body', 20000, { empty: true });
          return { status: 200, body: await store.reopen(id, text, who.name) };
        }
      }
    }
    if (resource === 'screenshots' && rawId && !action && method === 'GET') {
      const dataUrl = await store.readScreenshot(idParam(rawId));
      if (!dataUrl) throw new HttpError(404, 'Screenshot not found.');
      return { status: 200, body: { dataUrl } };
    }
    throw new HttpError(404, 'Not found.');
  }

  // ---------- developers ----------

  /** Developer tokens never come from a web page. The extension's background sends a chrome-extension:// origin, or none. */
  function devOriginCheck(req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (origin && isWebUrl(origin)) throw new HttpError(403, 'Developer tokens only work from the Margin extension, not from a web page.');
  }

  async function dev(req: IncomingMessage, parts: string[], url: URL): Promise<{ status: number; body: unknown }> {
    devOriginCheck(req);
    const who = await caller(req, 'developer');
    const method = req.method ?? 'GET';
    const [resource, rawId, action] = parts;

    if (resource === 'project' && !rawId && method === 'GET') {
      return { status: 200, body: { name: config.project, origin: config.origin, version: VERSION, you: who.name } };
    }
    if (resource === 'comments' && !rawId && method === 'GET') {
      // Take the time first: anything changed while we read shows up again next time, never not at all.
      const at = now().toISOString();
      const since = url.searchParams.get('since');
      if (since !== null && Number.isNaN(Date.parse(since))) throw new HttpError(400, 'since must be an ISO time, for example the "now" of the previous answer.');
      const statusParam = url.searchParams.get('status');
      const statuses = statusParam ? statusParam.split(',') : [];
      for (const s of statuses) if (!STATUSES.includes(s as Status)) throw new HttpError(400, `Unknown status "${s}".`);
      const all = await store.list({ statuses: statuses as Status[] });
      const comments = since === null ? all : all.filter((c: Comment) => c.updatedAt > since);
      return { status: 200, body: { comments, deleted: db.deletedSince(since), now: at } };
    }
    if (resource === 'comments' && rawId) {
      const id = idParam(rawId);
      if (method === 'GET' && !action) return { status: 200, body: await store.mustGet(id) };
      if (method === 'POST') {
        const body = parseObject(await readBody(req, SMALL_BODY));
        if (action === 'start_work') return { status: 200, body: await store.startWork(id, who.name) };
        if (action === 'reply') return { status: 200, body: await store.addMessage(id, 'claude', str(body.message, 'message', 20000), who.name) };
        if (action === 'submit_solution') {
          const note = str(body.note, 'note', 5000);
          const files = body.files === undefined ? [] : body.files;
          if (!Array.isArray(files) || files.length > 200) throw new HttpError(400, 'files must be a list of at most 200.');
          return {
            status: 200,
            body: await store.submitSolution(id, note, files.map((f, i) => str(f, `files[${i}]`, 500)), who.name),
          };
        }
      }
    }
    if (resource === 'screenshots' && rawId && !action && method === 'GET') {
      const dataUrl = await store.readScreenshot(idParam(rawId));
      if (!dataUrl) throw new HttpError(404, 'Screenshot not found.');
      return { status: 200, body: { dataUrl } };
    }
    throw new HttpError(404, 'Not found.');
  }

  // ---------- static ----------

  function serveOverlay(res: ServerResponse, pinned: boolean): void {
    if (!overlay) {
      send(res, 404, { error: 'This hub was built without the staging overlay (margin.js).' });
      return;
    }
    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': 'text/javascript; charset=utf-8',
      // Public code: any page may load it, also from the hub's own subdomain with crossorigin + integrity.
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    });
    res.end(overlay.code);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://hub.invalid');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';

    if (path === '/healthz' && method === 'GET') return send(res, 200, { ok: true, version: VERSION });
    if (path === '/help' && method === 'GET') {
      res.writeHead(200, {
        ...COMMON_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Cache-Control': 'public, max-age=300',
      });
      res.end(HELP_HTML);
      return;
    }
    if (path === '/margin.js' && method === 'GET') return serveOverlay(res, false);
    if (path === `/margin-${VERSION}.js` && method === 'GET') return serveOverlay(res, true);

    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'review') {
      let cors: Record<string, string> = {};
      try {
        cors = reviewCors(req);
        if (method === 'OPTIONS') {
          res.writeHead(204, {
            ...COMMON_HEADERS,
            ...cors,
            'Access-Control-Allow-Methods': 'GET, POST, DELETE',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '600',
          });
          res.end();
          return;
        }
        const { status, body } = await review(req, parts.slice(2));
        return send(res, status, body, cors);
      } catch (err) {
        return fail(res, err, cors);
      }
    }
    if (parts[0] === 'api' && parts[1] === 'dev') {
      try {
        const { status, body } = await dev(req, parts.slice(2), url);
        return send(res, status, body);
      } catch (err) {
        return fail(res, err);
      }
    }
    send(res, 404, { error: 'Not found.' });
  }

  function fail(res: ServerResponse, err: unknown, headers: Record<string, string> = {}): void {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message }, headers);
    if (err instanceof InputError) return send(res, 400, { error: err.message }, headers);
    if (err instanceof ReviewError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'invalid_transition' ? 409 : 400;
      return send(res, status, { error: err.message, code: err.code }, headers);
    }
    log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    send(res, 500, { error: 'Something went wrong in the hub. The developer can see the details in its log.' }, headers);
  }

  return (req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) fail(res, err);
      else res.destroy();
    });
  };
}
