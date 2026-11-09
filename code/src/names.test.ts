import { describe, expect, it } from 'vitest';
import { formatMillis, ID_PATTERN, newStamp } from './ids';
import { ledgerConfigDir } from './locate';
import { slugify, uniqueSlug } from './slug';

describe('ids', () => {
  it('are <epoch-millis>-<8 base36 chars> and sort chronologically, even within one millisecond', () => {
    const t = Date.UTC(2026, 10, 9, 10, 15, 0, 123);
    const a = newStamp(t);
    const b = newStamp(t);
    expect(a.id).toMatch(/^\d{13}-[0-9a-z]{8}$/);
    expect(ID_PATTERN.test(a.id)).toBe(true);
    expect(b.id > a.id).toBe(true);
    expect(formatMillis(t)).toBe('2026-11-09T10:15:00.123Z');
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
