// The committed fixture vault (test/fixtures/) must be exactly what margin-code writes now: Ledger's tests read
// it as margin-code's output. When a change to the writer is meant to change it, run `pnpm fixture`, commit the
// result, and tell the Ledger side.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureResult, generateFixture } from './fixture';
import { readComment, readReview } from './format';
import { Frontmatter } from './frontmatter';

const COMMITTED = fileURLToPath(new URL('../test/fixtures', import.meta.url));

/** Every file of the fixture (vault/ and CONTENTS.md) by its path with forward slashes. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (rel: string) => {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else files.set(child, await readFile(path.join(dir, child), 'utf8'));
    }
  };
  await walk('vault');
  files.set('CONTENTS.md', await readFile(path.join(dir, 'CONTENTS.md'), 'utf8'));
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)));
}

let out: string;
let result: FixtureResult;
let got: Map<string, string>;

beforeAll(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'margin-fixture-out-'));
  result = await generateFixture(out);
  got = await snapshot(out);
}, 120_000);

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('the fixture vault', () => {
  it('is what margin-code writes now (if that changed on purpose: pnpm fixture)', async () => {
    const want = await snapshot(COMMITTED);
    expect([...got.keys()], 'the files differ from test/fixtures/: run pnpm fixture if that is meant').toEqual([...want.keys()]);
    for (const [file, text] of got) expect(text, `test/fixtures/${file} differs from what margin-code writes now`).toBe(want.get(file));
  });

  it('comes out the same twice', async () => {
    const again = await mkdtemp(path.join(tmpdir(), 'margin-fixture-again-'));
    try {
      await generateFixture(again);
      expect(await snapshot(again)).toEqual(got);
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  }, 120_000);

  it('has what the Ledger side tests against', () => {
    const parsed = [...got].filter(([f]) => f.startsWith('vault/projects/')).map(([file, text]) => ({ file, text, fm: Frontmatter.parse(text)! }));
    const reviews = parsed.filter((p) => /\/reviews\/[^/]+\.md$/.test(p.file)).map((p) => ({ ...p, meta: readReview(p.fm) }));
    const comments = parsed.filter((p) => /\/reviews\/[^/]+\/[^/]+\.md$/.test(p.file)).map((p) => ({ ...p, meta: readComment(p.fm), id: path.posix.basename(p.file, '.md') }));
    const headOf = (commentFile: string) => reviews.find((r) => commentFile.startsWith(r.file.replace(/\.md$/, '/')))?.meta.head;

    expect(parsed.filter((p) => p.file.endsWith('/project.md'))).toHaveLength(1);
    expect(parsed.filter((p) => p.file.endsWith('/thread.md'))).toHaveLength(1);
    expect(reviews.map((r) => r.meta.state).sort()).toEqual(['draft', 'submitted']);
    const submitted = reviews.find((r) => r.meta.state === 'submitted')!;
    expect(submitted.meta.verdict).toBe('changes');
    expect(submitted.fm.body).not.toBe('');
    expect(reviews.find((r) => r.meta.state === 'draft')!.fm.body).toBe('');

    const first = comments.filter((c) => c.meta.replyTo === undefined);
    expect(first.some((c) => c.meta.side === 'new' && c.meta.line !== undefined && c.meta.line === c.meta.endLine)).toBe(true);
    expect(first.some((c) => c.meta.side === 'old' && c.meta.commit === result.commits.base)).toBe(true);
    expect(first.some((c) => c.meta.line !== undefined && c.meta.endLine! > c.meta.line)).toBe(true);
    expect(first.some((c) => c.meta.path !== undefined && c.meta.line === undefined && c.meta.code === undefined)).toBe(true);
    expect(first.some((c) => c.meta.codeBefore !== undefined && c.meta.codeAfter !== undefined)).toBe(true);
    expect(first.some((c) => c.meta.resolved === true)).toBe(true);
    const replies = comments.filter((c) => c.meta.replyTo !== undefined);
    expect(replies.some((r) => first.some((c) => c.id === r.meta.replyTo))).toBe(true);
    expect(replies.some((r) => replies.some((c) => c.id === r.meta.replyTo))).toBe(true);
    expect(comments.some((c) => c.fm.has('reviewTool') && c.text.includes('# added by another tool'))).toBe(true);
    expect(first.some((c) => c.meta.format === 1 && c.meta.commit !== undefined && c.meta.commit !== headOf(c.file))).toBe(true);
    expect(comments.filter((c) => c.meta.format === 2)).toHaveLength(1);

    // The comment made before Move Review to HEAD is found two lines further down.
    expect(result.moved).toMatchObject({ kind: 'line', line: 8, endLine: 8, moved: { line: 6, commit: result.commits.h2 } });
  });
});
