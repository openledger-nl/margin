// The active review of this window: which one it is, keeping it in step with the vault (changes from another
// machine arrive through Ledger's sync), the status bar and the context keys menus depend on.
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Git } from '../git';
import { isInside, samePath } from '../paths';
import { MissingCommitError, ReviewSession } from '../session';
import { Vault } from '../vault';
import { short } from './uris';
import { errorText, quietVault } from './workspace';

const STATE_KEY = 'margin.activeReview';

interface Saved {
  file: string;
  root: string;
}

export class Controller implements vscode.Disposable {
  session: ReviewSession | undefined;

  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires when the active review changes, or anything in it. */
  readonly onDidChange = this.emitter.event;

  private readonly status = vscode.window.createStatusBarItem('margin.review', vscode.StatusBarAlignment.Left, 50);
  private sessionListener: { dispose(): void } | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private reloadTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly git: () => Git,
  ) {
    this.status.name = 'Margin review';
    this.status.command = 'margin.review.focus';
    this.update();
  }

  /** Makes this the window's review. */
  activate(session: ReviewSession): void {
    this.detach();
    this.session = session;
    this.sessionListener = session.onDidChange(() => this.update());
    this.watch(session.vault);
    void this.context.workspaceState.update(STATE_KEY, { file: session.file, root: session.root } satisfies Saved);
    this.update();
  }

  /** Stops showing the review here; its files stay in the vault. */
  close(): void {
    this.detach();
    void this.context.workspaceState.update(STATE_KEY, undefined);
    this.update();
  }

  /** Picks up the review that was open when the window last closed, without asking anything. */
  async restore(): Promise<void> {
    const saved = this.context.workspaceState.get<Saved>(STATE_KEY);
    if (!saved || this.session) return;
    if (!existsSync(saved.file) || !existsSync(saved.root)) {
      await this.context.workspaceState.update(STATE_KEY, undefined);
      return;
    }
    const located = await quietVault();
    const vault = located && isInside(saved.file, located.root) ? located : vaultOf(saved.file);
    if (!vault) return;
    try {
      this.activate(await ReviewSession.open(vault, this.git(), saved.file, saved.root));
    } catch {
      // A missing commit or an unreadable file: Resume review says why when the user asks for it.
    }
  }

  private detach(): void {
    this.sessionListener?.dispose();
    this.sessionListener = undefined;
    this.watcher?.dispose();
    this.watcher = undefined;
    clearTimeout(this.reloadTimer);
    this.session = undefined;
  }

  /** Watches the vault's review files, so comments written on another machine show up here as Ledger syncs them. */
  private watch(vault: Vault): void {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(vault.root), 'projects/*/threads/*/reviews/**');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onEvent = (uri: vscode.Uri) => {
      const session = this.session;
      if (!session || path.basename(uri.fsPath).startsWith('.')) return; // temp files of atomic writes
      const file = uri.fsPath;
      const dir = vault.commentsDir(session.file);
      if (samePath(file, session.file) || samePath(file, dir) || isInside(file, dir)) this.scheduleReload();
    };
    this.watcher.onDidCreate(onEvent);
    this.watcher.onDidChange(onEvent);
    this.watcher.onDidDelete(onEvent);
  }

  scheduleReload(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.reload(), 300);
  }

  async reload(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      if ((await session.reload()) === 'gone') {
        this.close();
        void vscode.window.showWarningMessage('The review was removed from the Ledger vault, so Margin closed it.');
      }
    } catch (error) {
      const text = error instanceof MissingCommitError ? `${error.message} Fetch, then refresh the review.` : errorText(error);
      void vscode.window.showWarningMessage(`Margin couldn't reload the review: ${text}`);
    }
  }

  private update(): void {
    const s = this.session;
    void vscode.commands.executeCommand('setContext', 'margin.active', s !== undefined);
    void vscode.commands.executeCommand('setContext', 'margin.draft', s !== undefined && !s.readOnly);
    if (s) {
      const { review } = s;
      const count = s.conversations.length;
      this.status.text = `$(comment-discussion) ${review.repoName}: ${review.headRef ?? short(review.head)}${count ? ` (${count})` : ''}`;
      this.status.tooltip = `Margin: ${review.state === 'submitted' ? 'submitted' : 'draft'} review of ${review.repoName}, ${review.baseRef ?? short(review.base)} → ${review.headRef ?? short(review.head)}`;
      this.status.show();
    } else {
      this.status.hide();
    }
    this.emitter.fire();
  }

  dispose(): void {
    this.detach();
    this.status.dispose();
    this.emitter.dispose();
  }
}

/** The vault a review file is in: the folder above `projects/`. */
function vaultOf(file: string): Vault | undefined {
  const parts = path.resolve(file).split(path.sep);
  const at = parts.lastIndexOf('projects');
  return at > 0 && parts.length - at === 6 ? new Vault(parts.slice(0, at).join(path.sep)) : undefined;
}
