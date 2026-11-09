// All review data, owned by the extension. The background worker is the only
// user. Persistence is behind the Db interface: IndexedDB in the browser
// (idb.ts), a Map in tests.
import {
  checkCreate,
  checkPngDataUrl,
  decide,
  ReviewError,
  type Action,
  pageKey,
  type Author,
  type Comment,
  type CreateCommentInput,
  type ScreenshotKind,
  type ScreenshotMeta,
  type ScreenshotSource,
  type Status,
} from '@brm/shared';
import { isWebUrl } from './sites.ts';

export interface ListFilter {
  origin?: string;
  path?: string;
  statuses?: Status[];
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
      .sort((a, b) => a.id - b.id);
  }

  // ---------- writing ----------

  create(input: CreateCommentInput): Promise<Comment> {
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
      await this.#message(c, 'user', body, t);
      if (page) await this.#shot(c, 'page', 'initial', page);
      if (element) await this.#shot(c, 'element', 'initial', element);
      await this.#db.putComment(c);
      return c;
    });
  }

  addMessage(id: number, author: Author, body: string): Promise<Comment> {
    return this.#act(id, { type: 'message', author, body });
  }

  /** Claude: open or in progress -> in progress. */
  startWork(id: number): Promise<Comment> {
    return this.#act(id, { type: 'start_work' });
  }

  /** Claude: open or in progress -> review ready, with a note on how it was solved. */
  submitSolution(id: number, note: string, files: string[] = []): Promise<Comment> {
    return this.#act(id, { type: 'submit_solution', note, files });
  }

  /** User: review ready -> accepted. */
  accept(id: number): Promise<Comment> {
    return this.#act(id, { type: 'accept' });
  }

  /** User: review ready or accepted -> open. The old solution moves into the thread. */
  reopen(id: number, body?: string): Promise<Comment> {
    return this.#act(id, { type: 'reopen', body });
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

  async #message(c: Comment, author: Author, body: string, t: string): Promise<void> {
    c.messages.push({ id: await this.#db.nextId('message'), author, body, createdAt: t });
    c.updatedAt = t;
  }

  #act(id: number, action: Action): Promise<Comment> {
    return this.#update(id, async (c) => {
      const t = now();
      const outcome = decide(c, action, t);
      c.status = outcome.status;
      c.solution = outcome.solution;
      for (const message of outcome.messages) await this.#message(c, message.author, message.body, t);
    });
  }

  async #shot(c: Comment, kind: ScreenshotKind, source: ScreenshotSource, dataUrl: string): Promise<ScreenshotMeta> {
    const meta: ScreenshotMeta = { id: await this.#db.nextId('shot'), kind, source, createdAt: now() };
    await this.#db.putShot({ id: meta.id, commentId: c.id, dataUrl });
    c.screenshots.push(meta);
    return meta;
  }
}
