// The margin review format, version 1 (see README.md, "The contract"). Ledger reads these files; margin-code
// writes them. Unknown keys are kept as they are, and a file with a higher `format` is left untouched.
import { Frontmatter } from './frontmatter';

export const FORMAT = 1;

export type Side = 'new' | 'old';
export type ReviewState = 'draft' | 'submitted';
export type Verdict = 'approve' | 'changes' | 'comment';

export const REVIEW_KEYS = [
  'format', 'repo', 'repoName', 'base', 'baseRef', 'head', 'headRef', 'state', 'verdict',
  'author', 'createdAt', 'updatedAt', 'submittedAt',
] as const;

export const COMMENT_KEYS = [
  'format', 'path', 'side', 'line', 'endLine', 'commit', 'code', 'codeBefore', 'codeAfter',
  'replyTo', 'resolved', 'author', 'createdAt', 'updatedAt',
] as const;

export interface ReviewMeta {
  format: number;
  repo: string;
  repoName: string;
  base: string;
  baseRef?: string;
  head: string;
  headRef?: string;
  state: ReviewState;
  verdict?: Verdict;
  author: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export interface CommentMeta {
  format: number;
  /** Repo-relative, forward slashes, the file as it is on `side`. Absent on a reply. */
  path?: string;
  side?: Side;
  /** 1-based first line; absent (with endLine) for a comment on the whole file. */
  line?: number;
  endLine?: number;
  /** The commit the line numbers belong to. */
  commit?: string;
  /** The commented lines, verbatim. */
  code?: string;
  codeBefore?: string;
  codeAfter?: string;
  /** On a reply: the comment it answers. */
  replyTo?: string;
  /** On the first comment of a conversation. */
  resolved?: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/** The format a file says it has. A file without `format` is read as version 1. */
export function formatOf(fm: Frontmatter): number {
  if (!fm.has('format')) return FORMAT;
  return fm.int('format') ?? Number.POSITIVE_INFINITY; // something we can't read: hands off
}

export function isSupported(format: number): boolean {
  return format <= FORMAT;
}

function verdictOf(value: string | undefined): Verdict | undefined {
  return value === 'approve' || value === 'changes' || value === 'comment' ? value : undefined;
}

export function readReview(fm: Frontmatter): ReviewMeta {
  return {
    format: formatOf(fm),
    repo: fm.text('repo') ?? '',
    repoName: fm.text('repoName') ?? '',
    base: fm.text('base') ?? '',
    baseRef: fm.text('baseRef'),
    head: fm.text('head') ?? '',
    headRef: fm.text('headRef'),
    state: fm.text('state') === 'submitted' ? 'submitted' : 'draft',
    verdict: verdictOf(fm.text('verdict')),
    author: fm.text('author') ?? '',
    createdAt: fm.text('createdAt') ?? '',
    updatedAt: fm.text('updatedAt') ?? fm.text('createdAt') ?? '',
    submittedAt: fm.text('submittedAt'),
  };
}

export function readComment(fm: Frontmatter): CommentMeta {
  const side = fm.text('side');
  const line = fm.int('line');
  return {
    format: formatOf(fm),
    path: fm.text('path'),
    side: side === 'old' ? 'old' : side === 'new' ? 'new' : undefined,
    line,
    endLine: line === undefined ? undefined : Math.max(line, fm.int('endLine') ?? line),
    commit: fm.text('commit'),
    code: fm.text('code'),
    codeBefore: fm.text('codeBefore'),
    codeAfter: fm.text('codeAfter'),
    replyTo: fm.text('replyTo'),
    resolved: fm.flag('resolved'),
    author: fm.text('author') ?? '',
    createdAt: fm.text('createdAt') ?? '',
    updatedAt: fm.text('updatedAt') ?? fm.text('createdAt') ?? '',
  };
}

export function reviewFile(meta: ReviewMeta, summary: string): Frontmatter {
  const fm = Frontmatter.create({}, summary);
  for (const key of REVIEW_KEYS) fm.set(key, meta[key], REVIEW_KEYS);
  return fm;
}

export function commentFile(meta: CommentMeta, body: string): Frontmatter {
  const fm = Frontmatter.create({}, body);
  for (const key of COMMENT_KEYS) fm.set(key, meta[key], COMMENT_KEYS);
  return fm;
}

/** Changes some keys of a file and leaves every other key as it was. undefined removes a key. */
export function patch(fm: Frontmatter, changes: Record<string, unknown>, order: readonly string[]): void {
  for (const [key, value] of Object.entries(changes)) fm.set(key, value, order);
}
