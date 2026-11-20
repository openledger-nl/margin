// The review being worked on: its changed files, its conversations and where each shows, and every change to it,
// written to the vault at once. Nothing here knows about VS Code; the UI listens for changes.
import { userInfo } from 'node:os';
import { excerpt, type Hunk, splitLines } from './anchor';
import type { ReviewMeta, Side, Verdict } from './format';
import type { ChangedFile, Git } from './git';
import { buildConversations, type Conversation } from './model';
import { place, type Placement, type PlacementSource, shownCommit } from './placement';
import type { CommentRecord, ReviewRecord, Vault } from './vault';

export class MissingCommitError extends Error {
  constructor(readonly shas: readonly string[]) {
    super(`This clone doesn't have ${shas.map((s) => s.slice(0, 7)).join(' and ')} yet.`);
  }
}

export class ReadOnlyError extends Error {}

export interface Target {
  side: Side;
  /** The path on that side. */
  path: string;
  /** 1-based lines; leave both out for a comment on the whole file. */
  line?: number;
  endLine?: number;
}

/** Bytes that are text: no NUL in the first 8000, the way git decides. */
export function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

export class ReviewSession implements PlacementSource {
  files: ChangedFile[] = [];
  comments: CommentRecord[] = [];
  conversations: Conversation[] = [];
  orphans: CommentRecord[] = [];
  /** Where each conversation shows, by the id of its first comment. */
  placements = new Map<string, Placement>();

  private readonly texts = new Map<string, Promise<string[] | undefined>>();
  private readonly hunkCache = new Map<string, Promise<Hunk[]>>();
  private readonly renameCache = new Map<string, Promise<ChangedFile[]>>();
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly vault: Vault,
    readonly git: Git,
    /** The repository's root folder on this machine. */
    readonly root: string,
    public record: ReviewRecord,
    readonly author: string,
  ) {}

  static async open(vault: Vault, git: Git, file: string, root: string): Promise<ReviewSession> {
    const record = await vault.readReview(file);
    if (!record) throw new Error(`${vault.relative(file)} isn't a readable review.`);
    const missing = [];
    for (const sha of new Set([record.meta.base, record.meta.head])) if (!(await git.hasCommit(root, sha))) missing.push(sha);
    if (missing.length > 0) throw new MissingCommitError(missing);
    const author = (await git.userName(root)) ?? userInfo().username;
    const session = new ReviewSession(vault, git, root, record, author);
    session.files = await git.changedFiles(root, record.meta.base, record.meta.head);
    await session.loadComments();
    return session;
  }

  get review(): ReviewMeta {
    return this.record.meta;
  }

  get file(): string {
    return this.record.file;
  }

  /** Submitted reviews are final; files of a newer format are left alone. */
  get readOnly(): boolean {
    return this.record.meta.state === 'submitted' || !this.record.supported;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /** Runs one change at a time, so a reload never sees half of one. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ---- reading -----------------------------------------------------------------------------------------

  /** A file's lines at a commit, or undefined when it isn't there (or isn't text). */
  content(sha: string, path: string): Promise<string[] | undefined> {
    const key = `${sha}:${path}`;
    let text = this.texts.get(key);
    if (!text) {
      text = this.git.show(this.root, sha, path).then((bytes) => (bytes && !isBinary(bytes) ? splitLines(bytes.toString('utf8')) : undefined));
      this.texts.set(key, text);
    }
    return text;
  }

  hunks(from: string, to: string, fromPath: string, toPath: string): Promise<Hunk[]> {
    const key = `${from}:${to}:${fromPath}:${toPath}`;
    let hunks = this.hunkCache.get(key);
    if (!hunks) {
      hunks = this.git.hunks(this.root, from, to, fromPath, toPath);
      this.hunkCache.set(key, hunks);
    }
    return hunks;
  }

  async renamedTo(from: string, to: string, path: string): Promise<string | null> {
    const key = `${from}:${to}`;
    let changes = this.renameCache.get(key);
    if (!changes) {
      changes = this.git.changedFiles(this.root, from, to);
      this.renameCache.set(key, changes);
    }
    const change = (await changes).find((f) => (f.oldPath ?? f.path) === path && f.status !== 'A' && f.status !== 'C');
    if (!change) return path;
    return change.status === 'D' ? null : change.path;
  }

  hasCommit(sha: string): Promise<boolean> {
    return this.git.hasCommit(this.root, sha);
  }

  conversationOf(commentId: string): Conversation | undefined {
    return this.conversations.find((c) => c.root.id === commentId || c.replies.some((r) => r.id === commentId));
  }

  private async loadComments(): Promise<void> {
    this.comments = await this.vault.listComments(this.file);
    const { conversations, orphans } = buildConversations(this.comments);
    const placements = new Map<string, Placement>();
    for (const c of conversations) placements.set(c.root.id, await place(c.root, this));
    this.conversations = conversations;
    this.orphans = orphans;
    this.placements = placements;
  }

  /** Reads the review and its comments again, after a change from elsewhere (another machine, through Ledger's sync). */
  reload(): Promise<'gone' | 'loaded'> {
    return this.serial(async () => {
      const record = await this.vault.readReview(this.file);
      if (!record) return 'gone';
      const moved = record.meta.base !== this.record.meta.base || record.meta.head !== this.record.meta.head;
      if (moved) {
        const missing = [];
        for (const sha of new Set([record.meta.base, record.meta.head])) if (!(await this.hasCommit(sha))) missing.push(sha);
        if (missing.length > 0) throw new MissingCommitError(missing);
        this.files = await this.git.changedFiles(this.root, record.meta.base, record.meta.head);
      }
      this.record = record;
      await this.loadComments();
      this.changed();
      return 'loaded';
    });
  }

  // ---- changing ----------------------------------------------------------------------------------------

  private mutate<T>(work: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      if (this.readOnly) {
        throw new ReadOnlyError(this.record.supported ? 'This review is submitted, so it can no longer change.' : 'This review has a newer format; margin-code leaves it untouched.');
      }
      const result = await work();
      await this.loadComments();
      this.changed();
      return result;
    });
  }

  private find(commentId: string): CommentRecord {
    const comment = this.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error('That comment is no longer in the vault.');
    if (!comment.supported) throw new ReadOnlyError('That comment has a newer format; margin-code leaves it untouched.');
    return comment;
  }

  /** Starts a conversation: on lines of a diff side, or on a whole file. */
  addComment(target: Target, body: string): Promise<CommentRecord> {
    return this.mutate(async () => {
      const commit = shownCommit(this.review, target.side);
      let anchor = {};
      if (target.line !== undefined) {
        const endLine = Math.max(target.line, target.endLine ?? target.line);
        const lines = (await this.content(commit, target.path)) ?? [];
        anchor = { line: target.line, endLine, ...excerpt(lines, target.line, endLine) };
      }
      return this.vault.createComment(this.file, { path: target.path, side: target.side, ...anchor, commit, resolved: false, author: this.author }, body);
    });
  }

  reply(rootId: string, body: string): Promise<CommentRecord> {
    return this.mutate(() => this.vault.createComment(this.file, { replyTo: this.find(rootId).id, author: this.author }, body));
  }

  edit(commentId: string, body: string): Promise<CommentRecord> {
    return this.mutate(() => this.vault.updateComment(this.find(commentId).file, {}, body));
  }

  setResolved(rootId: string, resolved: boolean): Promise<CommentRecord> {
    return this.mutate(() => this.vault.updateComment(this.find(rootId).file, { resolved }));
  }

  /** Deletes a comment; deleting the first comment of a conversation deletes its replies with it. */
  remove(commentId: string): Promise<void> {
    return this.mutate(async () => {
      const comment = this.find(commentId);
      const conversation = this.conversationOf(commentId);
      const replies = conversation && conversation.root.id === commentId ? conversation.replies : [];
      const untouchable = replies.find((r) => !r.supported);
      if (untouchable) throw new ReadOnlyError('A reply in this conversation has a newer format, so margin-code leaves the conversation as it is.');
      for (const reply of [...replies].reverse()) await this.vault.deleteComment(reply.file);
      await this.vault.deleteComment(comment.file);
    });
  }

  /** Keeps a summary on the draft without submitting it. */
  saveSummary(summary: string): Promise<void> {
    return this.mutate(async () => {
      this.record = await this.vault.updateReview(this.file, {}, summary);
    });
  }

  /** Makes the review final: verdict, summary and submittedAt. From then on it is read-only. */
  submit(verdict: Verdict, summary: string): Promise<void> {
    return this.mutate(async () => {
      const at = this.vault.ids.now();
      this.record = await this.vault.updateReview(this.file, { state: 'submitted', verdict, submittedAt: at, updatedAt: at }, summary);
    });
  }

  /** Reviews a newer commit of the branch in this draft. Comments stay on their commit and are found again. */
  moveHead(head: string, headRef: string | undefined): Promise<void> {
    return this.mutate(async () => {
      this.record = await this.vault.updateReview(this.file, { head, headRef });
      this.files = await this.git.changedFiles(this.root, this.review.base, head);
    });
  }
}
