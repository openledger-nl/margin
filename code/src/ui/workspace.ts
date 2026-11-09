// What the window offers: the Ledger vault (asking for it when it can't be found), the workspace's git
// repositories, and a QuickPick that can start on a suggested item.
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Git } from '../git';
import { pathKey } from '../paths';
import { locateVault } from '../locate';
import { Vault } from '../vault';

export function vaultSetting(): string | undefined {
  return vscode.workspace.getConfiguration('margin').get<string>('vaultPath');
}

/** The vault without asking anything: undefined when it can't be found. */
export async function quietVault(): Promise<Vault | undefined> {
  const located = await locateVault({ setting: vaultSetting(), env: process.env, platform: process.platform, homedir: homedir() });
  return located.ok ? new Vault(located.path) : undefined;
}

/** The vault, or a plain message saying why there is none, with a way to set margin.vaultPath. */
export async function requireVault(): Promise<Vault | undefined> {
  const located = await locateVault({ setting: vaultSetting(), env: process.env, platform: process.platform, homedir: homedir() });
  if (located.ok) return new Vault(located.path);
  const choose = 'Choose Vault Folder…';
  const settings = 'Open Settings';
  const answer = await vscode.window.showErrorMessage(`Margin can't find your Ledger vault. ${located.reason}`, choose, settings);
  if (answer === choose) return chooseVault();
  if (answer === settings) await vscode.commands.executeCommand('workbench.action.openSettings', 'margin.vaultPath');
  return undefined;
}

/** Asks for the vault folder and keeps it in margin.vaultPath (a per-machine setting). */
export async function chooseVault(): Promise<Vault | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Use as Ledger Vault',
    title: 'The folder of your Ledger vault (it has a projects folder)',
  });
  const folder = picked?.[0]?.fsPath;
  if (!folder) return undefined;
  await vscode.workspace.getConfiguration('margin').update('vaultPath', folder, vscode.ConfigurationTarget.Global);
  return new Vault(folder);
}

interface GitExtensionApi {
  repositories: { rootUri: vscode.Uri }[];
}

/** Repositories the built-in git extension knows about (it also finds nested ones), if it is enabled. */
async function gitExtensionRoots(): Promise<string[]> {
  const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitExtensionApi }>('vscode.git');
  if (!extension) return [];
  try {
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1).repositories.map((r) => r.rootUri.fsPath);
  } catch {
    return [];
  }
}


/** The git repositories of the workspace's folders, each once. */
export async function workspaceRepos(git: Git): Promise<string[]> {
  const found = new Map<string, string>();
  const folders = vscode.workspace.workspaceFolders ?? [];
  const tops = await Promise.all(folders.filter((f) => f.uri.scheme === 'file').map((f) => git.toplevel(f.uri.fsPath)));
  for (const top of [...tops, ...(await gitExtensionRoots())]) {
    if (top && !found.has(pathKey(top))) found.set(pathKey(top), path.resolve(top));
  }
  return [...found.values()];
}

export interface PickOptions<T> {
  title: string;
  placeholder?: string;
  /** The item to start on. */
  active?: T;
}

/** A QuickPick that starts on `active`, and resolves to undefined when dismissed. */
export function pick<T extends vscode.QuickPickItem>(items: readonly T[], options: PickOptions<T>): Promise<T | undefined> {
  const qp = vscode.window.createQuickPick<T>();
  qp.title = options.title;
  qp.placeholder = options.placeholder;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = items;
  if (options.active) qp.activeItems = [options.active];
  return new Promise((resolve) => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0] ?? qp.activeItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
}

export function separator(label: string): vscode.QuickPickItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
