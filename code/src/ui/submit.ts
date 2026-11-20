// Margin: Submit review. A verdict, then a summary written in an editor (markdown, optional), then the review is
// final: state submitted, verdict and submittedAt in its file, read-only from then on.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { Verdict } from '../format';
import { publishersFor } from '../publisher';
import type { ReviewSession } from '../session';
import type { Controller } from './controller';
import { VERDICTS } from './tree';
import { errorText, pick } from './workspace';

type Outcome = 'submit' | 'draft' | 'cancel';

export class SummaryEditor implements vscode.Disposable {
  private pending: { uri: vscode.Uri; resolve: (outcome: Outcome) => void } | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables = [
      vscode.commands.registerCommand('margin.summary.submit', () => this.finish('submit')),
      vscode.commands.registerCommand('margin.summary.keepDraft', () => this.finish('draft')),
      // Closing the summary's editor cancels.
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (this.pending && !this.tabsOf(this.pending.uri).length) this.finish('cancel');
      }),
    ];
  }

  private tabsOf(uri: vscode.Uri): vscode.Tab[] {
    return vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString());
  }

  private finish(outcome: Outcome): void {
    const pending = this.pending;
    this.pending = undefined;
    void vscode.commands.executeCommand('setContext', 'margin.writingSummary', false);
    pending?.resolve(outcome);
  }

  /** Lets the user write the summary; resolves with what they chose and the text. */
  async write(session: ReviewSession, verdict: Verdict): Promise<{ outcome: Outcome; text: string }> {
    this.finish('cancel');
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'summaries');
    await mkdir(dir.fsPath, { recursive: true });
    const uri = vscode.Uri.joinPath(dir, `summary-${session.record.id}.md`);
    // An earlier unfinished summary for this review wins over the one in the draft.
    const earlier = await readFile(uri.fsPath, 'utf8').catch(() => '');
    if (earlier.trim() === '') await writeFile(uri.fsPath, session.record.summary ? session.record.summary + '\n' : '');

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('setContext', 'margin.writingSummary', true);

    const outcome = new Promise<Outcome>((resolve) => (this.pending = { uri, resolve }));
    void vscode.window
      .showInformationMessage(
        `Write the summary of your review (${VERDICTS[verdict]}) in the editor, then submit. Markdown; it may stay empty.`,
        'Submit Review',
        'Keep as Draft',
      )
      .then((answer) => {
        if (answer === 'Submit Review') this.finish('submit');
        else if (answer === 'Keep as Draft') this.finish('draft');
      });

    const result = await outcome;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    const text = (open ? open.getText() : await readFile(uri.fsPath, 'utf8').catch(() => '')).trim();
    if (result === 'cancel') return { outcome: result, text };
    if (open?.isDirty) await open.save();
    const tabs = this.tabsOf(uri);
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    await rm(uri.fsPath, { force: true });
    return { outcome: result, text };
  }

  dispose(): void {
    this.finish('cancel');
    for (const d of this.disposables) d.dispose();
  }
}

export async function submitReview(margin: Controller, summaries: SummaryEditor): Promise<void> {
  const session = margin.session;
  if (!session) {
    void vscode.window.showInformationMessage('There is no active review to submit.');
    return;
  }
  if (session.readOnly) {
    void vscode.window.showInformationMessage('This review is already submitted.');
    return;
  }
  const items: (vscode.QuickPickItem & { verdict: Verdict })[] = [
    { label: '$(check) Approve', detail: 'The changes can go in.', verdict: 'approve' },
    { label: '$(request-changes) Request changes', detail: 'Something must change first.', verdict: 'changes' },
    { label: '$(comment) Comment', detail: 'Feedback, without a verdict either way.', verdict: 'comment' },
  ];
  const open = session.conversations.filter((c) => !c.root.meta.resolved).length;
  const verdict = (
    await pick(items, {
      title: `Submit review of ${session.review.repoName}: ${session.review.headRef ?? session.review.head.slice(0, 7)}`,
      placeholder: `${session.conversations.length} conversations, ${open} open. Your verdict?`,
    })
  )?.verdict;
  if (!verdict) return;

  try {
    const { outcome, text } = await summaries.write(session, verdict);
    if (outcome === 'cancel') return;
    if (margin.session !== session) throw new Error('The review was closed meanwhile; nothing was submitted.');
    if (outcome === 'draft') {
      await session.saveSummary(text);
      void vscode.window.showInformationMessage('The summary is kept in the draft review.');
      return;
    }
    await session.submit(verdict, text);
    void vscode.window.showInformationMessage(`Review submitted: ${VERDICTS[verdict]}. It is read-only now; the next round on this branch is a new review in the same thread.`);

    const submitted = { review: session.record, comments: session.comments, repoRoot: session.root };
    for (const publisher of await publishersFor(submitted)) {
      const answer = await vscode.window.showInformationMessage(`Also ${publisher.label.toLowerCase()}?`, publisher.label);
      if (answer === publisher.label) await publisher.publish(submitted);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Margin: ${errorText(error)}`);
  }
}
