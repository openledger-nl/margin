// The fixture vault in test/fixtures/: a small vault made by margin-code's own code (the writer, slugs, ids,
// thread creation, a review session) against a throwaway git repository, with a fixed clock, a fixed id seed and
// fixed commit dates, so it comes out the same every time. Ledger tests that it reads these files;
// fixture.test.ts fails when margin-code would write them differently. `pnpm fixture` writes it again.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { writeFileAtomic } from './atomic';
import { Frontmatter } from './frontmatter';
import { Git } from './git';
import { fixedIds } from './ids';
import type { Placement } from './placement';
import { repoNameOf } from './repoIdentity';
import { ReviewSession } from './session';
import { Vault } from './vault';

/** The fixture's clock: 2026-11-09 09:00 UTC, moving a minute and a bit per write. */
export const FIXTURE_START = Date.UTC(2026, 10, 9, 9, 0, 0, 0);
const STEP = 61_337;
const REVIEWER = 'Fixture Reviewer';
const BRANCH = 'feat/review-me';

export interface FixtureResult {
  /** Each file of the vault (vault-relative) and what it shows. */
  files: { file: string; what: string }[];
  commits: Record<'base' | 'h1' | 'h2' | 'h3', string>;
  /** Where the comment made on h2 shows after the draft moved to h3. */
  moved: Placement | undefined;
}

const files = {
  base: {
    'README.md': '# margin fixture\n',
    'src/total.js': ['// Sums a list of numbers.', 'export function total(xs) {', '  let sum = 0;', '  for (const x of xs) sum += x;', '  return sum;', '}', ''].join('\n'),
    'src/legacy.js': ['// Kept for old callers.', 'export function legacyTotal(xs) {', '  return xs.reduce((a, b) => a + b, 0);', '}', ''].join('\n'),
  },
  h1: {
    'src/total.js': [
      '// Sums a list of numbers.', 'export function total(xs) {', "  if (!Array.isArray(xs)) throw new TypeError('xs must be an array');",
      '  let sum = 0;', '  for (const x of xs) sum += x;', '  return sum;', '}', '',
    ].join('\n'),
    'src/legacy.js': null,
    'src/average.js': [
      "import { total } from './total.js';", '', '// The mean of a list of numbers.', 'export function average(xs) {',
      '  if (xs.length === 0) return 0;', '  return total(xs) / xs.length;', '}', '',
    ].join('\n'),
  },
  h2: {
    'src/total.js': [
      '// Sums a list of numbers.', 'export function total(xs) {', '  // Arrays only: nothing passes anything else.',
      "  if (!Array.isArray(xs)) throw new TypeError('xs must be an array');", '  let sum = 0;', '  for (const x of xs) sum += x;',
      '  return sum;', '}', '',
    ].join('\n'),
    'src/average.js': [
      "import { total } from './total.js';", '', '// The mean of a list of numbers; NaN for none.', 'export function average(xs) {',
      '  if (xs.length === 0) return Number.NaN;', '  return total(xs) / xs.length;', '}', '',
    ].join('\n'),
    'src/average.test.js': [
      "import assert from 'node:assert/strict';", "import { average } from './average.js';", '',
      'assert.equal(average([2, 4]), 3);', 'assert.ok(Number.isNaN(average([])));', '',
    ].join('\n'),
  },
  h3: {
    'src/total.js': [
      '/**', ' * The sum of a list of numbers.', ' */', 'export function total(xs) {', '  // Arrays only: nothing passes anything else.',
      "  if (!Array.isArray(xs)) throw new TypeError('xs must be an array');", '  let sum = 0;', '  for (const x of xs) sum += x;',
      '  return sum;', '}', '',
    ].join('\n'),
  },
} satisfies Record<string, Record<string, string | null>>;

/** Writes `<outDir>/vault/` (replacing it) and `<outDir>/CONTENTS.md`. */
export async function generateFixture(outDir: string): Promise<FixtureResult> {
  const work = await mkdtemp(path.join(tmpdir(), 'margin-fixture-'));
  try {
    return await generate(outDir, work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function generate(outDir: string, work: string): Promise<FixtureResult> {
  // ---- the repository: fixed names, dates and an empty global config, so the shas never change ----
  const repo = path.join(work, 'repo');
  await mkdir(repo);
  const globalConfig = path.join(work, 'gitconfig');
  await writeFile(globalConfig, '');
  const gitEnv = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Fixture Author',
    GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'Fixture Author',
    GIT_COMMITTER_EMAIL: 'author@example.com',
  };
  const g = (args: string[], env: Record<string, string> = {}) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...gitEnv, ...env } }).trim();
  const commit = async (changes: Record<string, string | null>, message: string, at: number) => {
    for (const [name, text] of Object.entries(changes)) {
      const file = path.join(repo, ...name.split('/'));
      if (text === null) await rm(file);
      else {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text);
      }
    }
    g(['add', '-A']);
    const date = `@${Math.floor(at / 1000)} +0000`;
    g(['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return g(['rev-parse', 'HEAD']);
  };
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.name', REVIEWER]);
  g(['config', 'core.autocrlf', 'false']);
  g(['remote', 'add', 'origin', 'git@github.com:openledger-nl/margin-fixture.git']);
  const hour = 3_600_000;
  const base = await commit(files.base, 'Add total and legacyTotal', FIXTURE_START - 3 * hour);
  g(['checkout', '-q', '-b', BRANCH]);
  const h1 = await commit(files.h1, 'Add average, drop legacyTotal', FIXTURE_START - 2.5 * hour);
  const h2 = await commit(files.h2, 'Answer the review', FIXTURE_START - 2 * hour);
  const h3 = await commit(files.h3, 'Document total', FIXTURE_START - 1.5 * hour);

  // ---- the vault, through margin-code's own code ----
  const vaultRoot = path.join(outDir, 'vault');
  await rm(vaultRoot, { recursive: true, force: true });
  const vault = new Vault(vaultRoot, fixedIds(FIXTURE_START, STEP));
  const git = new Git('git', gitEnv);
  const identity = await git.identity(repo);
  const repoName = repoNameOf(identity, 'repo');
  const out: FixtureResult['files'] = [];
  const note = (file: string, what: string) => out.push({ file: vault.relative(file), what });

  // A project is Ledger's: margin-code never makes one, so this file is written the way Ledger would.
  const projectFile = path.join(vault.projectsDir, 'fixture', 'project.md');
  await mkdir(path.dirname(projectFile), { recursive: true });
  await writeFileAtomic(projectFile, Frontmatter.create({ name: 'Fixture project', createdAt: vault.ids.now() }).toString());
  note(projectFile, "The project. Ledger's file, written by hand here: margin-code never makes projects.");

  const thread = await vault.createThread('fixture', `${repoName}: ${BRANCH}`);
  note(path.join(vault.threadDir('fixture', thread.slug), 'thread.md'), `A thread margin-code made, titled "${thread.title}" (slug ${thread.slug}).`);

  // Round 1: base..h1, five conversations, submitted with "Request changes".
  const round1 = await vault.createReview('fixture', thread.slug, { repo: identity, repoName, base, baseRef: 'main', head: h1, headRef: BRANCH, author: REVIEWER });
  const s1 = await ReviewSession.open(vault, git, round1.file, repo);
  const c1 = await s1.addComment({ side: 'new', path: 'src/total.js', line: 3 }, 'Throwing here breaks callers that pass any other iterable. Accept iterables?');
  const c1r = await s1.reply(c1.id, 'Nothing passes anything but arrays today.');
  const c1rr = await vault.createComment(round1.file, { replyTo: c1r.id, author: REVIEWER }, 'Then say so in a comment, and this is fine.');
  await s1.setResolved(c1.id, true);
  const c2 = await s1.addComment({ side: 'old', path: 'src/legacy.js', line: 2 }, 'Who still calls `legacyTotal`? Removing it breaks them.');
  const c3 = await s1.addComment({ side: 'new', path: 'src/average.js', line: 4, endLine: 7 }, 'First draft of this comment.');
  // Another tool adds a key of its own, with a YAML comment; margin-code keeps both when it edits the comment.
  const c3text = await readFile(c3.file, 'utf8');
  await writeFileAtomic(c3.file, c3text.replace('format: 1\n', 'format: 1\nreviewTool: other # added by another tool; margin-code keeps it\n'));
  await s1.edit(c3.id, '`average([])` returning 0 hides bad input. `NaN`, or throw?');
  const c4 = await s1.addComment({ side: 'new', path: 'src/average.js' }, 'This file needs a test.');
  await s1.submit('changes', 'Two things before this goes in:\n\n- keep `legacyTotal`, or say that removing it breaks callers\n- decide what `average([])` returns');

  note(round1.file, 'Round 1: submitted, verdict changes, with a summary. base..h1.');
  note(c1.file, 'A comment on one line of the new side, with codeBefore and codeAfter; resolved: true.');
  note(c1r.file, 'A reply (replyTo: the first comment).');
  note(c1rr.file, 'A reply to a reply (replyTo: the reply above). margin-code itself always answers the first comment; this one is written with its writer directly.');
  note(c2.file, 'A comment on a removed line: side old, at the base commit.');
  note(c3.file, 'A comment on a range (line..endLine), edited after another tool added a key with a YAML comment, which stayed.');
  note(c4.file, 'A comment on the whole file: no line, endLine or code.');

  // Round 2: a draft, started at h2, moved to h3 (Move Review to HEAD) after its first comment.
  const round2 = await vault.createReview('fixture', thread.slug, { repo: identity, repoName, base, baseRef: 'main', head: h2, headRef: BRANCH, author: REVIEWER });
  const s2 = await ReviewSession.open(vault, git, round2.file, repo);
  const d1 = await s2.addComment({ side: 'new', path: 'src/total.js', line: 6 }, 'This loop could be `xs.reduce` now.');
  await s2.moveHead(h3, BRANCH);
  const d2 = await s2.addComment({ side: 'new', path: 'src/average.test.js', line: 4 }, 'Add a case with one element.');
  // A comment from a newer margin-code, made by hand: format 2, and a key format 1 doesn't have.
  const stamp = vault.ids.stamp();
  const future = path.join(vault.commentsDir(round2.file), `${stamp.id}.md`);
  const futureFm = Frontmatter.create(
    {
      format: 2, path: 'src/total.js', side: 'new', line: 1, endLine: 3, commit: h3, code: '/**\n * The sum of a list of numbers.\n */\n',
      suggestion: '/** The sum of a list of numbers. */\n', author: REVIEWER, createdAt: stamp.at, updatedAt: stamp.at,
    },
    'One line is enough for this comment.',
  );
  await writeFileAtomic(future, futureFm.toString());
  await s2.reload();

  note(round2.file, 'Round 2: a draft with an empty summary. Started at h2, then moved to h3 (Move Review to HEAD).');
  note(d1.file, "A comment made on h2: its commit isn't the review's head (h3) any more. margin-code finds it two lines down.");
  note(d2.file, 'A comment made after the move: its commit is the head.');
  note(future, 'Format 2, with a key format 1 lacks: Ledger shows it read-only, margin-code leaves it untouched.');

  const commits = { base, h1, h2, h3 };
  await writeFile(path.join(outDir, 'CONTENTS.md'), contents(out, commits, identity));
  return { files: out, commits, moved: s2.placements.get(d1.id) };
}

function contents(entries: FixtureResult['files'], commits: FixtureResult['commits'], identity: string): string {
  const lines = [
    '# The fixture vault',
    '',
    "`vault/` is made by margin-code's own code (`src/fixture.ts`): its writer, slugs, ids, thread creation and a",
    'review session, against a throwaway repository with fixed commit dates, a fixed clock and a fixed id seed, so',
    "it comes out the same every time. `src/fixture.test.ts` fails when margin-code would write it differently;",
    '`pnpm fixture` writes it again (then tell the Ledger side, which tests that it reads these files).',
    '',
    `The repository is \`${identity}\`; its commits on \`${BRANCH}\`:`,
    '',
    `- base \`${commits.base}\` (main): total.js, legacy.js, README.md`,
    `- h1 \`${commits.h1}\`: adds average.js, removes legacy.js, guards total()`,
    `- h2 \`${commits.h2}\`: answers round 1 (a comment in total.js, NaN for none, average.test.js)`,
    `- h3 \`${commits.h3}\`: a three-line doc comment on total.js, which moves its lines down by two`,
    '',
    '| File | What it shows |',
    '|---|---|',
    ...entries.map((e) => `| \`${e.file}\` | ${e.what.replace(/\|/g, '\\|')} |`),
    '',
  ];
  return lines.join('\n');
}
