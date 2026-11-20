// Virtual documents: one side of a reviewed file, served from git (`margin:`), a row in the view (`margin-file:`,
// for its status badge), and an outdated conversation to read (`margin-note:`).
import * as vscode from 'vscode';
import type { Side } from '../format';

export const SIDE_SCHEME = 'margin';
export const FILE_SCHEME = 'margin-file';
export const NOTE_SCHEME = 'margin-note';

export interface SideRef {
  /** The repository's root folder. */
  root: string;
  sha: string;
  side: Side;
  /** Repo-relative, forward slashes. */
  path: string;
}

export function sideUri(ref: SideRef): vscode.Uri {
  return vscode.Uri.from({
    scheme: SIDE_SCHEME,
    path: '/' + ref.path,
    query: new URLSearchParams({ root: ref.root, sha: ref.sha, side: ref.side }).toString(),
  });
}

export function parseSideUri(uri: vscode.Uri): SideRef | undefined {
  if (uri.scheme !== SIDE_SCHEME) return undefined;
  const q = new URLSearchParams(uri.query);
  const root = q.get('root');
  const sha = q.get('sha');
  const side = q.get('side');
  if (!root || !sha || (side !== 'new' && side !== 'old')) return undefined;
  return { root, sha, side, path: uri.path.replace(/^\//, '') };
}

export function fileUri(path: string, status: string): vscode.Uri {
  return vscode.Uri.from({ scheme: FILE_SCHEME, path: '/' + path, query: new URLSearchParams({ status }).toString() });
}

export function noteUri(commentId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: NOTE_SCHEME, path: `/${commentId}.md` });
}

export const short = (sha: string): string => sha.slice(0, 7);
