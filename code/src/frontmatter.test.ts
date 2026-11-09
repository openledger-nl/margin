import { describe, expect, it } from 'vitest';
import { COMMENT_KEYS, commentFile, readComment, readReview, REVIEW_KEYS, reviewFile, type ReviewMeta } from './format';
import { Frontmatter } from './frontmatter';

const SHA_A = 'a'.repeat(40);
const SHA_B = '0123456789abcdef0123456789abcdef01234567';

const review: ReviewMeta = {
  format: 1,
  repo: 'github.com/openledger-nl/margin',
  repoName: 'margin',
  base: SHA_A,
  baseRef: 'main',
  head: SHA_B,
  headRef: 'feat/code',
  state: 'draft',
  author: 'Milan Molenbrugge',
  createdAt: '2026-11-09T10:15:00.123Z',
  updatedAt: '2026-11-09T10:15:00.123Z',
};

describe('Frontmatter', () => {
  it('reads the way Ledger does: BOM, CRLF, one blank line, trailing whitespace', () => {
    const fm = Frontmatter.parse('﻿---\r\ntitle: Hi\r\ncount: 3\r\n---\r\n\r\nBody text\r\n\r\n');
    expect(fm?.text('title')).toBe('Hi');
    expect(fm?.text('count')).toBe('3');
    expect(fm?.int('count')).toBe(3);
    expect(fm?.body).toBe('Body text');
  });

  it('rejects files without a frontmatter block or with one that is not a mapping', () => {
    expect(Frontmatter.parse('no frontmatter')).toBeUndefined();
    expect(Frontmatter.parse('---\ntitle: x\n')).toBeUndefined();
    expect(Frontmatter.parse('---\n- a\n- b\n---\n')).toBeUndefined();
    expect(Frontmatter.parse('---\n---\nbody')?.body).toBe('body');
  });

  it('writes canonically: frontmatter, one blank line, body, final newline', () => {
    expect(Frontmatter.create({ title: 'A thread', createdAt: '2026-11-09T10:15:00.123Z' }).toString()).toBe(
      '---\ntitle: A thread\ncreatedAt: 2026-11-09T10:15:00.123Z\n---\n',
    );
    expect(Frontmatter.create({ a: 1 }, '\n\nHello\n\n').toString()).toBe('---\na: 1\n---\n\nHello\n');
    expect(Frontmatter.create({ a: 1 }, '    indented code\n').toString()).toBe('---\na: 1\n---\n\n    indented code\n');
  });

  it('keeps unknown keys, their order and comments when changing known ones', () => {
    const text = '---\nformat: 1\n# Ledger was here\nlabel: keep me   # and this\nstate: draft\nextra:\n  nested: [1, 2]\n---\n\nSummary\n';
    const fm = Frontmatter.parse(text)!;
    fm.set('state', 'submitted', REVIEW_KEYS);
    fm.set('verdict', 'approve', REVIEW_KEYS);
    const out = fm.toString();
    expect(out).toContain('# Ledger was here\nlabel: keep me # and this\nstate: submitted\nverdict: approve\nextra:\n  nested: [ 1, 2 ]\n');
    expect(Frontmatter.parse(out)?.get('extra')).toBeDefined();
  });

  it('inserts new keys in spec order', () => {
    const fm = reviewFile(review, '');
    fm.set('submittedAt', '2026-11-09T11:00:00.000Z', REVIEW_KEYS);
    fm.set('verdict', 'changes', REVIEW_KEYS);
    expect(fm.keys()).toEqual([
      'format', 'repo', 'repoName', 'base', 'baseRef', 'head', 'headRef', 'state', 'verdict', 'author', 'createdAt', 'updatedAt', 'submittedAt',
    ]);
  });

  it('round-trips code blocks, including ones a YAML block scalar cannot hold', () => {
    const samples = [
      'function a() {\n  return 1;\n}\n',
      '    leading indent\n  less\n',
      'trailing spaces   \n\tTabbed\n',
      'line\n   \nonly spaces above\n',
      '\n\nstarts blank\n',
      'no final newline',
      'quote: "x" # not a comment\n- not a list\n',
      'crlf\r\nline\r\n',
    ];
    for (const code of samples) {
      const fm = commentFile(
        { format: 1, path: 'a.ts', side: 'new', line: 1, endLine: 1, commit: SHA_A, code, author: 'x', createdAt: 'c', updatedAt: 'u' },
        'Body',
      );
      const back = Frontmatter.parse(fm.toString())!;
      expect(back.get('code')).toBe(code);
    }
  });

  it('writes a multi-line code block as a literal block', () => {
    const fm = commentFile(
      { format: 1, path: 'a.ts', side: 'new', line: 2, endLine: 3, commit: SHA_A, code: 'one\ntwo\n', author: 'x', createdAt: 'c', updatedAt: 'u' },
      'Hi',
    );
    expect(fm.toString()).toContain('code: |\n  one\n  two\n');
  });
});

describe('review and comment files', () => {
  it('round-trip a review in spec key order', () => {
    const text = reviewFile(review, 'Looks good').toString();
    expect(text).toBe(
      [
        '---',
        'format: 1',
        'repo: github.com/openledger-nl/margin',
        'repoName: margin',
        `base: ${SHA_A}`,
        'baseRef: main',
        `head: ${SHA_B}`,
        'headRef: feat/code',
        'state: draft',
        'author: Milan Molenbrugge',
        'createdAt: 2026-11-09T10:15:00.123Z',
        'updatedAt: 2026-11-09T10:15:00.123Z',
        '---',
        '',
        'Looks good',
        '',
      ].join('\n'),
    );
    expect(readReview(Frontmatter.parse(text)!)).toEqual({ ...review, verdict: undefined, submittedAt: undefined });
  });

  it('quotes a sha that would otherwise read as a number', () => {
    const digits = '1234567890123456789012345678901234567890';
    const text = reviewFile({ ...review, head: digits }, '').toString();
    expect(readReview(Frontmatter.parse(text)!).head).toBe(digits);
  });

  it('reads a comment leniently and fills endLine from line', () => {
    const fm = Frontmatter.parse('---\nformat: 1\npath: a.ts\nside: old\nline: "7"\nresolved: "true"\n---\nHi')!;
    const c = readComment(fm);
    expect(c).toMatchObject({ path: 'a.ts', side: 'old', line: 7, endLine: 7, resolved: true });
  });

  it('treats a missing format as 1 and an unreadable one as too new', () => {
    expect(readReview(Frontmatter.parse('---\nrepo: x\n---\n')!).format).toBe(1);
    expect(readReview(Frontmatter.parse('---\nformat: two\n---\n')!).format).toBe(Number.POSITIVE_INFINITY);
    expect(readReview(Frontmatter.parse('---\nformat: 2\n---\n')!).format).toBe(2);
  });

  it('leaves optional comment keys out', () => {
    const fm = commentFile({ format: 1, replyTo: '1-abc', author: 'x', createdAt: 'c', updatedAt: 'u' }, 'Reply');
    expect(fm.keys()).toEqual(['format', 'replyTo', 'author', 'createdAt', 'updatedAt']);
    expect(COMMENT_KEYS).toContain('replyTo');
  });
});
