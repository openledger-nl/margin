// The Margin view: the active review's changed files, and the conversations that can no longer be shown in the
// code ("Outdated"), still readable.
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ChangedFile } from '../git';
import type { Conversation } from '../model';
import { fileOnSide, type Placement } from '../placement';
import type { CommentRecord } from '../vault';
import type { Controller } from './controller';
import { fileUri, short } from './uris';

type Node =
  | { kind: 'file'; file: ChangedFile }
  | { kind: 'outdated' }
  | { kind: 'note'; root: CommentRecord; replies: CommentRecord[]; reason: string };

export class ReviewTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly view: vscode.TreeView<Node>;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly controller: Controller) {
    this.view = vscode.window.createTreeView('margin.review', { treeDataProvider: this, showCollapseAll: false });
    this.subscription = controller.onDidChange(() => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    const s = this.controller.session;
    if (s) {
      const { review } = s;
      this.view.description = `${review.repoName}: ${review.baseRef ?? short(review.base)} → ${review.headRef ?? short(review.head)}`;
      this.view.message =
        review.state === 'submitted'
          ? `Submitted${review.verdict ? `: ${VERDICTS[review.verdict]}` : ''}. Read-only.`
          : !s.record.supported
            ? `This review has format ${review.format}, newer than this Margin knows. Read-only.`
            : s.files.length === 0
              ? `No changes between ${short(review.base)} and ${short(review.head)}.`
              : undefined;
      this.view.badge = s.conversations.length > 0 ? { value: s.conversations.length, tooltip: `${s.conversations.length} conversations` } : undefined;
    } else {
      this.view.description = undefined;
      this.view.message = undefined;
      this.view.badge = undefined;
    }
    this.emitter.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    const s = this.controller.session;
    if (!s) return [];
    if (!node) {
      const files: Node[] = [...s.files].sort((a, b) => a.path.localeCompare(b.path)).map((file) => ({ kind: 'file', file }));
      return outdated(s.conversations, s.placements, s.orphans).length > 0 ? [...files, { kind: 'outdated' }] : files;
    }
    if (node.kind === 'outdated') return outdated(s.conversations, s.placements, s.orphans);
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const s = this.controller.session;
    if (node.kind === 'outdated') {
      const count = s ? outdated(s.conversations, s.placements, s.orphans).length : 0;
      const item = new vscode.TreeItem(`Outdated (${count})`, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('history');
      item.tooltip = "Comments whose code changed or went away since they were made. They aren't shown in the code.";
      return item;
    }
    if (node.kind === 'note') {
      const first = node.root.body.split('\n').find((l) => l.trim() !== '') ?? '(empty)';
      const item = new vscode.TreeItem(first, vscode.TreeItemCollapsibleState.None);
      const where = node.root.meta.path ? `${node.root.meta.path}${node.root.meta.line ? `:${node.root.meta.line}` : ''}` : 'reply';
      item.description = node.replies.length > 0 ? `${where} · ${node.replies.length + 1} comments` : where;
      item.iconPath = new vscode.ThemeIcon(node.root.meta.resolved ? 'pass' : 'comment');
      item.tooltip = new vscode.MarkdownString(noteMarkdown(node.root, node.replies, node.reason));
      item.command = { command: 'margin.openOutdated', title: 'Show Comment', arguments: [node.root.id] };
      return item;
    }

    const { file } = node;
    const item = new vscode.TreeItem(fileUri(file.path, file.status), vscode.TreeItemCollapsibleState.None);
    item.label = path.posix.basename(file.path);
    const dir = path.posix.dirname(file.path);
    const count = s ? commentsOn(s.conversations, s.placements, file) : 0;
    item.description = [dir === '.' ? '' : dir, count ? `${count} ${count === 1 ? 'comment' : 'comments'}` : ''].filter(Boolean).join(' · ');
    item.tooltip = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    item.command = { command: 'margin.openDiff', title: 'Open Diff', arguments: [file.path] };
    item.contextValue = s && !s.readOnly ? 'margin-file-draft' : 'margin-file';
    return item;
  }

  dispose(): void {
    this.subscription.dispose();
    this.view.dispose();
    this.emitter.dispose();
  }
}

export const VERDICTS = { approve: 'Approve', changes: 'Request changes', comment: 'Comment' } as const;

function commentsOn(conversations: readonly Conversation[], placements: ReadonlyMap<string, Placement>, file: ChangedFile): number {
  let n = 0;
  for (const c of conversations) {
    const p = placements.get(c.root.id);
    if (p && p.kind !== 'outdated' && fileOnSide([file], p.side, p.path)) n++;
  }
  return n;
}

function outdated(
  conversations: readonly Conversation[],
  placements: ReadonlyMap<string, Placement>,
  orphans: readonly CommentRecord[],
): Extract<Node, { kind: 'note' }>[] {
  const notes: Extract<Node, { kind: 'note' }>[] = [];
  for (const c of conversations) {
    const p = placements.get(c.root.id);
    if (p?.kind === 'outdated') notes.push({ kind: 'note', root: c.root, replies: c.replies, reason: p.reason });
  }
  for (const o of orphans) notes.push({ kind: 'note', root: o, replies: [], reason: 'A reply to a comment that was deleted.' });
  return notes;
}

/** A conversation as markdown: where it was, the code it was on, then every comment. */
export function noteMarkdown(root: CommentRecord, replies: readonly CommentRecord[], reason: string): string {
  const m = root.meta;
  const lines: string[] = [];
  if (m.path) {
    const at = m.line ? (m.endLine && m.endLine !== m.line ? `lines ${m.line}–${m.endLine}` : `line ${m.line}`) : 'the whole file';
    lines.push(`**${m.path}**, ${at}${m.side === 'old' ? ' (base side)' : ''}${m.commit ? ` at \`${short(m.commit)}\`` : ''}`, '');
  }
  lines.push(`_${reason}_`, '');
  if (m.code) {
    const fence = '`'.repeat(Math.max(3, ...[...m.code.matchAll(/`+/g)].map((x) => x[0].length + 1)));
    const lang = m.path ? path.posix.extname(m.path).slice(1) : '';
    lines.push(fence + lang, m.code.replace(/\n$/, ''), fence, '');
  }
  for (const c of [root, ...replies]) {
    lines.push(`**${c.meta.author || 'Someone'}**${c.meta.createdAt ? `, ${c.meta.createdAt.slice(0, 16).replace('T', ' ')}` : ''}${c === root && m.resolved ? ' · resolved' : ''}`, '', c.body || '_(empty)_', '');
  }
  return lines.join('\n');
}
