import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenError, Tokens } from './tokens.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'margin-tokens-'));
  dirs.push(d);
  return d;
}

describe('Tokens', () => {
  it('creates reviewer and developer tokens that verify to their name and kind', async () => {
    const dir = await tempDir();
    const tokens = new Tokens(dir);
    const anna = await tokens.add('reviewer', 'Anna (client)');
    const andor = await tokens.add('developer', 'Andor');
    assert.match(anna, /^mrev_[A-Za-z0-9_-]{43}$/);
    assert.match(andor, /^mdev_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(await tokens.verify(anna), { kind: 'reviewer', name: 'Anna (client)' });
    assert.deepEqual(await tokens.verify(andor), { kind: 'developer', name: 'Andor' });
    assert.equal(await tokens.verify(`${anna.slice(0, -1)}x`), null);
    assert.equal(await tokens.verify('mrev_short'), null);
  });

  it('stores only hashes, never the tokens themselves', async () => {
    const dir = await tempDir();
    const tokens = new Tokens(dir);
    const secret = await tokens.add('reviewer', 'Anna');
    const file = await readFile(join(dir, 'tokens.json'), 'utf8');
    assert.equal(file.includes(secret), false);
    assert.equal(file.includes(secret.slice(5)), false);
  });

  it('a token with the other prefix does not verify, even with a matching hash entry', async () => {
    const dir = await tempDir();
    const tokens = new Tokens(dir);
    const secret = await tokens.add('reviewer', 'Anna');
    assert.equal(await tokens.verify(`mdev_${secret.slice(5)}`), null);
  });

  it('stops working after revoke and after it expires', async () => {
    const dir = await tempDir();
    const tokens = new Tokens(dir);
    const now = new Date('2026-11-20T12:00:00Z');
    const short = await tokens.add('reviewer', 'Short', { expiresInDays: 30, now });
    assert.ok(await tokens.verify(short, new Date('2026-12-19T12:00:00Z')));
    assert.equal(await tokens.verify(short, new Date('2026-12-20T12:00:00Z')), null);

    const anna = await tokens.add('reviewer', 'Anna');
    assert.equal(await tokens.revoke('Anna'), true);
    assert.equal(await tokens.verify(anna), null);
    assert.equal(await tokens.revoke('Anna'), false);
  });

  it('a second process sees tokens added and revoked by the CLI', async () => {
    const dir = await tempDir();
    const server = new Tokens(dir);
    const cli = new Tokens(dir);
    assert.deepEqual(await server.list(), []);
    const secret = await cli.add('developer', 'Andor');
    assert.ok(await server.verify(secret));
    await cli.revoke('Andor');
    assert.equal(await server.verify(secret), null);
  });

  it('refuses duplicate and empty names', async () => {
    const tokens = new Tokens(await tempDir());
    await tokens.add('reviewer', 'Anna');
    await assert.rejects(tokens.add('developer', 'Anna'), TokenError);
    await assert.rejects(tokens.add('reviewer', '   '), TokenError);
    await assert.rejects(tokens.add('reviewer', 'Bob', { expiresInDays: 0 }), TokenError);
  });
});
