// Repo identity: the same repository gets the same name on every machine, whichever way it was cloned.
//
//   git@github.com:openledger-nl/margin.git   ->  github.com/openledger-nl/margin
//   https://github.com/openledger-nl/margin   ->  github.com/openledger-nl/margin
//
// The host is lowercased; the scheme, user, port and trailing ".git" are dropped. A repository without a usable
// remote is "git:<sha of its root commit>".

/** host/path for a remote URL, or undefined when it has no host (a local path or file:// remote). */
export function identityFromUrl(raw: string): string | undefined {
  const url = raw.trim();
  let host: string;
  let path: string;

  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url);
  if (scheme) {
    if (/^file:/i.test(url)) return undefined;
    const rest = url.slice(scheme[0].length);
    const slash = rest.indexOf('/');
    let authority = slash === -1 ? rest : rest.slice(0, slash);
    path = slash === -1 ? '' : rest.slice(slash + 1);
    const at = authority.lastIndexOf('@');
    if (at !== -1) authority = authority.slice(at + 1);
    host = authority.startsWith('[')
      ? authority.slice(0, authority.indexOf(']') + 1) // [::1]:22
      : authority.replace(/:\d*$/, '');
  } else {
    // scp-like: [user@]host:path. A Windows drive (C:\repo, C:/repo) is a local path, not a host.
    const scp = /^(?:[^@/\\]+@)?([^:/\\]+):(.*)$/.exec(url);
    if (!scp || /^[a-z]$/i.test(scp[1] ?? '')) return undefined;
    host = scp[1] ?? '';
    path = scp[2] ?? '';
  }

  host = host.toLowerCase();
  path = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (host === '') return undefined;
  return path === '' ? host : `${host}/${path}`;
}

/** The remote to take the identity from: `origin`, else the first by name. */
export function pickRemote<T extends { name: string }>(remotes: readonly T[]): T | undefined {
  return remotes.find((r) => r.name === 'origin') ?? [...remotes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0];
}

/** The display name: the last part of the identity's path, or the folder's name for a repository without a remote. */
export function repoNameOf(identity: string, folderName: string): string {
  if (identity.startsWith('git:')) return folderName;
  const parts = identity.split('/');
  return parts[parts.length - 1] || folderName;
}
