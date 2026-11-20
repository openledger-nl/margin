// Where a comment's lines are now. A comment records the lines it was made on (`code`, with up to three lines of
// context either side) and the commit those line numbers belong to. When a diff shows another commit, the lines
// are looked for again, starting from where git's own diff says the old line went.

/** Lines the way VS Code counts them: \r\n, \n and \r all end a line. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Text of whole lines, each ending in "\n" (as a YAML `|` block holds them). */
function joinLines(lines: readonly string[]): string {
  return lines.map((l) => l + '\n').join('');
}

/** The lines of a text block back as a list. */
export function linesOf(block: string | undefined): string[] {
  if (block === undefined || block === '') return [];
  const lines = splitLines(block);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export interface Excerpt {
  code: string;
  codeBefore?: string;
  codeAfter?: string;
}

/**
 * What to store for a comment on lines `line`..`endLine` (1-based, inclusive) of a file: those lines, and up to
 * three before and after. The empty "line" after a file's final newline is not context.
 */
export function excerpt(lines: readonly string[], line: number, endLine: number): Excerpt {
  const usable = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  const code = joinLines(lines.slice(line - 1, endLine));
  const before = lines.slice(Math.max(0, line - 4), line - 1);
  const after = lines.slice(endLine, Math.min(usable, endLine + 3));
  return {
    code,
    codeBefore: before.length > 0 ? joinLines(before) : undefined,
    codeAfter: after.length > 0 ? joinLines(after) : undefined,
  };
}

// ---- git's diff -------------------------------------------------------------------------------------

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/** The hunk headers of `git diff -U0` output. */
export function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({
      oldStart: Number(m[1]),
      oldCount: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newCount: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return hunks.sort((a, b) => a.oldStart - b.oldStart);
}

/** Where line `line` of the old file is in the new one; a changed line maps to the start of what replaced it. */
export function mapLine(hunks: readonly Hunk[], line: number): number {
  let offset = 0;
  for (const h of hunks) {
    if (h.oldCount === 0) {
      // Lines inserted after old line oldStart.
      if (line > h.oldStart) offset += h.newCount;
      else break;
      continue;
    }
    const end = h.oldStart + h.oldCount - 1;
    if (line < h.oldStart) break;
    if (line <= end) {
      if (h.newCount === 0) return Math.max(1, h.newStart); // removed: just after the line before it
      return h.newStart + Math.min(line - h.oldStart, h.newCount - 1);
    }
    offset += h.newCount - h.oldCount;
  }
  return Math.max(1, line + offset);
}

// ---- finding the lines again ------------------------------------------------------------------------

export interface Anchor {
  code: string;
  codeBefore?: string;
  codeAfter?: string;
}

export interface Place {
  line: number;
  endLine: number;
}

const exact = (l: string) => l.replace(/\s+$/, '');
const loose = (l: string) => l.trim().replace(/\s+/g, ' ');

/**
 * Where the anchor's code is in `lines`, nearest to `expected` (1-based) among the places whose surrounding lines
 * match best. First an exact match (trailing whitespace aside), else one that ignores indentation and spacing.
 * Code too short to tell places apart (a lone "}") needs a matching line of context, or to be right where expected.
 */
export function relocate(anchor: Anchor, lines: readonly string[], expected: number): Place | undefined {
  const code = linesOf(anchor.code);
  if (code.length === 0) return undefined;
  const before = linesOf(anchor.codeBefore);
  const after = linesOf(anchor.codeAfter);
  const weak = code.join('').replace(/\s/g, '').length < 4;

  for (const norm of [exact, loose]) {
    const want = code.map(norm);
    const candidates: { at: number; context: number; distance: number }[] = [];
    for (let i = 0; i + want.length <= lines.length; i++) {
      if (!want.every((w, k) => norm(lines[i + k] ?? '') === w)) continue;
      let context = 0;
      before.forEach((b, k) => {
        const j = i - before.length + k;
        if (j >= 0 && loose(lines[j] ?? '') === loose(b)) context++;
      });
      after.forEach((a, k) => {
        const j = i + want.length + k;
        if (j < lines.length && loose(lines[j] ?? '') === loose(a)) context++;
      });
      const distance = Math.abs(i + 1 - expected);
      if (weak && context === 0 && distance !== 0) continue;
      candidates.push({ at: i, context, distance });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.context - a.context || a.distance - b.distance || a.at - b.at);
    const best = candidates[0];
    if (best) return { line: best.at + 1, endLine: best.at + want.length };
  }
  return undefined;
}
