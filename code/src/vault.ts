// The vault on disk: reading Ledger's projects and threads, and reading and writing review and comment files.
//
//   projects/<project>/project.md                                       a project (Ledger's)
//   projects/<project>/threads/<thread>/thread.md                       a thread (Ledger's, once created)
//   projects/<project>/threads/<thread>/reviews/<review>.md             a review
//   projects/<project>/threads/<thread>/reviews/<review>/<comment>.md   a comment in it, or a reply
//
// Nothing here knows about VS Code, so it is tested against real folders.
import { mkdir, readdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from './atomic';
import {
  COMMENT_KEYS, commentFile, type CommentMeta, FORMAT, formatOf, isSupported, patch, readComment, readReview,
  REVIEW_KEYS, reviewFile, type ReviewMeta,
} from './format';
import { Frontmatter, normalizeBody } from './frontmatter';
import { type Ids, systemIds } from './ids';
import { slugify } from './slug';

export interface ProjectInfo {
  slug: string;
  name: string;
}

export interface ThreadInfo {
  project: string;
  slug: string;
  title: string;
  createdAt: string;
}

export interface ReviewRecord {
  file: string;
  id: string;
  project: string;
  thread: string;
  meta: ReviewMeta;
  summary: string;
  /** false for a file of a newer format: shown, never written. */
  supported: boolean;
}

export interface CommentRecord {
  file: string;
  id: string;
  meta: CommentMeta;
  body: string;
  supported: boolean;
}

export type NewReview = Omit<ReviewMeta, 'format' | 'createdAt' | 'updatedAt' | 'state' | 'verdict' | 'submittedAt'>;
export type NewComment = Omit<CommentMeta, 'format' | 'createdAt' | 'updatedAt'>;

export class UnsupportedFormatError extends Error {
  constructor(readonly file: string, readonly format: number) {
    super(`${path.basename(file)} has format ${format}, newer than this margin-code knows (${FORMAT}); it is left untouched.`);
  }
}

/**
 * The review or its thread is no longer in the vault (deleted in Ledger, say). Nothing is written then: writing
 * would bring back the folders Ledger just removed, as a thread without its thread.md.
 */
export class GoneError extends Error {}

async function exists(p: string, kind: 'file' | 'dir'): Promise<boolean> {
  try {
    const s = await stat(p);
    return kind === 'file' ? s.isFile() : s.isDirectory();
  } catch {
    return false;
  }
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function subdirs(dir: string): Promise<string[]> {
  return (await entries(dir)).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
}

async function markdownFiles(dir: string): Promise<string[]> {
  return (await entries(dir)).filter((e) => e.isFile() && !e.name.startsWith('.') && e.name.endsWith('.md')).map((e) => e.name).sort();
}

async function readFrontmatter(file: string): Promise<Frontmatter | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  return Frontmatter.parse(text);
}

export class Vault {
  constructor(
    readonly root: string,
    /** Where ids and timestamps come from: the clock, unless a test wants every file to come out the same. */
    readonly ids: Ids = systemIds,
  ) {}

  get projectsDir(): string {
    return path.join(this.root, 'projects');
  }

  threadDir(project: string, thread: string): string {
    return path.join(this.projectsDir, project, 'threads', thread);
  }

  /** The folder holding a review's comments: the review file without ".md". */
  commentsDir(reviewFile: string): string {
    return reviewFile.replace(/\.md$/, '');
  }

  /** A vault path in the form the spec writes it, for messages. */
  relative(file: string): string {
    return path.relative(this.root, file).split(path.sep).join('/');
  }

  /** Where a file sits: project and thread for anything inside a thread's reviews folder. */
  where(file: string): { project: string; thread: string } | undefined {
    const parts = this.relative(file).split('/');
    if (parts[0] !== 'projects' || parts[2] !== 'threads' || parts[4] !== 'reviews' || !parts[1] || !parts[3]) return undefined;
    return { project: parts[1], thread: parts[3] };
  }

  // ---- Ledger's projects and threads ------------------------------------------------------------------

  async listProjects(): Promise<ProjectInfo[]> {
    const slugs = await subdirs(this.projectsDir);
    const projects = await Promise.all(
      slugs.map(async (slug) => {
        const fm = await readFrontmatter(path.join(this.projectsDir, slug, 'project.md'));
        return { slug, name: fm?.text('name') ?? slug };
      }),
    );
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The project's threads, newest first. */
  async listThreads(project: string): Promise<ThreadInfo[]> {
    const slugs = await subdirs(path.join(this.projectsDir, project, 'threads'));
    const threads = await Promise.all(
      slugs.map(async (slug) => {
        const fm = await readFrontmatter(path.join(this.threadDir(project, slug), 'thread.md'));
        return { project, slug, title: fm?.text('title') ?? slug, createdAt: fm?.text('createdAt') ?? '' };
      }),
    );
    return threads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.slug.localeCompare(b.slug)));
  }

  /**
   * A new thread folder, named the way Ledger names one, with a thread.md holding its title and createdAt.
   * After this, thread.md is Ledger's: margin-code never writes it again.
   */
  async createThread(project: string, title: string): Promise<ThreadInfo> {
    const threads = path.join(this.projectsDir, project, 'threads');
    await mkdir(threads, { recursive: true });
    const base = slugify(title);
    let slug = base;
    for (let n = 2; ; n++) {
      try {
        await mkdir(path.join(threads, slug));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        slug = `${base}-${n}`;
      }
    }
    const createdAt = this.ids.now();
    const fm = Frontmatter.create({ title: title.trim(), createdAt });
    await writeFileAtomic(path.join(threads, slug, 'thread.md'), fm.toString());
    return { project, slug, title: title.trim(), createdAt };
  }

  // ---- reviews ---------------------------------------------------------------------------------------

  async readReview(file: string): Promise<ReviewRecord | undefined> {
    const fm = await readFrontmatter(file);
    const where = this.where(file);
    if (!fm || !where) return undefined;
    const meta = readReview(fm);
    return { file, id: path.basename(file, '.md'), ...where, meta, summary: fm.body, supported: isSupported(meta.format) };
  }

  /** Every review in the vault; files that aren't readable reviews are skipped. */
  async listReviews(): Promise<ReviewRecord[]> {
    const files: string[] = [];
    for (const project of await subdirs(this.projectsDir)) {
      for (const thread of await subdirs(path.join(this.projectsDir, project, 'threads'))) {
        const reviews = path.join(this.threadDir(project, thread), 'reviews');
        for (const name of await markdownFiles(reviews)) files.push(path.join(reviews, name));
      }
    }
    const records = await Promise.all(files.map((f) => this.readReview(f)));
    return records.filter((r): r is ReviewRecord => r !== undefined && r.meta.repo !== '' && r.meta.head !== '');
  }

  async createReview(project: string, thread: string, review: NewReview, summary = ''): Promise<ReviewRecord> {
    const threadDir = this.threadDir(project, thread);
    if (!(await exists(threadDir, 'dir'))) throw new GoneError(`The thread ${project}/${thread} is no longer in the vault.`);
    const dir = path.join(threadDir, 'reviews');
    await mkdir(dir, { recursive: true });
    const stamp = this.ids.stamp();
    const meta: ReviewMeta = { format: FORMAT, ...review, state: 'draft', createdAt: stamp.at, updatedAt: stamp.at };
    const file = path.join(dir, `${stamp.id}.md`);
    await writeFileAtomic(file, reviewFile(meta, summary).toString());
    return { file, id: stamp.id, project, thread, meta, summary: normalizeBody(summary), supported: true };
  }

  /** Changes some keys (undefined removes one) and, when given, the summary. Sets updatedAt. */
  async updateReview(file: string, changes: Partial<ReviewMeta>, summary?: string): Promise<ReviewRecord> {
    const fm = await this.editable(file);
    patch(fm, { ...changes, updatedAt: changes.updatedAt ?? this.ids.now() }, REVIEW_KEYS);
    if (summary !== undefined) fm.body = summary;
    await writeFileAtomic(file, fm.toString());
    const record = await this.readReview(file);
    if (!record) throw new Error(`${this.relative(file)} could not be read back.`);
    return record;
  }

  // ---- comments --------------------------------------------------------------------------------------

  private async readCommentFile(file: string): Promise<CommentRecord | undefined> {
    const fm = await readFrontmatter(file);
    if (!fm) return undefined;
    const meta = readComment(fm);
    return { file, id: path.basename(file, '.md'), meta, body: fm.body, supported: isSupported(meta.format) };
  }

  /** The review's comments and replies, oldest first. */
  async listComments(reviewFile: string): Promise<CommentRecord[]> {
    const dir = this.commentsDir(reviewFile);
    const records = await Promise.all((await markdownFiles(dir)).map((name) => this.readCommentFile(path.join(dir, name))));
    return records.filter((r): r is CommentRecord => r !== undefined).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async countComments(reviewFile: string): Promise<number> {
    return (await markdownFiles(this.commentsDir(reviewFile))).length;
  }

  async createComment(reviewFile: string, comment: NewComment, body: string): Promise<CommentRecord> {
    const gone = () => new GoneError(`The review ${this.relative(reviewFile)} is no longer in the vault.`);
    if (!(await exists(reviewFile, 'file'))) throw gone();
    const dir = this.commentsDir(reviewFile);
    // Only the review's own folder: its parents are there, unless the review was removed meanwhile.
    await mkdir(dir).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
      throw isMissing(error) ? gone() : error;
    });
    const stamp = this.ids.stamp();
    const meta: CommentMeta = { format: FORMAT, ...comment, createdAt: stamp.at, updatedAt: stamp.at };
    const file = path.join(dir, `${stamp.id}.md`);
    await writeFileAtomic(file, commentFile(meta, body).toString());
    return { file, id: stamp.id, meta, body: normalizeBody(body), supported: true };
  }

  async updateComment(file: string, changes: Partial<CommentMeta>, body?: string): Promise<CommentRecord> {
    const fm = await this.editable(file);
    patch(fm, { ...changes, updatedAt: changes.updatedAt ?? this.ids.now() }, COMMENT_KEYS);
    if (body !== undefined) fm.body = body;
    await writeFileAtomic(file, fm.toString());
    const record = await this.readCommentFile(file);
    if (!record) throw new Error(`${this.relative(file)} could not be read back.`);
    return record;
  }

  async deleteComment(file: string): Promise<void> {
    const fm = await readFrontmatter(file);
    if (fm) {
      const format = readComment(fm).format;
      if (!isSupported(format)) throw new UnsupportedFormatError(file, format);
    }
    await rm(file, { force: true });
    // The review's folder goes with its last comment; a folder that still holds anything stays.
    await rmdir(path.dirname(file)).catch(() => undefined);
  }

  /** A file's frontmatter, ready to change; throws for a file that is missing, unreadable or of a newer format. */
  private async editable(file: string): Promise<Frontmatter> {
    const text = await readFile(file, 'utf8').catch((error: unknown) => {
      throw isMissing(error) ? new GoneError(`${this.relative(file)} is no longer in the vault.`) : error;
    });
    const fm = Frontmatter.parse(text);
    if (!fm) throw new Error(`${this.relative(file)} has no readable frontmatter; it is left as it is.`);
    const format = formatOf(fm);
    if (!isSupported(format)) throw new UnsupportedFormatError(file, format);
    return fm;
  }
}
