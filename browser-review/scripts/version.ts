// Versioning from Conventional Commits. Runs on plain Node (no dependencies).
//
//   node scripts/version.ts check <commit-msg-file>   exit 1 when the message is not a Conventional Commit
//   node scripts/version.ts level <commit-msg-file>   print major | minor | patch | none
//   node scripts/version.ts bump <major|minor|patch>  bump the root version and sync it everywhere
//   node scripts/version.ts sync                      copy the root version into every file
//   node scripts/version.ts files                     print the files that carry the version
//
// The root package.json is the single source of truth. The git hooks in
// .githooks/ call this; see CLAUDE.md for the rules.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Level = 'major' | 'minor' | 'patch' | 'none';

export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'test', 'build', 'ci', 'chore', 'revert'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_PKG = 'package.json';
/** Files that get the root version copied in. Paths relative to the repo root. */
export const SYNCED = ['shared/package.json', 'server/package.json', 'extension/package.json', 'extension/static/manifest.json'];

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]+)\))?(?<bang>!)?: \S/;
/** Messages git writes itself; they are allowed through and never bump. */
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! |Initial commit$)/;

/** Drops the comment lines git adds to the message file, and trailing blank lines. */
export function cleanMessage(raw: string): string {
  const scissors = raw.indexOf('# ------------------------ >8 ------------------------');
  const text = scissors >= 0 ? raw.slice(0, scissors) : raw;
  return text
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim();
}

/** Null when fine, otherwise why the message is rejected. */
export function checkMessage(message: string): string | null {
  const header = message.split('\n')[0] ?? '';
  if (!header) return 'The commit message is empty.';
  if (GIT_GENERATED.test(header)) return null;
  const m = HEADER.exec(header);
  if (!m?.groups) return `The first line must look like "type(scope): summary" or "type: summary". Got: "${header}"`;
  if (!TYPES.includes(m.groups.type!)) return `Unknown type "${m.groups.type}". Use one of: ${TYPES.join(', ')}.`;
  return null;
}

/** Which part of the version a commit bumps. */
export function levelOf(message: string): Level {
  const header = message.split('\n')[0] ?? '';
  if (GIT_GENERATED.test(header)) return 'none';
  const m = HEADER.exec(header);
  if (!m?.groups) return 'none';
  if (m.groups.bang || /^BREAKING[ -]CHANGE: /m.test(message)) return 'major';
  if (m.groups.type === 'feat') return 'minor';
  if (m.groups.type === 'fix' || m.groups.type === 'perf') return 'patch';
  return 'none';
}

export function bumpVersion(version: string, level: Exclude<Level, 'none'>): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Not a plain x.y.z version: "${version}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Replaces the top-level "version" value in place, keeping the file's own formatting. */
function setVersionIn(file: string, version: string): boolean {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === text) return false;
  writeFileSync(path, next);
  return true;
}

export function currentVersion(): string {
  const version = (JSON.parse(readFileSync(join(root, ROOT_PKG), 'utf8')) as { version?: string }).version;
  if (!version) throw new Error('The root package.json has no "version".');
  return version;
}

function sync(version: string): void {
  for (const file of SYNCED) setVersionIn(file, version);
}

function main(argv: string[]): number {
  const [cmd, arg] = argv;
  switch (cmd) {
    case 'check': {
      const error = checkMessage(cleanMessage(readFileSync(arg!, 'utf8')));
      if (!error) return 0;
      console.error(`\nCommit rejected: not a Conventional Commit.\n  ${error}\n`);
      console.error('  feat: add page comments        -> minor (0.1.0 -> 0.2.0)');
      console.error('  fix(sidebar): keep reply text  -> patch (0.1.0 -> 0.1.1)');
      console.error('  feat!: new storage format      -> major (0.1.0 -> 1.0.0)');
      console.error('  docs: explain shortcuts        -> no bump\n');
      console.error('See CLAUDE.md. Skip once with git commit --no-verify.\n');
      return 1;
    }
    case 'level':
      console.log(levelOf(cleanMessage(readFileSync(arg!, 'utf8'))));
      return 0;
    case 'bump': {
      if (arg !== 'major' && arg !== 'minor' && arg !== 'patch') {
        console.error('Usage: node scripts/version.ts bump <major|minor|patch>');
        return 1;
      }
      const from = currentVersion();
      const to = bumpVersion(from, arg);
      setVersionIn(ROOT_PKG, to);
      sync(to);
      console.log(to);
      return 0;
    }
    case 'sync':
      sync(currentVersion());
      return 0;
    case 'files':
      console.log([ROOT_PKG, ...SYNCED].join('\n'));
      return 0;
    default:
      console.error('Usage: node scripts/version.ts <check|level|bump|sync|files> [arg]');
      return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
