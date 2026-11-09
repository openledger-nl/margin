// All review data, owned by the extension. The background worker is the only
// user. Persistence is behind the Db interface: IndexedDB in the browser
// (idb.ts), a Map in tests.
import {
  pageKey,
  type Author,
  type Comment,
  type CreateCommentInput,
  type ScreenshotKind,
  type ScreenshotMeta,
  type ScreenshotSource,
  type Solution,
  type Status,
} from '@brm/shared';
import { isWebUrl } from './sites.ts';

export type StoreErrorCode = 'not_found' | 'invalid_transition' | 'bad_input';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'StoreError';
  }
}

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

const PNG_DATA_URL = /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$/;

/** Checks a "data:image/png;base64,..." string starts like a real PNG. */
export function checkPngDataUrl(dataUrl: string): string {
  if (!PNG_DATA_URL.test(dataUrl)) throw new StoreError('bad_input', 'Screenshot must be a PNG data URL.');
  return dataUrl;
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
    if (!c) throw new StoreError('not_found', `Comment #${id} does not exist.`);
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
      if (!isWebUrl(input.url)) throw new StoreError('bad_input', 'Only http and https pages.');
      if (input.kind === 'comment' && !input.body.trim()) {
        throw new StoreError('bad_input', 'A comment needs some text.');
      }
      if (input.kind !== 'comment' && input.change?.kind !== input.kind) {
        throw new StoreError('bad_input', `A ${input.kind} needs a matching change.`);
      }
      if (input.kind !== 'comment' && !input.target) {
        throw new StoreError('bad_input', `A ${input.kind} needs a target element.`);
      }
      // Check screenshots before writing anything, so bad input leaves no half comment.
      const page = input.screenshots?.page ? checkPngDataUrl(input.screenshots.page) : null;
      const element = input.screenshots?.element ? checkPngDataUrl(input.screenshots.element) : null;

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
      await this.#message(c, 'user', input.body.trim() || defaultBody(input), t);
      if (page) await this.#shot(c, 'page', 'initial', page);
      if (element) await this.#shot(c, 'element', 'initial', element);
      await this.#db.putComment(c);
      return c;
    });
  }

  addMessage(id: number, author: Author, body: string): Promise<Comment> {
    return this.#update(id, async (c) => {
      if (!body.trim()) throw new StoreError('bad_input', 'Message is empty.');
      await this.#message(c, author, body.trim(), now());
    });
  }

  /** Claude: open or in progress -> in progress. */
  startWork(id: number): Promise<Comment> {
    return this.#update(id, async (c) => {
      if (c.status === 'in_progress') return;
      if (c.status !== 'open') {
        throw new StoreError(
          'invalid_transition',
          `Comment #${id} is ${c.status}. Only open comments can be started. ` +
            (c.status === 'review_ready' ? 'It is waiting for the user to review.' : 'It is already accepted.'),
        );
      }
      await this.#status(c, 'in_progress', 'Claude started working on this.');
    });
  }

  /** Claude: open or in progress -> review ready, with a note on how it was solved. */
  submitSolution(id: number, note: string, files: string[] = []): Promise<Comment> {
    return this.#update(id, async (c) => {
      if (!note.trim()) throw new StoreError('bad_input', 'The solution note is empty.');
      if (c.status !== 'open' && c.status !== 'in_progress') {
        throw new StoreError(
          'invalid_transition',
          `Comment #${id} is ${c.status}. A solution can only be submitted for open or in progress comments.`,
        );
      }
      const solution: Solution = {
        note: note.trim(),
        files: files.map((f) => f.trim()).filter(Boolean),
        createdAt: now(),
      };
      c.solution = solution;
      await this.#status(c, 'review_ready', 'Claude marked this review ready.');
    });
  }

  /** User: review ready -> accepted. */
  accept(id: number): Promise<Comment> {
    return this.#update(id, async (c) => {
      if (c.status !== 'review_ready') {
        throw new StoreError('invalid_transition', `Comment #${id} is ${c.status}, not review ready.`);
      }
      await this.#status(c, 'accepted', 'Solution accepted.');
    });
  }

  /** User: review ready or accepted -> open. The old solution moves into the thread. */
  reopen(id: number, body?: string): Promise<Comment> {
    return this.#update(id, async (c) => {
      if (c.status !== 'review_ready' && c.status !== 'accepted') {
        throw new StoreError('invalid_transition', `Comment #${id} is ${c.status}, it is already open.`);
      }
      const t = now();
      if (c.solution) {
        const files = c.solution.files.length ? `\nFiles: ${c.solution.files.join(', ')}` : '';
        await this.#message(c, 'system', `Previous solution (not accepted):\n${c.solution.note}${files}`, t);
      }
      if (body?.trim()) await this.#message(c, 'user', body.trim(), t);
      c.solution = null;
      await this.#status(c, 'open', 'Reopened.');
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

  async #message(c: Comment, author: Author, body: string, t: string): Promise<void> {
    c.messages.push({ id: await this.#db.nextId('message'), author, body, createdAt: t });
    c.updatedAt = t;
  }

  async #status(c: Comment, status: Status, note: string): Promise<void> {
    c.status = status;
    await this.#message(c, 'system', note, now());
  }

  async #shot(c: Comment, kind: ScreenshotKind, source: ScreenshotSource, dataUrl: string): Promise<ScreenshotMeta> {
    const meta: ScreenshotMeta = { id: await this.#db.nextId('shot'), kind, source, createdAt: now() };
    await this.#db.putShot({ id: meta.id, commentId: c.id, dataUrl });
    c.screenshots.push(meta);
    return meta;
  }
}

function defaultBody(input: CreateCommentInput): string {
  if (input.kind === 'remove') return 'Remove this element.';
  if (input.kind === 'edit') return 'Apply this edit.';
  return '';
}
