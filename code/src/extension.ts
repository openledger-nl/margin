// margin-code: review any local git repository in VS Code, and keep the review in the Ledger vault as markdown.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Git } from './git';
import { fileOnSide } from './placement';
import { Controller } from './ui/controller';
import { CommentsUi } from './ui/comments';
import { registerDocuments } from './ui/documents';
import { moveToHead, resumeReview, startReview } from './ui/flows';
import { SummaryEditor, submitReview } from './ui/submit';
import { noteMarkdown, ReviewTree } from './ui/tree';
import { noteUri, short, sideUri } from './ui/uris';
import { chooseVault, errorText } from './ui/workspace';

function makeGit(): Git {
  const configured = vscode.workspace.getConfiguration('git').get<unknown>('path');
  return new Git(typeof configured === 'string' && configured.trim() !== '' ? configured : 'git');
}

export function activate(context: vscode.ExtensionContext): void {
  let git = makeGit();
  const getGit = () => git;
  const documents = registerDocuments(getGit);
  const margin = new Controller(context, getGit);
  const tree = new ReviewTree(margin);
  const comments = new CommentsUi(margin, documents.content);
  const summaries = new SummaryEditor(context);

  const command = (id: string, run: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        await run(...args);
      } catch (error) {
        void vscode.window.showErrorMessage(`Margin: ${errorText(error)}`);
      }
    });

  context.subscriptions.push(
    ...documents.disposables,
    margin,
    tree,
    comments,
    summaries,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('git.path')) git = makeGit();
    }),

    command('margin.startReview', () => startReview(margin)),
    command('margin.resumeReview', () => resumeReview(margin)),
    command('margin.submitReview', () => submitReview(margin, summaries)),
    command('margin.moveToHead', () => moveToHead(margin)),
    command('margin.closeReview', () => margin.close()),
    command('margin.refresh', () => margin.reload()),
    command('margin.chooseVault', async () => {
      const vault = await chooseVault();
      if (vault) void vscode.window.showInformationMessage(`Margin uses the Ledger vault at ${vault.root}.`);
    }),

    command('margin.openDiff', async (file: string) => {
      const s = margin.session;
      const changed = s?.files.find((f) => f.path === file);
      if (!s || !changed) return;
      const name = path.posix.basename(changed.path);
      const left = sideUri({ root: s.root, sha: s.review.base, side: 'old', path: changed.oldPath ?? changed.path });
      const right = sideUri({ root: s.root, sha: s.review.head, side: 'new', path: changed.path });
      const what =
        changed.status === 'A' ? 'added' : changed.status === 'D' ? 'deleted' : changed.oldPath ? `from ${changed.oldPath}` : `${short(s.review.base)} ↔ ${short(s.review.head)}`;
      await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${what})`, { preview: true });
    }),

    command('margin.commentOnFile', async (node?: { kind: string; file?: { path: string } }) => {
      const s = margin.session;
      const file = node?.file && s?.files.find((f) => f.path === node.file?.path);
      if (!s || !file || s.readOnly) return;
      await vscode.commands.executeCommand('margin.openDiff', file.path);
      const side = file.status === 'D' ? 'old' : 'new';
      const target = side === 'old' ? (file.oldPath ?? file.path) : file.path;
      if (!fileOnSide(s.files, side, target)) return;
      const uri = sideUri({ root: s.root, sha: side === 'old' ? s.review.base : s.review.head, side, path: target });
      comments.newFileThread(uri);
    }),

    command('margin.openOutdated', async (rootId: string) => {
      const s = margin.session;
      if (!s) return;
      const conversation = s.conversations.find((c) => c.root.id === rootId);
      const orphan = s.orphans.find((o) => o.id === rootId);
      const placement = s.placements.get(rootId);
      const root = conversation?.root ?? orphan;
      if (!root) return;
      const reason = placement?.kind === 'outdated' ? placement.reason : 'A reply to a comment that was deleted.';
      const uri = noteUri(rootId);
      documents.notes.set(uri, noteMarkdown(root, conversation?.replies ?? [], reason));
      try {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } catch {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
      }
    }),
  );

  void margin.restore();
}

export function deactivate(): void {}
