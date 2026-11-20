import { describe, expect, it } from 'vitest';
import { excerpt, linesOf, mapLine, parseHunks, relocate, splitLines } from './anchor';
import { oldestRoot, parseNameStatus } from './git';
import { identityFromUrl, pickRemote, repoNameOf } from './repoIdentity';

describe('repo identity', () => {
  it.each([
    ['git@github.com:openledger-nl/margin.git', 'github.com/openledger-nl/margin'],
    ['https://github.com/openledger-nl/margin', 'github.com/openledger-nl/margin'],
    ['https://github.com/openledger-nl/margin.git/', 'github.com/openledger-nl/margin'],
    ['https://user:token@GitHub.com:443/openledger-nl/Margin.git', 'github.com/openledger-nl/Margin'],
    ['ssh://git@gitlab.example.com:2222/group/sub/repo.git', 'gitlab.example.com/group/sub/repo'],
    ['git+ssh://git@github.com/o/r.git', 'github.com/o/r'],
    ['git://Example.org/r', 'example.org/r'],
    ['github.com:o/r', 'github.com/o/r'],
    ['ssh://[::1]:22/o/r', '[::1]/o/r'],
  ])('%s', (url, id) => {
    expect(identityFromUrl(url)).toBe(id);
  });

  it('has no host for local remotes', () => {
    expect(identityFromUrl('/srv/git/repo.git')).toBeUndefined();
    expect(identityFromUrl('C:\\repos\\x')).toBeUndefined();
    expect(identityFromUrl('C:/repos/x')).toBeUndefined();
    expect(identityFromUrl('file:///srv/repo')).toBeUndefined();
    expect(identityFromUrl('../other')).toBeUndefined();
  });

  it('takes origin, else the first remote by name', () => {
    expect(pickRemote([{ name: 'upstream' }, { name: 'origin' }])?.name).toBe('origin');
    expect(pickRemote([{ name: 'upstream' }, { name: 'fork' }])?.name).toBe('fork');
    expect(pickRemote([])).toBeUndefined();
  });

  it('names a repo after its path, or its folder without a remote', () => {
    expect(repoNameOf('github.com/openledger-nl/margin', 'x')).toBe('margin');
    expect(repoNameOf('git:abc', 'folder')).toBe('folder');
  });
});

describe('git output', () => {
  it('parses name-status -z, renames included', () => {
    expect(parseNameStatus('M\0a.ts\0R087\0old name.ts\0new name.ts\0A\0b\0D\0c\0C100\0x\0y\0')).toEqual([
      { status: 'M', path: 'a.ts' },
      { status: 'R', path: 'new name.ts', oldPath: 'old name.ts' },
      { status: 'A', path: 'b' },
      { status: 'D', path: 'c' },
      { status: 'C', path: 'y', oldPath: 'x' },
    ]);
    expect(parseNameStatus('')).toEqual([]);
  });

  it('picks the oldest root commit', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const c = 'c'.repeat(40);
    expect(oldestRoot(`200 ${a}\n100 ${c}\n100 ${b}\n`)).toBe(b);
    expect(oldestRoot('')).toBeUndefined();
  });
});

describe('excerpt', () => {
  const lines = splitLines('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n');

  it('takes the lines and up to three either side', () => {
    expect(excerpt(lines, 4, 5)).toEqual({ code: 'l4\nl5\n', codeBefore: 'l1\nl2\nl3\n', codeAfter: 'l6\nl7\nl8\n' });
    expect(excerpt(lines, 1, 1)).toEqual({ code: 'l1\n', codeBefore: undefined, codeAfter: 'l2\nl3\nl4\n' });
    expect(excerpt(lines, 8, 8)).toEqual({ code: 'l8\n', codeBefore: 'l5\nl6\nl7\n', codeAfter: undefined });
  });

  it('reads back as lines', () => {
    expect(linesOf('a\nb\n')).toEqual(['a', 'b']);
    expect(linesOf('a\r\nb')).toEqual(['a', 'b']);
    expect(linesOf(undefined)).toEqual([]);
  });
});

describe('mapLine', () => {
  const diff = [
    'diff --git a/f b/f',
    '@@ -3,0 +4,2 @@ ctx', // two lines inserted after old line 3
    '@@ -10,2 +13 @@', // old 10-11 replaced by new 13
    '@@ -20 +22,0 @@', // old 20 removed
  ].join('\n');
  const hunks = parseHunks(diff);

  it('parses hunk headers', () => {
    expect(hunks).toEqual([
      { oldStart: 3, oldCount: 0, newStart: 4, newCount: 2 },
      { oldStart: 10, oldCount: 2, newStart: 13, newCount: 1 },
      { oldStart: 20, oldCount: 1, newStart: 22, newCount: 0 },
    ]);
  });

  it('follows insertions, replacements and removals', () => {
    expect(mapLine(hunks, 1)).toBe(1);
    expect(mapLine(hunks, 3)).toBe(3);
    expect(mapLine(hunks, 4)).toBe(6);
    expect(mapLine(hunks, 10)).toBe(13);
    expect(mapLine(hunks, 11)).toBe(13);
    expect(mapLine(hunks, 12)).toBe(13);
    expect(mapLine(hunks, 20)).toBe(22);
    expect(mapLine(hunks, 25)).toBe(25);
    expect(mapLine([], 7)).toBe(7);
  });
});

describe('relocate', () => {
  const file = splitLines(
    [
      'import x from "x";', // 1
      '', // 2
      'function a() {', // 3
      '  return null;', // 4
      '}', // 5
      '', // 6
      'function b() {', // 7
      '  const v = compute();', // 8
      '  return null;', // 9
      '}', // 10
    ].join('\n'),
  );

  it('finds moved code', () => {
    expect(relocate({ code: '  const v = compute();\n' }, file, 2)).toEqual({ line: 8, endLine: 8 });
  });

  it('prefers matching context over distance', () => {
    expect(relocate({ code: '  return null;\n', codeBefore: '  const v = compute();\n' }, file, 4)).toEqual({ line: 9, endLine: 9 });
  });

  it('takes the nearest when context does not decide', () => {
    expect(relocate({ code: '  return null;\n' }, file, 8)).toEqual({ line: 9, endLine: 9 });
    expect(relocate({ code: '  return null;\n' }, file, 3)).toEqual({ line: 4, endLine: 4 });
  });

  it('matches multi-line code, ignoring indentation when it must', () => {
    expect(relocate({ code: 'function b() {\nconst v = compute();\n' }, file, 1)).toEqual({ line: 7, endLine: 8 });
  });

  it('needs context or the exact spot for code too short to tell apart', () => {
    expect(relocate({ code: '}\n' }, file, 7)).toBeUndefined();
    expect(relocate({ code: '}\n' }, file, 10)).toEqual({ line: 10, endLine: 10 });
    expect(relocate({ code: '}\n', codeBefore: '  const v = compute();\n  return null;\n' }, file, 1)).toEqual({ line: 10, endLine: 10 });
  });

  it('gives up when the code is gone', () => {
    expect(relocate({ code: 'deleted();\n' }, file, 4)).toBeUndefined();
    expect(relocate({ code: '' }, file, 4)).toBeUndefined();
  });
});
