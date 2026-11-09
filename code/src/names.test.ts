import { describe, expect, it } from 'vitest';
import { createIds, fixedIds, formatMillis, ID_PATTERN } from './ids';
import { ledgerConfigDir } from './locate';
import { isInside, samePath } from './paths';
import { slugify, uniqueSlug } from './slug';

describe('ids', () => {
  it('are <epoch-millis>-<8 base36 chars> and sort chronologically, even within one millisecond', () => {
    const t = Date.UTC(2026, 10, 9, 10, 15, 0, 123);
    const ids = createIds(() => t);
    const a = ids.stamp();
    const b = ids.stamp();
    expect(a.id).toMatch(/^\d{13}-[0-9a-z]{8}$/);
    expect(ID_PATTERN.test(a.id)).toBe(true);
    expect(b.id > a.id).toBe(true);
    expect(formatMillis(t)).toBe('2026-11-09T10:15:00.123Z');
  });

  it('can come from a fixed clock and seed, the same every time', () => {
    const start = Date.UTC(2026, 10, 9, 10, 0, 0, 0);
    const run = () => {
      const ids = fixedIds(start, 1500);
      return { a: ids.stamp(), now: ids.now(), b: ids.stamp() };
    };
    const { a, now, b } = run();
    expect(run()).toEqual({ a, now, b });
    expect(a.at).toBe('2026-11-09T10:00:00.000Z');
    expect(now).toBe('2026-11-09T10:00:01.500Z');
    expect(b.id).toMatch(/^1794218403000-[0-9a-z]{8}$/);
    expect(a.id.slice(-8)).not.toBe(b.id.slice(-8));
  });
});

describe('slugify', () => {
  it('matches Ledger', () => {
    expect(slugify('margin: feat/code')).toBe('margin-feat-code');
    expect(slugify('  Hello,   World!  ')).toBe('hello-world');
    expect(slugify('Café au lait')).toBe('caf-au-lait');
    expect(slugify('---')).toBe('thread');
    expect(slugify('')).toBe('thread');
    expect(slugify('ÉCOLE 2')).toBe('cole-2');
  });

  it('adds -2, -3… when taken', () => {
    const taken = new Set(['a', 'a-2']);
    expect(uniqueSlug('a', (s) => taken.has(s))).toBe('a-3');
    expect(uniqueSlug('b', (s) => taken.has(s))).toBe('b');
  });
});

describe("Ledger's config folder", () => {
  it('follows Tauri per platform, and LEDGER_CONFIG_DIR replaces it', () => {
    expect(ledgerConfigDir({ env: { APPDATA: 'C:\\Users\\m\\AppData\\Roaming' }, platform: 'win32', homedir: 'C:\\Users\\m' })).toBe(
      'C:\\Users\\m\\AppData\\Roaming\\nl.openledger.ledger',
    );
    expect(ledgerConfigDir({ env: {}, platform: 'darwin', homedir: '/Users/m' })).toBe('/Users/m/Library/Application Support/nl.openledger.ledger');
    expect(ledgerConfigDir({ env: {}, platform: 'linux', homedir: '/home/m' })).toBe('/home/m/.config/nl.openledger.ledger');
    expect(ledgerConfigDir({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', homedir: '/home/m' })).toBe('/x/nl.openledger.ledger');
    expect(ledgerConfigDir({ env: { XDG_CONFIG_HOME: 'relative' }, platform: 'linux', homedir: '/home/m' })).toBe('/home/m/.config/nl.openledger.ledger');
    expect(ledgerConfigDir({ env: { LEDGER_CONFIG_DIR: '/tmp/cfg' }, platform: 'linux', homedir: '/home/m' })).toBe('/tmp/cfg');
  });
});

describe('paths', () => {
  it('compare the way the file system does', () => {
    expect(samePath('C:\\Vault\\a.md', 'c:\\vault\\A.md', 'win32')).toBe(true);
    expect(isInside('c:\\vault\\projects\\p', 'C:\\Vault', 'win32')).toBe(true);
    expect(isInside('C:\\Vault2\\x', 'C:\\Vault', 'win32')).toBe(false);
    expect(isInside('C:\\Vault', 'C:\\Vault', 'win32')).toBe(false);
    expect(samePath('/home/m/Vault', '/home/m/vault', 'linux')).toBe(false);
    expect(isInside('/home/m/vault/x', '/home/m/vault/', 'linux')).toBe(true);
  });
});
