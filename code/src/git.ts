// git, through its command line (execFile, never a shell). Read-only: margin-code never changes a repository,
// except `fetch` when the user asks for a commit this clone doesn't have yet.
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { type Hunk, parseHunks } from './anchor';
import { identityFromUrl, pickRemote } from './repoIdentity';

export interface ChangedFile {
  /** git's status letter: A added, M modified, D deleted, R renamed, C copied, T type changed. */
  status: string;
  /** The path at head (for a deleted file: the path it had). */
  path: string;
  /** For a rename or copy: the path at base. */
  oldPath?: string;
}

/** `git diff --name-status -M -z` output. */
export function parseNameStatus(z: string): ChangedFile[] {
  const parts = z.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = (parts[i++] ?? '').charAt(0);
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++] ?? '';
      const newPath = parts[i++] ?? '';
      files.push({ status, path: newPath, oldPath });
    } else {
      files.push({ status, path: parts[i++] ?? '' });
    }
  }
  return files;
}

/** The oldest root commit among `git rev-list --max-parents=0 --timestamp` lines ("<time> <sha>"). */
export function oldestRoot(lines: string): string | undefined {
  const roots = lines
    .split('\n')
    .map((l) => l.trim().split(' '))
    .filter((p): p is [string, string] => p.length === 2 && p[1] !== undefined && /^[0-9a-f]{40,64}$/.test(p[1]))
    .map(([time, sha]) => ({ time: Number(time), sha }));
  roots.sort((a, b) => a.time - b.time || (a.sha < b.sha ? -1 : 1));
  return roots[0]?.sha;
}

export class GitError extends Error {
  constructor(readonly args: readonly string[], readonly exitCode: number | string | undefined, readonly stderr: string) {
    super(`git ${args.join(' ')} failed${exitCode === undefined ? '' : ` (${exitCode})`}: ${stderr.trim() || 'no output'}`);
  }
}

interface Result<T> {
  ok: boolean;
  stdout: T;
  stderr: string;
}

export interface Branch {
  /** Short name: main, origin/main. */
  name: string;
  sha: string;
  remote: boolean;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  when: string;
}

export class Git {
  constructor(private readonly gitPath = 'git') {}

  private exec(cwd: string, args: readonly string[], buffer: false): Promise<Result<string>>;
  private exec(cwd: string, args: readonly string[], buffer: true): Promise<Result<Buffer>>;
  private exec(cwd: string, args: readonly string[], buffer: boolean): Promise<Result<string | Buffer>> {
    return new Promise((resolve, reject) => {
      execFile(
        this.gitPath,
        [...args],
        {
          cwd,
          encoding: buffer ? 'buffer' : 'utf8',
          maxBuffer: 512 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        },
        (error, stdout, stderr) => {
          const err = String(stderr);
          if (error && typeof (error as NodeJS.ErrnoException).code === 'string' && (error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            // git itself couldn't be started (ENOENT: not installed or not on PATH).
            reject(new GitError(args, (error as NodeJS.ErrnoException).code, error.message));
            return;
          }
          resolve({ ok: !error, stdout, stderr: err });
        },
      );
    });
  }

  /** stdout of a command that must succeed. */
  async run(cwd: string, args: readonly string[]): Promise<string> {
    const r = await this.exec(cwd, args, false);
    if (!r.ok) throw new GitError(args, undefined, r.stderr);
    return r.stdout;
  }

  /** stdout, trimmed, or undefined when the command fails. */
  private async maybe(cwd: string, args: readonly string[]): Promise<string | undefined> {
    const r = await this.exec(cwd, args, false);
    return r.ok ? r.stdout.trim() : undefined;
  }

  async version(): Promise<string> {
    return (await this.run(process.cwd(), ['--version'])).trim();
  }

  /** The repository root containing `dir`, or undefined when it isn't in one. */
  async toplevel(dir: string): Promise<string | undefined> {
    const top = await this.maybe(dir, ['rev-parse', '--show-toplevel']);
    return top ? path.resolve(top) : undefined;
  }

  async head(root: string): Promise<string | undefined> {
    return this.resolveCommit(root, 'HEAD');
  }

  /** The checked-out branch, or undefined for a detached HEAD. */
  async currentBranch(root: string): Promise<string | undefined> {
    return (await this.maybe(root, ['symbolic-ref', '--short', '-q', 'HEAD'])) || undefined;
  }

  /** The commit a branch, tag or sha names. */
  async resolveCommit(root: string, ref: string): Promise<string | undefined> {
    if (ref === '' || ref.startsWith('-')) return undefined;
    return (await this.maybe(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) || undefined;
  }

  async hasCommit(root: string, sha: string): Promise<boolean> {
    if (!/^[0-9a-f]{4,64}$/i.test(sha)) return false;
    return (await this.exec(root, ['cat-file', '-e', `${sha}^{commit}`], false)).ok;
  }

  /** The default branch: what origin/HEAD points at, else main, else master. `ref` is what git resolves, `name` is for display. */
  async defaultBranch(root: string): Promise<{ ref: string; name: string } | undefined> {
    const originHead = await this.maybe(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
    if (originHead && (await this.resolveCommit(root, originHead))) {
      const ref = originHead.replace(/^refs\/remotes\//, '');
      return { ref, name: ref.replace(/^origin\//, '') };
    }
    if (await this.resolveCommit(root, 'origin/HEAD')) return { ref: 'origin/HEAD', name: 'origin/HEAD' };
    for (const name of ['main', 'master']) {
      if (await this.resolveCommit(root, name)) return { ref: name, name };
    }
    return undefined;
  }

  async mergeBase(root: string, a: string, b: string): Promise<string | undefined> {
    return (await this.maybe(root, ['merge-base', a, b])) || undefined;
  }

  async isBranch(root: string, name: string): Promise<boolean> {
    if (name.startsWith('-')) return false;
    for (const ref of [`refs/heads/${name}`, `refs/remotes/${name}`]) {
      if ((await this.exec(root, ['show-ref', '--verify', '--quiet', ref], false)).ok) return true;
    }
    return false;
  }

  async remotes(root: string): Promise<{ name: string; url: string }[]> {
    const names = ((await this.maybe(root, ['remote'])) ?? '').split('\n').map((n) => n.trim()).filter(Boolean);
    const remotes = await Promise.all(names.map(async (name) => ({ name, url: (await this.maybe(root, ['remote', 'get-url', name])) ?? '' })));
    return remotes.filter((r) => r.url !== '');
  }

  /** The oldest root commit of HEAD's history. */
  async rootCommit(root: string): Promise<string | undefined> {
    const out = await this.maybe(root, ['rev-list', '--max-parents=0', '--timestamp', 'HEAD']);
    return out ? oldestRoot(out) : undefined;
  }

  /** The repository's identity: its origin remote (else the first by name) as host/path, or git:<root commit>. */
  async identity(root: string): Promise<string> {
    const remote = pickRemote(await this.remotes(root));
    const fromUrl = remote && identityFromUrl(remote.url);
    if (fromUrl) return fromUrl;
    const first = await this.rootCommit(root);
    if (!first) throw new Error(`${root} has no commits yet.`);
    return `git:${first}`;
  }

  async userName(root: string): Promise<string | undefined> {
    return (await this.maybe(root, ['config', 'user.name'])) || undefined;
  }

  /** `git diff --name-status -M base head`. */
  async changedFiles(root: string, base: string, head: string): Promise<ChangedFile[]> {
    const out = await this.run(root, ['diff', '--name-status', '-M', '-z', '--no-color', '--no-ext-diff', base, head, '--']);
    return parseNameStatus(out);
  }

  /** `git show <sha>:<path>`: the file's bytes at that commit, or undefined when it isn't there. */
  async show(root: string, sha: string, file: string): Promise<Buffer | undefined> {
    const r = await this.exec(root, ['show', '--no-textconv', `${sha}:${file}`], true);
    return r.ok ? r.stdout : undefined;
  }

  /** The hunks of one file between two commits (renamed or not), or [] when git can't pair the two paths. */
  async hunks(root: string, from: string, to: string, fromPath: string, toPath: string): Promise<Hunk[]> {
    const paths = fromPath === toPath ? [fromPath] : [fromPath, toPath];
    const r = await this.exec(root, ['diff', '-U0', '-M', '--no-color', '--no-ext-diff', '--no-textconv', from, to, '--', ...paths], false);
    if (!r.ok) return [];
    const files = r.stdout.match(/^diff --git /gm)?.length ?? 0;
    return files === 1 ? parseHunks(r.stdout) : [];
  }

  /** Local and remote branches, most recently committed first. */
  async branches(root: string): Promise<Branch[]> {
    const out = await this.maybe(root, [
      'for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/remotes',
    ]);
    const branches: Branch[] = [];
    for (const line of (out ?? '').split('\n')) {
      const [ref, sha] = line.split('\0');
      if (!ref || !sha || ref.endsWith('/HEAD')) continue;
      const remote = ref.startsWith('refs/remotes/');
      branches.push({ name: ref.replace(/^refs\/(heads|remotes)\//, ''), sha, remote });
    }
    return branches;
  }

  async recentCommits(root: string, count: number): Promise<CommitInfo[]> {
    const out = await this.maybe(root, ['log', `-n${count}`, '--no-color', '--no-show-signature', '--format=%H%x00%s%x00%cr', 'HEAD']);
    return (out ?? '')
      .split('\n')
      .map((line) => line.split('\0'))
      .filter((p) => p.length === 3)
      .map(([sha, subject, when]) => ({ sha: sha ?? '', subject: subject ?? '', when: when ?? '' }));
  }

  async fetch(root: string): Promise<void> {
    await this.run(root, ['fetch', '--all', '--quiet']);
  }
}
