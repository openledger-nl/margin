import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProjectFile } from './project-file.ts';

function repo(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'brm-project-'));
  if (content !== undefined) {
    mkdirSync(join(dir, '.margin'));
    writeFileSync(join(dir, '.margin', 'project.json'), content);
  }
  return dir;
}

describe('readProjectFile', () => {
  it('reads the project name', () => {
    assert.equal(readProjectFile(repo('{ "project": " acme-shop " }')), 'acme-shop');
  });
  it('is null without the file', () => {
    assert.equal(readProjectFile(repo()), null);
  });
  it('says what is wrong with a broken file', () => {
    assert.throws(() => readProjectFile(repo('{ project: acme }')), /not valid JSON/);
    assert.throws(() => readProjectFile(repo('{ "name": "acme" }')), /needs a "project" name/);
  });
});
