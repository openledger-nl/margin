// Where a conversation shows in a review's diff. A comment made on the commit a diff side shows sits on its own
// lines. One made on another commit (the review moved on since) is looked for again; when its code can't be
// found it is "outdated": listed in the view, still readable, but not in the code.
import { type Hunk, mapLine, relocate } from './anchor';
import type { ReviewMeta, Side } from './format';
import type { ChangedFile } from './git';
import type { CommentRecord } from './vault';

export type Placement =
  | {
      kind: 'line';
      side: Side;
      path: string;
      line: number;
      endLine: number;
      /** Set when the comment was made on another commit: where it was. */
      moved?: { line: number; commit: string; path: string };
    }
  | { kind: 'file'; side: Side; path: string; moved?: { commit: string; path: string } }
  | { kind: 'outdated'; reason: string };

export interface PlacementSource {
  review: ReviewMeta;
  files: readonly ChangedFile[];
  /** A file's lines at a commit, or undefined when it isn't there. */
  content(sha: string, path: string): Promise<string[] | undefined>;
  hunks(from: string, to: string, fromPath: string, toPath: string): Promise<Hunk[]>;
  /** The path a file has at `to`, given its path at `from`; null when it was removed. */
  renamedTo(from: string, to: string, path: string): Promise<string | null>;
  hasCommit(sha: string): Promise<boolean>;
}

/** The changed file a diff side shows at `path`, if that side has it. */
export function fileOnSide(files: readonly ChangedFile[], side: Side, path: string): ChangedFile | undefined {
  return side === 'new'
    ? files.find((f) => f.status !== 'D' && f.path === path)
    : files.find((f) => f.status !== 'A' && (f.oldPath ?? f.path) === path);
}

export function shownCommit(review: ReviewMeta, side: Side): string {
  return side === 'new' ? review.head : review.base;
}

const short = (sha: string) => sha.slice(0, 7);

export async function place(root: CommentRecord, src: PlacementSource): Promise<Placement> {
  const { meta } = root;
  if (meta.path === undefined) return { kind: 'outdated', reason: 'It names no file.' };
  const side: Side = meta.side ?? 'new';
  const shown = shownCommit(src.review, side);
  const commit = meta.commit ?? shown;
  const moved = commit !== shown;

  let path: string = meta.path;
  if (moved && (await src.hasCommit(commit))) {
    const renamed = await src.renamedTo(commit, shown, meta.path);
    if (renamed === null) return { kind: 'outdated', reason: `${meta.path} was removed after ${short(commit)}.` };
    path = renamed;
  }
  if (!fileOnSide(src.files, side, path)) {
    return { kind: 'outdated', reason: `${path} is no longer among this review's changes${side === 'old' ? ' on the base side' : ''}.` };
  }

  if (meta.line === undefined) {
    return moved ? { kind: 'file', side, path, moved: { commit, path: meta.path } } : { kind: 'file', side, path };
  }
  const endLine = meta.endLine ?? meta.line;
  if (!moved) return { kind: 'line', side, path, line: meta.line, endLine };

  if (meta.code === undefined) return { kind: 'outdated', reason: 'It was made on another commit and has no code to look for.' };
  const lines = await src.content(shown, path);
  if (!lines) return { kind: 'outdated', reason: `${path} isn't in ${short(shown)}.` };
  const expected = (await src.hasCommit(commit)) ? mapLine(await src.hunks(commit, shown, meta.path, path), meta.line) : meta.line;
  const found = relocate({ code: meta.code, codeBefore: meta.codeBefore, codeAfter: meta.codeAfter }, lines, expected);
  if (!found) return { kind: 'outdated', reason: `The code it was on changed after ${short(commit)}.` };
  return { kind: 'line', side, path, ...found, moved: { line: meta.line, commit, path: meta.path } };
}
