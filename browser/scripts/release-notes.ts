// Release notes for a GitHub release: install steps plus the changes since the
// previous release, grouped by Conventional Commit type.
//
//   node scripts/release-notes.ts <version> [previous-tag]
//
// Used by .github/workflows/ci.yml.
import { execFileSync } from 'node:child_process';
import { levelOf } from './version.ts';

const REPO = 'andor00/browser-review-mcp';

export interface Commit {
  subject: string;
  body: string;
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]+)\))?!?: (?<summary>.+)$/;

/** Markdown list of the user-facing changes. Chores, docs, refactors and the like are left out. */
export function changes(commits: Commit[]): string {
  const groups: Record<'breaking' | 'feat' | 'fix', string[]> = { breaking: [], feat: [], fix: [] };
  for (const c of commits) {
    const m = HEADER.exec(c.subject);
    if (!m?.groups) continue;
    const line = `- ${m.groups.scope ? `**${m.groups.scope}:** ` : ''}${m.groups.summary}`;
    const level = levelOf(`${c.subject}\n\n${c.body}`);
    if (level === 'major') groups.breaking.push(line);
    else if (level === 'minor') groups.feat.push(line);
    else if (level === 'patch') groups.fix.push(line);
  }
  const out: string[] = [];
  if (groups.breaking.length) out.push('### Breaking changes', ...groups.breaking, '');
  if (groups.feat.length) out.push('### New', ...groups.feat, '');
  if (groups.fix.length) out.push('### Fixed', ...groups.fix, '');
  return out.length ? out.join('\n') : 'Maintenance release.\n';
}

export function notes(version: string, commits: Commit[]): string {
  const base = `https://github.com/${REPO}/releases/download/v${version}`;
  return `## Install

**Brave, Chrome, Edge:** download \`browser-review-${version}-chrome.zip\`, extract it into a folder you keep, then in \`brave://extensions\` (or \`chrome://extensions\`) turn on **Developer mode**, click **Load unpacked** and pick that folder. To update, extract over the same folder and click the reload icon on the extension card.

**Firefox 140+:** \`browser-review-${version}-firefox.zip\`. Until it is signed: \`about:debugging\`, **This Firefox**, **Load Temporary Add-on**, pick the zip.

**Claude Code**, once:

\`\`\`sh
claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest
\`\`\`

Not on npm yet? Use the package from this release instead:

\`\`\`sh
claude mcp add --scope user browser-review -- npx -y --package=${base}/browser-review-mcp-${version}.tgz browser-review-mcp
\`\`\`

The extension's help page (opens on install) shows whether Claude Code is connected.

## Changes

${changes(commits)}`;
}

function commitsSince(prevTag: string | undefined): Commit[] {
  const range = prevTag ? [`${prevTag}..HEAD`] : ['HEAD'];
  const sep = '\u001e';
  const out = execFileSync('git', ['log', ...range, `--format=%s%x1f%b${sep}`], { encoding: 'utf8' });
  return out
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [subject = '', body = ''] = s.split('\u001f');
      return { subject: subject.trim(), body: body.trim() };
    });
}

if (import.meta.main) {
  const [version, prevTag] = process.argv.slice(2);
  if (!version) {
    console.error('Usage: node scripts/release-notes.ts <version> [previous-tag]');
    process.exit(1);
  }
  process.stdout.write(notes(version, commitsSince(prevTag || undefined)));
}
