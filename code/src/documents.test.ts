import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentsDir, type DocumentsDeps, expandWindowsVars, parseUserDirs } from './documents';

/** Fake programs and files: `programs` maps a program's file name to its stdout (undefined: it fails). */
function deps(programs: Record<string, string | undefined>, files: Record<string, string> = {}): DocumentsDeps & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    run: async (file) => {
      const name = path.win32.basename(file).toLowerCase();
      ran.push(name);
      return programs[name];
    },
    read: async (file) => files[file],
  };
}

const winEnv = { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\m', APPDATA: 'C:\\Users\\m\\AppData\\Roaming' };

describe('the Documents folder on Windows', () => {
  it('is the known folder, as .NET reports it (redirected to OneDrive, say)', async () => {
    const d = deps({ 'powershell.exe': 'C:\\Users\\m\\OneDrive\\Documenten\r\n' });
    expect(await documentsDir({ platform: 'win32', env: winEnv, homedir: 'C:\\Users\\m' }, d)).toBe('C:\\Users\\m\\OneDrive\\Documenten');
    expect(d.ran).toEqual(['powershell.exe']);
  });

  it('falls back to the registry, then to the profile', async () => {
    const reg = [
      '',
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
      '    Personal    REG_EXPAND_SZ    %UserProfile%\\OneDrive\\Documents',
      '',
    ].join('\r\n');
    const input = { platform: 'win32' as const, env: winEnv, homedir: 'C:\\Users\\m' };
    expect(await documentsDir(input, deps({ 'powershell.exe': undefined, 'reg.exe': reg }))).toBe('C:\\Users\\m\\OneDrive\\Documents');
    expect(await documentsDir(input, deps({ 'powershell.exe': '', 'reg.exe': undefined }))).toBe('C:\\Users\\m\\Documents');
  });

  it('expands %VARIABLES% in any case, leaving unknown ones', () => {
    expect(expandWindowsVars('%userprofile%\\x\\%NOPE%', { USERPROFILE: 'C:\\U' })).toBe('C:\\U\\x\\%NOPE%');
  });

  it.runIf(process.platform === 'win32')('is found on this machine', async () => {
    const found = await documentsDir({ platform: 'win32', env: process.env, homedir: homedir() });
    expect(found && path.isAbsolute(found)).toBe(true);
    expect(existsSync(found!)).toBe(true);
  });
});

describe('the Documents folder on macOS', () => {
  it('is ~/Documents', async () => {
    expect(await documentsDir({ platform: 'darwin', env: {}, homedir: '/Users/m' }, deps({}))).toBe('/Users/m/Documents');
  });
});

describe('the Documents folder on Linux', () => {
  it('is XDG_DOCUMENTS_DIR from user-dirs.dirs, under XDG_CONFIG_HOME when that is absolute', async () => {
    const text = '# written by xdg-user-dirs-update\nXDG_DESKTOP_DIR="$HOME/Desktop"\nXDG_DOCUMENTS_DIR="$HOME/Docs"\n';
    expect(await documentsDir({ platform: 'linux', env: {}, homedir: '/home/m' }, deps({}, { '/home/m/.config/user-dirs.dirs': text }))).toBe('/home/m/Docs');
    expect(await documentsDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/cfg' }, homedir: '/home/m' }, deps({}, { '/cfg/user-dirs.dirs': text }))).toBe('/home/m/Docs');
    expect(await documentsDir({ platform: 'linux', env: { XDG_CONFIG_HOME: 'rel' }, homedir: '/home/m' }, deps({}, { '/home/m/.config/user-dirs.dirs': text }))).toBe('/home/m/Docs');
  });

  it('is none without user-dirs.dirs or the line in it', async () => {
    expect(await documentsDir({ platform: 'linux', env: {}, homedir: '/home/m' }, deps({}))).toBeUndefined();
    expect(parseUserDirs('XDG_DESKTOP_DIR="$HOME/Desktop"\n', '/home/m')).toBeUndefined();
  });

  it('reads values the way dirs-sys does', () => {
    const home = '/home/m';
    expect(parseUserDirs('XDG_DOCUMENTS_DIR="/srv/docs"', home)).toBe('/srv/docs');
    expect(parseUserDirs(' \tXDG_DOCUMENTS_DIR = "$HOME/My\\ Docs\\"x" \t', home)).toBe('/home/m/My Docs"x');
    // Turned off ("$HOME/"), unquoted, relative or with a CR: skipped, and a later line may still count.
    expect(parseUserDirs('XDG_DOCUMENTS_DIR="$HOME/"', home)).toBeUndefined();
    expect(parseUserDirs('XDG_DOCUMENTS_DIR=$HOME/Docs', home)).toBeUndefined();
    expect(parseUserDirs('XDG_DOCUMENTS_DIR="Docs"', home)).toBeUndefined();
    expect(parseUserDirs('XDG_DOCUMENTS_DIR="$HOME/Docs"\r', home)).toBeUndefined();
    expect(parseUserDirs('XDG_DOCUMENTS_DIR="$HOME/"\nXDG_DOCUMENTS_DIR="$HOME/Second"', home)).toBe('/home/m/Second');
    expect(parseUserDirs('XDG_DOCUMENTS_DIR="$HOME/First"\nXDG_DOCUMENTS_DIR="$HOME/Second"', home)).toBe('/home/m/First');
    expect(parseUserDirs('#XDG_DOCUMENTS_DIR="$HOME/Commented"', home)).toBeUndefined();
  });
});
