// Comparing paths the way the file system does: on Windows, case doesn't matter (and VS Code's Uri.fsPath
// lowercases the drive letter, so "C:\vault" and "c:\vault" must be the same folder).
import * as path from 'node:path';

function norm(p: string, platform: NodeJS.Platform): string {
  const resolved = platform === 'win32' ? path.win32.resolve(p) : path.posix.resolve(p);
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return norm(a, platform) === norm(b, platform);
}

/** Whether `child` is inside `dir` (not `dir` itself). */
export function isInside(child: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const sep = platform === 'win32' ? '\\' : '/';
  const d = norm(dir, platform);
  return norm(child, platform).startsWith(d.endsWith(sep) ? d : d + sep);
}

/** A key for a path, equal for paths that name the same file. */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  return norm(p, platform);
}
