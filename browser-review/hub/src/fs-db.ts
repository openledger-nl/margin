// The hub's storage: the shared Store's Db interface on a folder (a Docker volume).
//
//   <dataDir>/
//     comments/0012.json    the comment, source of truth
//     feedback/0012.md      the same comment as Markdown, rewritten on every change
//     feedback/0012-7.png   its screenshots
//     counters.json         next ids
//     deletions.json        ids of deleted comments, so developers can drop them too
//     visits.json           pages reviewers looked at (visits.ts)
//     site-map.md           every page with its visitors and feedback (site-map.ts), for the agent
//
// One process owns the folder: everything is kept in memory and written through.
// The Store runs its writes one after the other, so there are no races here.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Comment, Counter, Db, StoredShot } from '@brm/shared';
import { readJson, writeFileAtomic } from './files.ts';
import { fileId, renderMarkdown, shotFile } from './markdown.ts';

const PNG_PREFIX = 'data:image/png;base64,';

export interface Deletion {
  id: number;
  at: string;
}

export class FsDb implements Db {
  readonly #dir: string;
  readonly #project: string;
  readonly #comments = new Map<number, Comment>();
  /** Screenshot id -> comment id. */
  readonly #shots = new Map<number, number>();
  #counters: Partial<Record<Counter, number>> = {};
  #deletions: Deletion[] = [];
  /** Called after a comment changed or was deleted (the hub rewrites site-map.md). */
  onChange: (() => void) | null = null;

  private constructor(dir: string, project: string) {
    this.#dir = dir;
    this.#project = project;
  }

  /** Loads the folder (creating it when new) and rewrites every Markdown file, so they match this version. */
  static async open(dir: string, project: string): Promise<FsDb> {
    const db = new FsDb(dir, project);
    await mkdir(join(dir, 'comments'), { recursive: true, mode: 0o700 });
    await mkdir(join(dir, 'feedback'), { recursive: true, mode: 0o700 });
    for (const name of await readdir(join(dir, 'comments'))) {
      if (!/^\d+\.json$/.test(name)) continue;
      const c = JSON.parse(await readFile(join(dir, 'comments', name), 'utf8')) as Comment;
      db.#comments.set(c.id, c);
    }
    for (const name of await readdir(join(dir, 'feedback'))) {
      const m = /^(\d+)-(\d+)\.png$/.exec(name);
      if (m) db.#shots.set(Number(m[2]), Number(m[1]));
    }
    db.#counters = await readJson(join(dir, 'counters.json'), {});
    db.#deletions = await readJson(join(dir, 'deletions.json'), []);
    for (const c of db.#comments.values()) await db.#writeMarkdown(c);
    return db;
  }

  async getComment(id: number): Promise<Comment | undefined> {
    const c = this.#comments.get(id);
    return c ? structuredClone(c) : undefined;
  }

  async allComments(): Promise<Comment[]> {
    return [...this.#comments.values()].map((c) => structuredClone(c));
  }

  async putComment(c: Comment): Promise<void> {
    await writeFileAtomic(join(this.#dir, 'comments', `${fileId(c.id)}.json`), `${JSON.stringify(c, null, 2)}\n`);
    this.#comments.set(c.id, structuredClone(c));
    await this.#writeMarkdown(c);
    this.onChange?.();
  }

  async deleteComment(id: number): Promise<void> {
    const shotIds = [...this.#shots].filter(([, commentId]) => commentId === id).map(([shotId]) => shotId);
    await rm(join(this.#dir, 'comments', `${fileId(id)}.json`), { force: true });
    await rm(join(this.#dir, 'feedback', `${fileId(id)}.md`), { force: true });
    for (const shotId of shotIds) {
      await rm(join(this.#dir, 'feedback', shotFile(id, shotId)), { force: true });
      this.#shots.delete(shotId);
    }
    this.#comments.delete(id);
    this.#deletions.push({ id, at: new Date().toISOString() });
    await writeFileAtomic(join(this.#dir, 'deletions.json'), `${JSON.stringify(this.#deletions)}\n`);
    this.onChange?.();
  }

  async putShot(shot: StoredShot): Promise<void> {
    // The Store checked it is a PNG data URL before it gets here.
    const bytes = Buffer.from(shot.dataUrl.slice(PNG_PREFIX.length), 'base64');
    await writeFileAtomic(join(this.#dir, 'feedback', shotFile(shot.commentId, shot.id)), bytes);
    this.#shots.set(shot.id, shot.commentId);
  }

  async getShot(id: number): Promise<StoredShot | undefined> {
    const commentId = this.#shots.get(id);
    if (commentId === undefined) return undefined;
    const bytes = await readFile(join(this.#dir, 'feedback', shotFile(commentId, id)));
    return { id, commentId, dataUrl: PNG_PREFIX + bytes.toString('base64') };
  }

  async nextId(counter: Counter): Promise<number> {
    const n = (this.#counters[counter] ?? 0) + 1;
    this.#counters[counter] = n;
    await writeFileAtomic(join(this.#dir, 'counters.json'), `${JSON.stringify(this.#counters)}\n`);
    return n;
  }

  /** Comments deleted after this time (ISO), for developers who pulled them before. */
  deletedSince(since: string | null): number[] {
    return this.#deletions.filter((d) => !since || d.at > since).map((d) => d.id);
  }

  async #writeMarkdown(c: Comment): Promise<void> {
    await writeFileAtomic(join(this.#dir, 'feedback', `${fileId(c.id)}.md`), renderMarkdown(c, this.#project));
  }
}
