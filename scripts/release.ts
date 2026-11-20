// One version and one release for every extension in this repo, from Conventional Commits.
// Runs on plain Node 24+ (no dependencies). CI (.github/workflows/ci.yml) calls it on every push to main:
//
//   node scripts/release.ts plan              print {"level","version","previous"}: what the commits since the
//                                             last v* tag ask for (level "none": nothing to release).
//                                             FORCE_LEVEL=patch|minor|major releases at least that much.
//   node scripts/release.ts apply <version>   write <version> into every package.json and manifest.json
//   node scripts/release.ts notes <version> <previous-tag>   the release notes, markdown
//
// feat -> minor, fix/perf -> patch, "!" or a "BREAKING CHANGE:" footer -> major; anything else releases nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Level = 'major' | 'minor' | 'patch' | 'none';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file that carries the version. The first one is where the current version is read. */
export const VERSION_FILES = [
  'browser-review/package.json',
  'browser-review/shared/package.json',
  'browser-review/server/package.json',
  'browser-review/extension/package.json',
  'browser-review/extension/static/manifest.json',
  'github/package.json',
  'github/static/manifest.json',
];

/** The extensions, by folder, for the release notes. */
export const PRODUCTS: [folder: string, name: string][] = [
  ['browser-review/', 'Margin Browser Review'],
  ['github/', 'Margin for GitHub'],
];

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]+)\))?(?<bang>!)?: (?<summary>.+)$/;
const RANK: Record<Level, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export interface Commit {
  subject: string;
  body: string;
  files: string[];
}

export function levelOf(subject: string, body = ''): Level {
  const m = HEADER.exec(subject);
  if (!m?.groups) return 'none';
  if (m.groups.bang || /^BREAKING[ -]CHANGE: /m.test(body)) return 'major';
  if (m.groups.type === 'feat') return 'minor';
  if (m.groups.type === 'fix' || m.groups.type === 'perf') return 'patch';
  return 'none';
}

export function highest(levels: Level[]): Level {
  return levels.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none');
}

export function bump(version: string, level: Exclude<Level, 'none'>): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Not a plain x.y.z version: "${version}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Larger of two x.y.z versions. */
export function maxVersion(a: string, b: string): string {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) > (pb[i] ?? 0) ? a : b;
  return a;
}

/** Markdown list of the user-facing changes, grouped by kind, each with the extension it is about. */
export function changes(commits: Commit[]): string {
  const groups: Record<'major' | 'minor' | 'patch', string[]> = { major: [], minor: [], patch: [] };
  for (const c of commits) {
    const level = levelOf(c.subject, c.body);
    if (level === 'none') continue;
    const m = HEADER.exec(c.subject)!;
    const about = PRODUCTS.filter(([folder]) => c.files.some((f) => f.startsWith(folder))).map(([, name]) => name);
    groups[level].push(`- ${about.length ? `**${about.join(', ')}:** ` : ''}${m.groups!.summary}`);
  }
  const out: string[] = [];
  if (groups.major.length) out.push('### Breaking changes', '', ...groups.major, '');
  if (groups.minor.length) out.push('### New', '', ...groups.minor, '');
  if (groups.patch.length) out.push('### Fixed', '', ...groups.patch, '');
  return out.join('\n').trim();
}

export const WEBSITE = 'https://open-ledger.netlify.app/#margin';

/** `signed`: whether the Firefox builds are Mozilla-signed .xpi files (else the unsigned zips are attached). */
export function notes(version: string, commits: Commit[], signed = true): string {
  const list = changes(commits);
  const ff = signed ? 'firefox.xpi' : 'firefox.zip';
  return [
    `Every Margin extension, version ${version}. Install them from [the website](${WEBSITE}), or from the files below.`,
    '',
    '| Extension | Firefox (140+) | Chrome, Brave, Edge |',
    '|---|---|---|',
    `| Margin for GitHub | \`margin-github-${ff}\` | \`margin-github-chrome.zip\` |`,
    `| Margin Browser Review | \`margin-browser-review-${ff}\` | \`margin-browser-review-chrome.zip\` |`,
    '',
    signed
      ? '- **Firefox**: open the `.xpi` in Firefox and confirm. It is signed by Mozilla, so it stays installed.'
      : '- **Firefox**: not signed by Mozilla in this release, so it installs only for the session: `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, pick the zip.',
    '- **Chrome, Brave, Edge**: unzip into a folder you keep, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick that folder. (Chrome installs in one click only from the Chrome Web Store.)',
    '- **Margin Browser Review** also needs its MCP server in Claude Code once: `claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest`',
    '',
    list ? `## Changes\n\n${list}` : '',
  ].join('\n').trim() + '\n';
}

// ---------- git and files ----------

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** The highest vX.Y.Z tag (not github-v… or …-latest). */
export function previousTag(): string | null {
  const tags = git('tag', '--list', 'v*').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  return tags.length ? tags.reduce((a, b) => (maxVersion(a.slice(1), b.slice(1)) === b.slice(1) ? b : a)) : null;
}

export function commitsSince(tag: string | null): Commit[] {
  const range = tag ? [`${tag}..HEAD`] : ['HEAD'];
  const out = git('log', '--no-merges', '--format=%x1e%H%x1f%s%x1f%b', ...range);
  return out
    .split('\x1e')
    .filter((r) => r.trim())
    .map((r) => {
      const [hash, subject, body] = r.split('\x1f') as [string, string, string];
      const files = git('show', '--name-only', '--format=', hash.trim()).split('\n').filter(Boolean);
      return { subject: subject.trim(), body: (body ?? '').trim(), files };
    });
}

function readVersion(file: string): string {
  return (JSON.parse(readFileSync(join(root, file), 'utf8')) as { version: string }).version;
}

/** Replaces the top-level "version" value in place, keeping the file's formatting. */
function writeVersion(file: string, version: string): void {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const next = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
  if (next === text && readVersion(file) !== version) throw new Error(`No "version" in ${file}`);
  writeFileSync(path, next);
}

function main([cmd, a, b]: string[]): number {
  if (cmd === 'plan') {
    const previous = previousTag();
    const forced = (['patch', 'minor', 'major'] as Level[]).find((l) => l === process.env.FORCE_LEVEL) ?? 'none';
    const level = highest([forced, ...commitsSince(previous).map((c) => levelOf(c.subject, c.body))]);
    // Start from the highest version anywhere, so no extension's version ever goes down.
    const current = VERSION_FILES.map(readVersion).reduce(maxVersion, previous ? previous.slice(1) : '0.0.0');
    const version = level === 'none' ? current : bump(current, level);
    console.log(JSON.stringify({ level, version, previous }));
    return 0;
  }
  if (cmd === 'apply' && a) {
    for (const f of VERSION_FILES) writeVersion(f, a);
    console.log(`${a} in ${VERSION_FILES.length} files`);
    return 0;
  }
  if (cmd === 'notes' && a) {
    process.stdout.write(notes(a, commitsSince(b || null), process.env.FIREFOX_SIGNED !== 'false'));
    return 0;
  }
  console.error('Usage: node scripts/release.ts plan | apply <version> | notes <version> [previous-tag]');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
