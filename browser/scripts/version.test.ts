import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bumpVersion, checkMessage, cleanMessage, levelOf } from './version.ts';

describe('levelOf', () => {
  it('fix and perf bump the patch', () => {
    assert.equal(levelOf('fix: keep reply text'), 'patch');
    assert.equal(levelOf('fix(sidebar): keep reply text'), 'patch');
    assert.equal(levelOf('perf: faster pins'), 'patch');
  });
  it('feat bumps the minor', () => {
    assert.equal(levelOf('feat: shortcuts'), 'minor');
    assert.equal(levelOf('feat(extension): shortcuts\n\nAlt+Shift+P and more.'), 'minor');
  });
  it('a ! or BREAKING CHANGE bumps the major', () => {
    assert.equal(levelOf('feat!: new storage format'), 'major');
    assert.equal(levelOf('fix(api)!: drop /v0'), 'major');
    assert.equal(levelOf('refactor: store\n\nBREAKING CHANGE: data dir moved'), 'major');
    assert.equal(levelOf('chore: deps\n\nBREAKING-CHANGE: needs Node 26'), 'major');
  });
  it('other types and git messages do not bump', () => {
    for (const m of ['docs: readme', 'chore: deps', 'refactor: split', 'test: more', 'Merge branch "x"', 'nonsense']) {
      assert.equal(levelOf(m), 'none', m);
    }
  });
});

describe('checkMessage', () => {
  it('accepts Conventional Commits and git-generated messages', () => {
    for (const m of ['feat: x', 'fix(sidebar): x', 'feat!: x', 'chore(deps)!: x', 'Merge branch "main"', 'fixup! feat: x']) {
      assert.equal(checkMessage(m), null, m);
    }
  });
  it('rejects anything else', () => {
    for (const m of ['', 'v1', 'Fix bug', 'feature: x', 'feat:x', 'feat(): x', 'FEAT: x']) {
      assert.notEqual(checkMessage(m), null, m);
    }
  });
});

describe('cleanMessage', () => {
  it('drops git comments and the verbose diff', () => {
    const raw = 'feat: x\n\nbody\n# Please enter the commit message\n# ------------------------ >8 ------------------------\ndiff --git a b\n';
    assert.equal(cleanMessage(raw), 'feat: x\n\nbody');
  });
});

describe('bumpVersion', () => {
  it('follows semver', () => {
    assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
    assert.equal(bumpVersion('0.1.9', 'minor'), '0.2.0');
    assert.equal(bumpVersion('0.2.3', 'major'), '1.0.0');
    assert.throws(() => bumpVersion('1.0.0-beta', 'patch'));
  });
});
