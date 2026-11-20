// Review tokens (customers) and developer tokens, both named and revocable.
//
// tokens.json is only written by the CLI (`margin token add|revoke`, run with
// docker compose exec), never over the network. The server only reads it and
// picks up changes by itself. It keeps last-used times in token-usage.json.
// Only a SHA-256 hash of each token is stored: the token itself is shown once.
import { createHash, randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeFileAtomic } from './files.ts';

export type TokenKind = 'reviewer' | 'developer';

const PREFIX: Record<TokenKind, string> = { reviewer: 'mrev_', developer: 'mdev_' };

export interface TokenEntry {
  kind: TokenKind;
  name: string;
  /** SHA-256 of the token, hex. */
  hash: string;
  created: string;
  /** ISO time after which the token stops working, or null. */
  expires: string | null;
}

export interface TokenInfo extends Omit<TokenEntry, 'hash'> {
  lastUsed: string | null;
}

/** Who a valid token belongs to. */
export interface Caller {
  kind: TokenKind;
  name: string;
}

export class TokenError extends Error {}

const USAGE_WRITE_MS = 60_000;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function checkName(name: string): string {
  const n = name.trim();
  if (!/^[^\u0000-\u001f\u007f]{1,64}$/.test(n)) throw new TokenError('A token name is 1 to 64 characters, for example "Anna (client)".');
  return n;
}

export class Tokens {
  readonly #file: string;
  readonly #usageFile: string;
  #entries: TokenEntry[] = [];
  #byHash = new Map<string, TokenEntry>();
  /** mtime + inode of tokens.json when read. Every save is a rename, so a new inode, even within the same second. */
  #version = '';
  #usage: Record<string, string> = {};
  #usageWritten = 0;

  constructor(dataDir: string) {
    this.#file = join(dataDir, 'tokens.json');
    this.#usageFile = join(dataDir, 'token-usage.json');
  }

  /** Reads tokens.json again when it changed (a token was added or revoked from the CLI). */
  async #load(): Promise<void> {
    let version = 'none';
    try {
      const s = await stat(this.#file);
      version = `${s.mtimeMs}:${s.ino}:${s.size}`;
    } catch {
      // no tokens yet
    }
    if (version === this.#version) return;
    this.#version = version;
    this.#entries = (await readJson<{ tokens: TokenEntry[] }>(this.#file, { tokens: [] })).tokens;
    this.#byHash = new Map(this.#entries.map((e) => [e.hash, e]));
  }

  /** The caller for a token, or null when it is unknown, revoked or expired. */
  async verify(token: string, now = new Date()): Promise<Caller | null> {
    if (!/^m(rev|dev)_[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    await this.#load();
    const entry = this.#byHash.get(hash(token));
    if (!entry || !token.startsWith(PREFIX[entry.kind])) return null;
    if (entry.expires && now.toISOString() >= entry.expires) return null;
    this.#usage[entry.hash] = now.toISOString();
    if (now.getTime() - this.#usageWritten > USAGE_WRITE_MS) {
      this.#usageWritten = now.getTime();
      void writeFileAtomic(this.#usageFile, `${JSON.stringify(this.#usage)}\n`).catch(() => {});
    }
    return { kind: entry.kind, name: entry.name };
  }

  /** Creates a token and returns it. It is not stored: show it once. */
  async add(kind: TokenKind, name: string, opts: { expiresInDays?: number; now?: Date } = {}): Promise<string> {
    await this.#load();
    const n = checkName(name);
    if (this.#entries.some((e) => e.name === n)) throw new TokenError(`There is already a token named "${n}". Revoke it first or pick another name.`);
    const now = opts.now ?? new Date();
    const days = opts.expiresInDays;
    if (days !== undefined && (!Number.isInteger(days) || days < 1)) throw new TokenError('Expiry is a whole number of days, for example 30.');
    const token = PREFIX[kind] + randomBytes(32).toString('base64url');
    this.#entries.push({
      kind,
      name: n,
      hash: hash(token),
      created: now.toISOString(),
      expires: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null,
    });
    await this.#save();
    return token;
  }

  /** False when there is no token with that name. */
  async revoke(name: string): Promise<boolean> {
    await this.#load();
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((e) => e.name !== name.trim());
    if (this.#entries.length === before) return false;
    await this.#save();
    return true;
  }

  async list(): Promise<TokenInfo[]> {
    await this.#load();
    const usage = await readJson<Record<string, string>>(this.#usageFile, {});
    return this.#entries.map(({ hash: h, ...rest }) => ({ ...rest, lastUsed: usage[h] ?? null }));
  }

  async #save(): Promise<void> {
    await writeFileAtomic(this.#file, `${JSON.stringify({ tokens: this.#entries }, null, 2)}\n`);
    this.#version = '';
    await this.#load();
  }
}
