// Comments in the diffs, on both sides: a CommentController that shows the active review's conversations where
// they belong, and turns add, reply, edit, delete and resolve into writes to the vault, at once.
import * as vscode from 'vscode';
import { fileOnSide, type Placement, shownCommit } from '../placement';
import { ReadOnlyError, type ReviewSession, type Target } from '../session';
import { type CommentRecord, GoneError } from '../vault';
import type { Controller } from './controller';
import type { GitContentProvider } from './documents';
import { parseSideUri, short, sideUri } from './uris';
import { errorText } from './workspace';

export class MarginComment implements vscode.Comment {
  body: string | vscode.MarkdownString;
  mode = vscode.CommentMode.Preview;
  author: vscode.CommentAuthorInformation;
  label: string | undefined;
  timestamp: Date | undefined;
  contextValue: string;

  constructor(
    readonly record: CommentRecord,
    readonly thread: vscode.CommentThread,
    editable: boolean,
  ) {
    this.body = markdown(record.body);
    this.author = { name: record.meta.author || 'Someone' };
    const created = Date.parse(record.meta.createdAt);
    this.timestamp = Number.isNaN(created) ? undefined : new Date(created);
    this.label = !record.supported ? 'newer format, read-only' : record.meta.updatedAt !== record.meta.createdAt ? 'edited' : undefined;
    this.contextValue = editable && record.supported ? 'margin-editable' : 'margin-readonly';
  }
}

function markdown(text: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(text);
  md.supportThemeIcons = false;
  md.supportHtml = false;
  return md;
}

const bodyText = (body: string | vscode.MarkdownString) => (typeof body === 'string' ? body : body.value);

interface Shown {
  thread: vscode.CommentThread;
  signature: string;
}

export class CommentsUi implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('margin', 'Margin');
  /** Threads on screen, by the id of their conversation's first comment. */
  private readonly shown = new Map<string, Shown>();
  private readonly rootOf = new WeakMap<vscode.CommentThread, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private session: ReviewSession | undefined;

  constructor(
    private readonly margin: Controller,
    private readonly documents: GitContentProvider,
  ) {
    this.controller.options = { prompt: 'Comment on this change', placeHolder: 'Write a review comment (markdown)' };
    this.controller.commentingRangeProvider = { provideCommentingRanges: (doc) => this.commentingRanges(doc) };
    this.disposables.push(
      this.controller,
      margin.onDidChange(() => this.render()),
      vscode.commands.registerCommand('margin.comment.create', (reply: vscode.CommentReply) => this.guard(() => this.create(reply))),
      vscode.commands.registerCommand('margin.comment.reply', (reply: vscode.CommentReply) => this.guard(() => this.reply(reply))),
      vscode.commands.registerCommand('margin.comment.edit', (c: MarginComment) => this.startEdit(c)),
      vscode.commands.registerCommand('margin.comment.save', (c: MarginComment) => this.guard(() => this.save(c))),
      vscode.commands.registerCommand('margin.comment.cancel', (c: MarginComment) => this.cancelEdit(c)),
      vscode.commands.registerCommand('margin.comment.delete', (c: MarginComment) => this.guard(() => this.remove(c))),
      vscode.commands.registerCommand('margin.thread.resolve', (t: vscode.CommentThread) => this.guard(() => this.resolve(t, true))),
      vscode.commands.registerCommand('margin.thread.unresolve', (t: vscode.CommentThread) => this.guard(() => this.resolve(t, false))),
    );
    this.render();
  }

  private async guard(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      const text = errorText(error);
      if (error instanceof ReadOnlyError) void vscode.window.showInformationMessage(text);
      else if (error instanceof GoneError) {
        void vscode.window.showWarningMessage(`${text} Nothing was written.`);
        this.margin.scheduleReload(); // closes the review once it is gone
      }
      else void vscode.window.showErrorMessage(`Margin: ${text}`);
    }
  }

  private active(): ReviewSession {
    const s = this.margin.session;
    if (!s) throw new Error('There is no active review. Start or resume one first.');
    return s;
  }

  /** The document's side of a file in the active draft, if comments can go there. */
  private targetOf(uri: vscode.Uri): { session: ReviewSession; side: Target['side']; path: string } | undefined {
    const s = this.margin.session;
    const ref = parseSideUri(uri);
    if (!s || s.readOnly || !ref || ref.root !== s.root || ref.sha !== shownCommit(s.review, ref.side)) return undefined;
    if (!fileOnSide(s.files, ref.side, ref.path)) return undefined;
    return { session: s, side: ref.side, path: ref.path };
  }

  private commentingRanges(doc: vscode.TextDocument): vscode.CommentingRanges | undefined {
    if (!this.targetOf(doc.uri)) return undefined;
    const binary = this.documents.binary.has(doc.uri.toString());
    return { enableFileComments: true, ranges: binary ? [] : [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)] };
  }

  // ---- showing --------------------------------------------------------------------------------------------

  /** Brings the threads on screen in line with the active review. */
  private render(): void {
    const s = this.margin.session;
    if (s !== this.session) {
      for (const { thread } of this.shown.values()) thread.dispose();
      this.shown.clear();
      this.session = s;
    }
    if (!s) return;

    const keep = new Set<string>();
    for (const conversation of s.conversations) {
      const placement = s.placements.get(conversation.root.id);
      if (!placement || placement.kind === 'outdated') continue;
      keep.add(conversation.root.id);
      this.show(s, conversation.root, conversation.replies, placement);
    }
    for (const [id, { thread }] of this.shown) {
      if (!keep.has(id)) {
        thread.dispose();
        this.shown.delete(id);
      }
    }
  }

  private show(s: ReviewSession, root: CommentRecord, replies: CommentRecord[], placement: Exclude<Placement, { kind: 'outdated' }>): void {
    const uri = sideUri({ root: s.root, sha: shownCommit(s.review, placement.side), side: placement.side, path: placement.path });
    const range = placement.kind === 'line' ? new vscode.Range(placement.line - 1, 0, placement.endLine - 1, 0) : undefined;
    const writable = !s.readOnly && root.supported;
    const signature = JSON.stringify([
      uri.toString(), placement, writable, root.meta.resolved,
      [root, ...replies].map((c) => [c.id, c.meta.updatedAt, c.body, c.supported]),
    ]);

    const existing = this.shown.get(root.id);
    if (existing?.signature === signature) return;
    let thread = existing?.thread;
    if (thread && thread.uri.toString() !== uri.toString()) {
      thread.dispose();
      thread = undefined;
    }
    if (!thread) {
      thread = this.controller.createCommentThread(uri, range ?? new vscode.Range(0, 0, 0, 0), []);
      thread.collapsibleState = root.meta.resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
      this.rootOf.set(thread, root.id);
    }
    thread.range = range;

    // A comment being edited keeps its editor, whatever arrives from the vault meanwhile.
    const editing = new Map(
      thread.comments.filter((c): c is MarginComment => c instanceof MarginComment && c.mode === vscode.CommentMode.Editing).map((c) => [c.record.id, c]),
    );
    const t = thread;
    thread.comments = [root, ...replies].map((c) => editing.get(c.id) ?? new MarginComment(c, t, writable && !s.readOnly));
    thread.canReply = writable;
    thread.state = root.meta.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
    thread.contextValue = !writable ? 'margin-readonly' : root.meta.resolved ? 'margin-resolved' : 'margin-unresolved';
    thread.label = movedLabel(placement);
    this.shown.set(root.id, { thread, signature });
  }

  /** An empty thread on a whole file, open for typing; Add Comment turns it into a conversation. */
  newFileThread(uri: vscode.Uri): void {
    if (!this.targetOf(uri)) return;
    const thread = this.controller.createCommentThread(uri, new vscode.Range(0, 0, 0, 0), []);
    thread.range = undefined;
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }

  // ---- changing -------------------------------------------------------------------------------------------

  private async create(reply: vscode.CommentReply): Promise<void> {
    const target = this.targetOf(reply.thread.uri);
    if (!target) throw new ReadOnlyError("Comments can only go on the files of the active draft review's diff.");
    const range = reply.thread.range;
    let lines: { line?: number; endLine?: number } = {};
    if (range) {
      // A selection that ends at the start of a line doesn't include that line.
      const end = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
      lines = { line: range.start.line + 1, endLine: end + 1 };
    }
    await target.session.addComment({ side: target.side, path: target.path, ...lines }, reply.text);
    // The new conversation now has its own thread; this one was only VS Code's input box.
    reply.thread.dispose();
  }

  private async reply(reply: vscode.CommentReply): Promise<void> {
    const rootId = this.rootOf.get(reply.thread);
    if (!rootId) throw new Error('That conversation is no longer in the review.');
    await this.active().reply(rootId, reply.text);
  }

  private startEdit(comment: MarginComment): void {
    comment.mode = vscode.CommentMode.Editing;
    comment.body = comment.record.body;
    comment.thread.comments = [...comment.thread.comments];
  }

  private cancelEdit(comment: MarginComment): void {
    comment.mode = vscode.CommentMode.Preview;
    comment.body = markdown(comment.record.body);
    comment.thread.comments = [...comment.thread.comments];
  }

  private async save(comment: MarginComment): Promise<void> {
    const text = bodyText(comment.body);
    // Leave editing first, so the reload that follows the write shows the saved text.
    comment.mode = vscode.CommentMode.Preview;
    try {
      await this.active().edit(comment.record.id, text);
    } catch (error) {
      comment.mode = vscode.CommentMode.Editing;
      comment.thread.comments = [...comment.thread.comments];
      throw error;
    }
  }

  private async remove(comment: MarginComment): Promise<void> {
    const s = this.active();
    const conversation = s.conversationOf(comment.record.id);
    if (conversation && conversation.root.id === comment.record.id && conversation.replies.length > 0) {
      const n = conversation.replies.length;
      const ok = await vscode.window.showWarningMessage(
        `Delete this comment and its ${n === 1 ? 'reply' : `${n} replies`}?`,
        { modal: true, detail: 'They are deleted from the Ledger vault.' },
        'Delete',
      );
      if (ok !== 'Delete') return;
    }
    await s.remove(comment.record.id);
  }

  private async resolve(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
    const rootId = this.rootOf.get(thread);
    if (!rootId) throw new Error('That conversation is no longer in the review.');
    await this.active().setResolved(rootId, resolved);
  }

  dispose(): void {
    for (const { thread } of this.shown.values()) thread.dispose();
    this.shown.clear();
    for (const d of this.disposables) d.dispose();
  }
}

function movedLabel(placement: Exclude<Placement, { kind: 'outdated' }>): string | undefined {
  if (!placement.moved) return undefined;
  const { commit, path } = placement.moved;
  const was = placement.kind === 'line' ? `line ${placement.moved.line}` : 'this file';
  const renamed = path !== placement.path ? ` of ${path}` : '';
  return `Made on ${was}${renamed} at ${short(commit)}`;
}
