// The read-only documents behind the diffs (`git show <sha>:<path>`), the status badges in the view, and
// outdated conversations rendered as markdown.
import * as vscode from 'vscode';
import type { Git } from '../git';
import { isBinary } from '../session';
import { FILE_SCHEME, NOTE_SCHEME, parseSideUri } from './uris';

export const BINARY_PLACEHOLDER = '(binary file: not shown)';

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  /** Documents that hold a placeholder instead of the file: no line comments there. */
  readonly binary = new Set<string>();

  constructor(private readonly git: () => Git) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = parseSideUri(uri);
    if (!ref) return '';
    const bytes = await this.git().show(ref.root, ref.sha, ref.path);
    if (!bytes) return '';
    if (isBinary(bytes)) {
      this.binary.add(uri.toString());
      return BINARY_PLACEHOLDER;
    }
    return bytes.toString('utf8');
  }
}

const COLORS: Record<string, string> = {
  A: 'gitDecoration.addedResourceForeground',
  D: 'gitDecoration.deletedResourceForeground',
  R: 'gitDecoration.renamedResourceForeground',
  C: 'gitDecoration.renamedResourceForeground',
};

const NAMES: Record<string, string> = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed' };

export class StatusDecorations implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== FILE_SCHEME) return undefined;
    const status = new URLSearchParams(uri.query).get('status') ?? '';
    if (!status) return undefined;
    return new vscode.FileDecoration(status, NAMES[status] ?? status, new vscode.ThemeColor(COLORS[status] ?? 'gitDecoration.modifiedResourceForeground'));
  }
}

/** Markdown for conversations that can't be shown in the code, set before they are opened. */
export class NoteProvider implements vscode.TextDocumentContentProvider {
  private readonly notes = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uri: vscode.Uri, text: string): void {
    this.notes.set(uri.toString(), text);
    this.emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.notes.get(uri.toString()) ?? '_This comment is no longer in the active review._';
  }
}

export function registerDocuments(git: () => Git): { content: GitContentProvider; notes: NoteProvider; disposables: vscode.Disposable[] } {
  const content = new GitContentProvider(git);
  const notes = new NoteProvider();
  return {
    content,
    notes,
    disposables: [
      vscode.workspace.registerTextDocumentContentProvider('margin', content),
      vscode.workspace.registerTextDocumentContentProvider(NOTE_SCHEME, notes),
      vscode.window.registerFileDecorationProvider(new StatusDecorations()),
    ],
  };
}
