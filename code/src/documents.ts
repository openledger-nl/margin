// The user's Documents folder, found the way Ledger finds it: Tauri's document_dir, which is the `dirs` crate
// (dirs 7 / dirs-sys 0.5):
//   Windows  the known folder FOLDERID_Documents (SHGetKnownFolderPath), which may be redirected, to OneDrive say;
//   macOS    ~/Documents;
//   Linux    XDG_DOCUMENTS_DIR from $XDG_CONFIG_HOME/user-dirs.dirs (else ~/.config/user-dirs.dirs), or none.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface DocumentsInput {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homedir: string;
}

export interface DocumentsDeps {
  /** A program's stdout, or undefined when it can't run or fails. */
  run(file: string, args: readonly string[]): Promise<string | undefined>;
  /** A file's text, or undefined when it can't be read. */
  read(file: string): Promise<string | undefined>;
}

const systemDeps: DocumentsDeps = {
  run: (file, args) =>
    new Promise((resolve) => {
      execFile(file, [...args], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }, (error, stdout) => resolve(error ? undefined : stdout));
    }),
  read: (file) => readFile(file, 'utf8').catch(() => undefined),
};

let cached: Promise<string | undefined> | undefined;

/** The Documents folder, or undefined when this user has none. Whether it exists isn't checked. */
export function documentsDir(input: DocumentsInput, deps?: DocumentsDeps): Promise<string | undefined> {
  if (deps) return find(input, deps);
  // Asking Windows takes a PowerShell start; the answer doesn't change while VS Code runs.
  cached ??= find(input, systemDeps);
  return cached;
}

function find(input: DocumentsInput, deps: DocumentsDeps): Promise<string | undefined> {
  if (input.platform === 'win32') return windowsDocuments(input, deps);
  if (input.platform === 'darwin') return Promise.resolve(path.posix.join(input.homedir, 'Documents'));
  return xdgDocuments(input, deps);
}

// ---- Windows ----------------------------------------------------------------------------------------

const SHELL_FOLDERS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';

/** %NAME% replaced from the environment (names in any case), as ExpandEnvironmentStrings does; unknown ones stay. */
export function expandWindowsVars(value: string, env: Record<string, string | undefined>): string {
  const lower = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  return value.replace(/%([^%]+)%/g, (whole, name: string) => lower.get(name.toLowerCase()) ?? whole);
}

async function windowsDocuments(input: DocumentsInput, deps: DocumentsDeps): Promise<string | undefined> {
  const { env } = input;
  const system = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32');

  // What SHGetKnownFolderPath(FOLDERID_Documents) says, through .NET; DoNotVerify: also when it doesn't exist yet.
  const shell = await deps.run(path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments', 'DoNotVerify')",
  ]);
  const known = shell?.trim();
  if (known && path.win32.isAbsolute(known)) return known;

  // Where SHGetKnownFolderPath reads a redirected Documents folder from.
  const reg = await deps.run(path.win32.join(system, 'reg.exe'), ['query', SHELL_FOLDERS, '/v', 'Personal']);
  const value = reg ? /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(reg)?.[1] : undefined;
  const expanded = value && expandWindowsVars(value, env);
  if (expanded && path.win32.isAbsolute(expanded)) return expanded;

  // The known folder's default.
  const profile = env.USERPROFILE || input.homedir;
  return profile ? path.win32.join(profile, 'Documents') : undefined;
}

// ---- Linux and other Unixes -------------------------------------------------------------------------

/**
 * XDG_<name>_DIR from user-dirs.dirs, read the way dirs-sys does: only double-quoted values, "$HOME/…" or an
 * absolute path; "$HOME/" alone means the folder is turned off; backslash escapes; the first usable line wins.
 */
export function parseUserDirs(text: string, home: string, name = 'DOCUMENTS'): string | undefined {
  const blank = /^[ \t]+|[ \t]+$/g;
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).replace(blank, '') !== `XDG_${name}_DIR`) continue;
    const quoted = line.slice(eq + 1).replace(blank, '');
    if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) continue;
    const value = quoted.slice(1, -1);
    let relative: boolean;
    let rest: string;
    if (value === '$HOME/') continue;
    if (value.startsWith('$HOME/')) {
      relative = true;
      rest = value.slice('$HOME/'.length);
    } else if (value.startsWith('/')) {
      relative = false;
      rest = value;
    } else {
      continue;
    }
    const unescaped = shellUnescape(rest);
    // Like PathBuf::push: an absolute part replaces the home folder.
    return relative && !unescaped.startsWith('/') ? path.posix.join(home, unescaped) : unescaped;
  }
  return undefined;
}

/** A backslash keeps the character after it; a backslash at the very end is dropped. */
function shellUnescape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      if (i < s.length) out += s[i];
    } else {
      out += s[i];
    }
  }
  return out;
}

async function xdgDocuments(input: DocumentsInput, deps: DocumentsDeps): Promise<string | undefined> {
  const { env, homedir } = input;
  if (!homedir) return undefined;
  const config = env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.posix.join(homedir, '.config');
  const text = await deps.read(path.posix.join(config, 'user-dirs.dirs'));
  return text === undefined ? undefined : parseUserDirs(text, homedir);
}
