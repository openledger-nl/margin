// Loads the extension against a stand-in `vscode` (see vitest.config.mts) and checks that what package.json
// promises is what the code registers. This can't show a UI; it catches wiring mistakes.
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { describe, expect, it } from 'vitest';
import { activate } from './extension';
import { createdViews, registeredCommands, registeredSchemes } from './test/vscode';
import { parseSideUri, sideUri } from './ui/uris';

interface Manifest {
  main: string;
  engines: { vscode: string };
  activationEvents: string[];
  contributes: {
    commands: { command: string }[];
    views: Record<string, { id: string }[]>;
    menus: Record<string, { command: string; when?: string }[]>;
  };
  devDependencies: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest;
const contributed = manifest.contributes.commands.map((c) => c.command);

describe('extension', () => {
  activate({
    subscriptions: [],
    workspaceState: { get: () => undefined, update: async () => undefined },
    globalStorageUri: { fsPath: '' },
  } as never);

  it('registers every command it contributes, and nothing else', () => {
    expect([...registeredCommands.keys()].sort()).toEqual([...contributed].sort());
  });

  it('only puts contributed commands in menus', () => {
    for (const [menu, items] of Object.entries(manifest.contributes.menus)) {
      for (const item of items) expect(contributed, `${menu}: ${item.command}`).toContain(item.command);
    }
  });

  it('creates the view it contributes and serves the margin: scheme', () => {
    const views = Object.values(manifest.contributes.views).flat().map((v) => v.id);
    expect(createdViews).toEqual(views);
    expect(registeredSchemes).toContain('margin');
    expect(manifest.activationEvents).toContain('onFileSystem:margin');
  });

  it('does not build against a newer VS Code API than it says it needs', () => {
    const types = manifest.devDependencies['@types/vscode']?.replace(/^[\^~]/, '');
    expect(manifest.engines.vscode).toBe(`^${types}`);
  });
});

describe('margin: URIs', () => {
  it('round-trip a side of a file, whatever the path holds', () => {
    for (const path of ['src/a.ts', 'dir with space/ü#?%.md', '.github/workflows/ci.yml']) {
      const ref = { root: 'C:\\Users\\me\\repo #1', sha: 'a'.repeat(40), side: 'old' as const, path };
      const uri = sideUri(ref);
      expect(parseSideUri(uri)).toEqual(ref);
      // The same file and side always give the same URI: threads and documents meet on it.
      expect(sideUri(ref).toString()).toBe(uri.toString());
      expect(parseSideUri(vscode.Uri.parse(uri.toString()))).toEqual(ref);
    }
  });
});
