// All review data and the one place that changes it. The extension's background
// worker uses it over IndexedDB (extension/src/idb.ts), the review hub over files
// (hub/src/fs-db.ts), tests over a Map. Persistence is behind the Db interface.
import {
  pageKey,
  type Author,
  type Comment,
  type CreateCommentInput,
  type OutboxAction,
  type ScreenshotKind,
  type ScreenshotMeta,
  type ScreenshotSource,
  type Status,
} from './index.ts';
import { checkCreate, checkPngDataUrl, decide, ReviewError, type Action } from './rules.ts';

/** An http or https URL. Which sites are allowed is up to the caller. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ListFilter {
  origin?: string;
  path?: string;
  statuses?: Status[];
  /** A project id: only copies pulled from that hub. null: only local comments. */
  project?: string | null;
}

export interface StoredShot {
  id: number;
  commentId: number;
  /** "data:image/png;base64,..." */
  dataUrl: string;
}

export type Counter = 'comment' | 'message' | 'shot';

export interface Db {
  getComment(id: number): Promise<Comment | undefined>;
  allComments(): Promise<Comment[]>;
  putComment(c: Comment): Promise<void>;
  /** Deletes the comment and its screenshots. */
  deleteComment(id: number): Promise<void>;
  putShot(shot: StoredShot): Promise<void>;
  getShot(id: number): Promise<StoredShot | undefined>;
  nextId(counter: Counter): Promise<number>;
}

/** In-memory Db, for tests. */
export class MemoryDb implements Db {
  readonly comments = new Map<number, Comment>();
  readonly shots = new Map<number, StoredShot>();
  readonly #counters = new Map<Counter, number>();

  async getComment(id: number) {
    const c = this.comments.get(id);
    return c ? structuredClone(c) : undefined;
  }
  async allComments() {
    return [...this.comments.values()].map((c) => structuredClone(c));
  }
  async putComment(c: Comment) {
    this.comments.set(c.id, structuredClone(c));
  }
  async deleteComment(id: number) {
    this.comments.delete(id);
    for (const [k, s] of this.shots) if (s.commentId === id) this.shots.delete(k);
  }
  async putShot(shot: StoredShot) {
    this.shots.set(shot.id, shot);
  }
  async getShot(id: number) {
    return this.shots.get(id);
  }
  async nextId(counter: Counter) {
    const n = (this.#counters.get(counter) ?? 0) + 1;
    this.#counters.set(counter, n);
    return n;
  }
}

function now(): string {
  return new Date().toISOString();
}

export class Store {
  readonly #db: Db;
  /** All writes run one after the other, so two updates of one comment never race. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(db: Db) {
    this.#db = db;
  }

  #write<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  // ---------- reading ----------

  async get(id: number): Promise<Comment | null> {
    return (await this.#db.getComment(id)) ?? null;
  }

  async mustGet(id: number): Promise<Comment> {
    const c = await this.get(id);
    if (!c) throw new ReviewError('not_found', `Comment #${id} does not exist.`);
    return c;
  }

  async list(filter: ListFilter = {}): Promise<Comment[]> {
    const all = await this.#db.allComments();
    return all
      .filter((c) => !filter.origin || c.origin === filter.origin)
      .filter((c) => !filter.path || c.path === filter.path)
      .filter((c) => !filter.statuses?.length || filter.statuses.includes(c.status))
      .filter((c) => filter.project === undefined || (c.project ?? null) === filter.project)
      .sort((a, b) => a.id - b.id);
  }

  /** The local copy of a hub comment, or null. */
  async findRemote(project: string, remoteId: number): Promise<Comment | null> {
    const all = await this.#db.allComments();
    return all.find((c) => c.project === project && c.remoteId === remoteId) ?? null;
  }

  // ---------- writing ----------

  /** by: who made it, for example the name of a hub token. Stored on its messages. */
  create(input: CreateCommentInput, by?: string): Promise<Comment> {
    return this.#write(async () => {
      // Which sites are allowed is the background's call (sites.ts); here only web pages.
      if (!isWebUrl(input.url)) throw new ReviewError('bad_input', 'Only http and https pages.');
      const { body, page, element } = checkCreate(input);

      const { origin, path } = pageKey(input.url);
      const t = now();
      const c: Comment = {
        id: await this.#db.nextId('comment'),
        kind: input.kind,
        status: 'open',
        origin,
        path,
        url: input.url,
        title: input.title,
        viewport: input.viewport,
        target: input.target,
        change: input.change,
        messages: [],
        solution: null,
        screenshots: [],
        createdAt: t,
        updatedAt: t,
      };
      await this.#message(c, 'user', body, t, by);
      if (page) await this.#shot(c, 'page', 'initial', page);
      if (element) await this.#shot(c, 'element', 'initial', element);
      await this.#db.putComment(c);
      return c;
    });
  }

  addMessage(id: number, author: Author, body: string, by?: string): Promise<Comment> {
    return this.#act(id, { type: 'message', author, body }, by);
  }

  /** Agent: open or in progress -> in progress. */
  startWork(id: number, by?: string): Promise<Comment> {
    return this.#act(id, { type: 'start_work' }, by);
  }

  /** Agent: open or in progress -> review ready, with a note on how it was solved. */
  submitSolution(id: number, note: string, files: string[] = [], by?: string): Promise<Comment> {
    return this.#act(id, { type: 'submit_solution', note, files }, by);
  }

  /** User: review ready -> accepted. */
  accept(id: number, by?: string): Promise<Comment> {
    return this.#act(id, { type: 'accept' }, by);
  }

  /** User: review ready or accepted -> open. The old solution moves into the thread. */
  reopen(id: number, body?: string, by?: string): Promise<Comment> {
    return this.#act(id, { type: 'reopen', body }, by);
  }

  // ---------- copies of review-hub comments ----------

  /**
   * Stores the hub's version of a comment as the local copy (new, or replacing the
   * old one), keeping its local id. shots: data URLs of the hub's screenshots the
   * copy doesn't have yet, by hub screenshot id; findRemote tells which those are.
   * Screenshots without data are left out (a later pull brings them).
   */
  importRemote(
    project: string,
    remote: Comment,
    shots: ReadonlyMap<number, string> = new Map(),
    opts: { clearOutbox?: boolean } = {},
  ): Promise<{ comment: Comment; added: boolean; changed: boolean }> {
    return this.#write(async () => {
      const existing = (await this.#db.allComments()).find((c) => c.project === project && c.remoteId === remote.id);
      const id = existing?.id ?? (await this.#db.nextId('comment'));
      const screenshots: ScreenshotMeta[] = [];
      for (const s of remote.screenshots) {
        const have = existing?.screenshots.find((e) => e.remoteId === s.id);
        if (have) {
          screenshots.push(have);
          continue;
        }
        const dataUrl = shots.get(s.id);
        if (!dataUrl) continue;
        const shotId = await this.#db.nextId('shot');
        await this.#db.putShot({ id: shotId, commentId: id, dataUrl: checkPngDataUrl(dataUrl) });
        screenshots.push({ id: shotId, kind: s.kind, source: s.source, createdAt: s.createdAt, remoteId: s.id });
      }
      const { project: _p, remoteId: _r, remote: _rm, outbox: _o, ...rest } = remote;
      let c: Comment = { ...rest, id, screenshots, project, remoteId: remote.id };
      // Updates the developer has not sent yet stay, on top of the hub's version.
      const outbox = opts.clearOutbox ? [] : (existing?.outbox ?? []);
      if (outbox.length) c = await this.#withOutbox(c, outbox, existing?.messages ?? []);
      // The whole comment, not just updatedAt: two changes can share a millisecond.
      const changed = !existing || JSON.stringify(existing) !== JSON.stringify(c);
      if (changed) await this.#db.putComment(c);
      return { comment: changed ? c : existing, added: !existing, changed };
    });
  }

  /**
   * An agent update on a copy of customer feedback: applied here (the developer and
   * the agent see it) and kept in the outbox until the developer sends it.
   */
  queueOutbox(id: number, action: OutboxAction, by?: string): Promise<Comment> {
    return this.#update(id, async (c) => {
      if (!c.project) throw new ReviewError('bad_input', `Comment #${id} is not customer feedback.`);
      c.remote ??= Store.#snapshot(c);
      await this.#apply(c, action, now(), by);
      c.outbox = [...(c.outbox ?? []), action];
    });
  }

  /** Drops the unsent updates: the copy goes back to what the customer sees. */
  discardOutbox(id: number): Promise<Comment> {
    return this.#write(async () => {
      const c = await this.mustGet(id);
      if (!c.remote) return c;
      const back: Comment = { ...c.remote, id: c.id, project: c.project, remoteId: c.remoteId, screenshots: c.screenshots };
      await this.#db.putComment(back);
      return back;
    });
  }

  /** Drops the local copy of a hub comment (the customer deleted it). False when there was none. */
  deleteRemote(project: string, remoteId: number): Promise<boolean> {
    return this.#write(async () => {
      const c = (await this.#db.allComments()).find((x) => x.project === project && x.remoteId === remoteId);
      if (!c) return false;
      await this.#db.deleteComment(c.id);
      return true;
    });
  }

  /** Drops every copy from one hub project (the project was removed). Returns how many. */
  deleteProject(project: string): Promise<number> {
    return this.#write(async () => {
      const copies = (await this.#db.allComments()).filter((c) => c.project === project);
      for (const c of copies) await this.#db.deleteComment(c.id);
      return copies.length;
    });
  }

  delete(id: number): Promise<void> {
    return this.#write(async () => {
      await this.mustGet(id);
      await this.#db.deleteComment(id);
    });
  }

  // ---------- screenshots ----------

  addScreenshot(id: number, kind: ScreenshotKind, source: ScreenshotSource, dataUrl: string): Promise<ScreenshotMeta> {
    let meta!: ScreenshotMeta;
    return this.#update(id, async (c) => {
      meta = await this.#shot(c, kind, source, checkPngDataUrl(dataUrl));
    }).then(() => meta);
  }

  async readScreenshot(shotId: number): Promise<string | null> {
    return (await this.#db.getShot(shotId))?.dataUrl ?? null;
  }

  /** Newest screenshot of a kind, optionally only from one source. */
  async latestScreenshot(id: number, kind: ScreenshotKind, source?: ScreenshotSource): Promise<ScreenshotMeta | null> {
    const c = await this.mustGet(id);
    const list = c.screenshots.filter((s) => s.kind === kind && (!source || s.source === source));
    return list.at(-1) ?? null;
  }

  // ---------- internals ----------

  #update(id: number, fn: (c: Comment) => Promise<void>): Promise<Comment> {
    return this.#write(async () => {
      const c = await this.mustGet(id);
      const before = c.updatedAt;
      await fn(c);
      if (c.updatedAt === before) c.updatedAt = now();
      await this.#db.putComment(c);
      return c;
    });
  }

  async #message(c: Comment, author: Author, body: string, t: string, by?: string): Promise<void> {
    c.messages.push({ id: await this.#db.nextId('message'), author, body, createdAt: t, ...(by ? { name: by } : {}) });
    c.updatedAt = t;
  }

  #act(id: number, action: Action, by?: string): Promise<Comment> {
    return this.#update(id, async (c) => {
      const t = now();
      const outcome = decide(c, action, t);
      c.status = outcome.status;
      c.solution = outcome.solution;
      for (const message of outcome.messages) await this.#message(c, message.author, message.body, t, by);
    });
  }

  /** A copy as the customer sees it: without our own outbox fields. */
  static #snapshot(c: Comment): Comment {
    const { remote: _r, outbox: _o, ...rest } = structuredClone(c);
    return rest;
  }

  /** Applies an outbox action. Its messages get negative ids: they only exist here, never on the hub. */
  async #apply(c: Comment, a: OutboxAction, t: string, by?: string): Promise<void> {
    const action: Action = a.type === 'reply' ? { type: 'message', author: 'claude', body: a.message } : a;
    const outcome = decide(c, action, t);
    c.status = outcome.status;
    c.solution = outcome.solution;
    for (const message of outcome.messages) {
      await this.#message(c, message.author, message.body, t, by);
      const m = c.messages.at(-1)!;
      m.id = -Math.abs(m.id);
    }
  }

  /**
   * base (the hub's version) with the outbox applied again. The messages the outbox
   * made keep their ids and times. Updates that no longer fit (the customer accepted
   * or deleted it meanwhile) are dropped, and the thread says so.
   */
  async #withOutbox(base: Comment, outbox: OutboxAction[], before: Comment['messages']): Promise<Comment> {
    const c: Comment = { ...structuredClone(base), remote: Store.#snapshot(base) };
    // Our own earlier local messages (negative ids, never on the hub), oldest first, to reuse their ids and times.
    const local = before.filter((m) => m.id < 0);
    const kept: OutboxAction[] = [];
    let dropped = 0;
    for (const a of outbox) {
      const n = c.messages.length;
      try {
        await this.#apply(c, a, now());
      } catch {
        dropped++;
        continue;
      }
      kept.push(a);
      // Give the new messages back their first ids and times, so a pull doesn't renumber them.
      for (let i = n; i < c.messages.length; i++) {
        const old = local.shift();
        if (old && old.body === c.messages[i]!.body) c.messages[i] = { ...c.messages[i]!, id: old.id, createdAt: old.createdAt, ...(old.name ? { name: old.name } : {}) };
      }
    }
    if (dropped) {
      await this.#message(c, 'system', `${dropped} unsent update(s) were dropped: the customer changed this comment meanwhile.`, now());
    }
    if (kept.length) c.outbox = kept;
    else delete c.remote;
    return c;
  }

  async #shot(c: Comment, kind: ScreenshotKind, source: ScreenshotSource, dataUrl: string): Promise<ScreenshotMeta> {
    const meta: ScreenshotMeta = { id: await this.#db.nextId('shot'), kind, source, createdAt: now() };
    await this.#db.putShot({ id: meta.id, commentId: c.id, dataUrl });
    c.screenshots.push(meta);
    return meta;
  }
}
