import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bump, changes, highest, levelOf, maxVersion, notes } from './release.ts';

test('the commit type decides the level', () => {
  assert.equal(levelOf('feat(github): side menu'), 'minor');
  assert.equal(levelOf('fix: keep the cache'), 'patch');
  assert.equal(levelOf('perf: fewer requests'), 'patch');
  assert.equal(levelOf('feat!: new storage'), 'major');
  assert.equal(levelOf('fix: x', 'BREAKING CHANGE: settings reset'), 'major');
  assert.equal(levelOf('docs: readme'), 'none');
  assert.equal(levelOf('chore(release): v1.2.0'), 'none');
  assert.equal(levelOf('Merge pull request #2'), 'none');
});

test('the highest level of all commits wins', () => {
  assert.equal(highest(['none', 'patch', 'minor', 'patch']), 'minor');
  assert.equal(highest(['none', 'none']), 'none');
  assert.equal(highest([]), 'none');
});

test('versions bump and compare', () => {
  assert.equal(bump('1.1.0', 'minor'), '1.2.0');
  assert.equal(bump('1.1.3', 'patch'), '1.1.4');
  assert.equal(bump('1.9.2', 'major'), '2.0.0');
  assert.equal(maxVersion('0.4.0', '1.1.0'), '1.1.0');
  assert.equal(maxVersion('1.10.0', '1.9.9'), '1.10.0');
  assert.throws(() => bump('1.0', 'patch'));
});

test('changes are grouped and say which extension they are about', () => {
  const md = changes([
    { subject: 'feat(github): recent pushes in the side menu', body: '', files: ['github/src/sidepanel.ts'] },
    { subject: 'fix: keep reply text', body: '', files: ['browser-review/extension/src/panel.tsx'] },
    { subject: 'docs: readme', body: '', files: ['README.md'] },
    { subject: 'feat: shared icon', body: '', files: ['github/build.ts', 'browser-review/extension/build.ts'] },
  ]);
  assert.match(md, /### New\n\n- \*\*Margin for GitHub:\*\* recent pushes in the side menu\n- \*\*Margin Browser Review, Margin for GitHub:\*\* shared icon/);
  assert.match(md, /### Fixed\n\n- \*\*Margin Browser Review:\*\* keep reply text/);
  assert.doesNotMatch(md, /readme/);
});

test('the notes name the install files', () => {
  const md = notes('1.2.0', []);
  assert.match(md, /version 1\.2\.0/);
  for (const f of ['margin-github-firefox.xpi', 'margin-github-chrome.zip', 'margin-browser-review-firefox.xpi', 'margin-browser-review-chrome.zip']) {
    assert.ok(md.includes(f), f);
  }
  assert.doesNotMatch(md, /## Changes/);
  const unsigned = notes('1.2.0', [], false);
  assert.ok(unsigned.includes('margin-github-firefox.zip') && !unsigned.includes('.xpi'));
});
