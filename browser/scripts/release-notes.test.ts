import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { changes, notes } from './release-notes.ts';

describe('release notes', () => {
  it('groups user-facing changes and leaves out the rest', () => {
    const md = changes([
      { subject: 'feat(overlay): keyboard shortcuts', body: '' },
      { subject: 'fix: keep reply drafts', body: '' },
      { subject: 'feat!: comments live in the extension', body: '' },
      { subject: 'refactor: split store', body: 'BREAKING CHANGE: data moved' },
      { subject: 'docs: readme', body: '' },
      { subject: 'chore: deps', body: '' },
      { subject: 'v1', body: '' },
    ]);
    assert.equal(
      md,
      [
        '### Breaking changes',
        '- comments live in the extension',
        '- split store',
        '',
        '### New',
        '- **overlay:** keyboard shortcuts',
        '',
        '### Fixed',
        '- keep reply drafts',
        '',
      ].join('\n'),
    );
  });

  it('says so when nothing user-facing changed', () => {
    assert.equal(changes([{ subject: 'docs: typo', body: '' }]), 'Maintenance release.\n');
  });

  it('names the assets of this version', () => {
    const md = notes('1.2.3', []);
    assert.match(md, /browser-review-1\.2\.3-chrome\.zip/);
    assert.match(md, /browser-review-1\.2\.3-firefox\.zip/);
    assert.match(md, /npx -y --package=https:\/\/\S+\/releases\/download\/v1\.2\.3\/browser-review-mcp-1\.2\.3\.tgz browser-review-mcp/);
  });
});
