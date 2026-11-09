// Finding the Ledger vault:
//   1. the `margin.vaultPath` setting;
//   2. else the LEDGER_VAULT environment variable;
//   3. else `vaultPath` in config.json in Ledger's config folder for the app id nl.openledger.ledger
//      (LEDGER_CONFIG_DIR, when set, replaces that folder);
//   4. else Ledger's own default: `Ledger` in the user's Documents folder, or `vault` in Ledger's config folder
//      when there is no Documents folder (settings::resolve_vault in Ledger). Only when that folder exists.
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { documentsDir } from './documents';

export const LEDGER_APP_ID = 'nl.openledger.ledger';

export interface LocateInput {
  setting: string | undefined;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homedir: string;
  /** The Documents folder; by default the one Ledger would use (see documents.ts). */
  documents?: () => Promise<string | undefined>;
}

export type VaultSource = 'setting' | 'env' | 'config' | 'default';

export type Located =
  | { ok: true; path: string; source: VaultSource }
  | { ok: false; reason: string };

/** Ledger's config folder, the way Tauri's app_config_dir finds it. */
export function ledgerConfigDir(input: Omit<LocateInput, 'setting'>): string {
  const { env, platform, homedir } = input;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (env.LEDGER_CONFIG_DIR) return env.LEDGER_CONFIG_DIR;
  if (platform === 'win32') return p.join(env.APPDATA || p.join(homedir, 'AppData', 'Roaming'), LEDGER_APP_ID);
  if (platform === 'darwin') return p.join(homedir, 'Library', 'Application Support', LEDGER_APP_ID);
  const xdg = env.XDG_CONFIG_HOME && p.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : p.join(homedir, '.config');
  return p.join(xdg, LEDGER_APP_ID);
}

export function expandHome(value: string, homedir: string): string {
  if (value === '~') return homedir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir, value.slice(2));
  return value;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

const FROM: Record<Exclude<VaultSource, 'default'>, string> = {
  setting: 'The margin.vaultPath setting',
  env: 'LEDGER_VAULT',
  config: "Ledger's config.json",
};

/** Where the vault is, and where that came from; or why there is none. The first source that names one wins. */
export async function locateVault(input: LocateInput): Promise<Located> {
  const named = await namedVault(input);
  if (named) {
    if (!(await isDirectory(named.path))) {
      return { ok: false, reason: `${FROM[named.source]} points to ${named.path}, which isn't a folder on this machine.` };
    }
    return { ok: true, ...named };
  }

  // 4. Nothing names a vault: Ledger then uses its default, and so does Margin, once Ledger has made it.
  const documents = await (input.documents ?? (() => documentsDir(input)))();
  const fallback = documents ? path.join(documents, 'Ledger') : path.join(ledgerConfigDir(input), 'vault');
  if (await isDirectory(fallback)) return { ok: true, path: fallback, source: 'default' };
  return {
    ok: false,
    reason: `margin.vaultPath, LEDGER_VAULT and Ledger's config.json name no vault, and Ledger's default vault (${fallback}) isn't there.`,
  };
}

/** The vault the setting, LEDGER_VAULT or Ledger's config.json names, if one does. */
async function namedVault(input: LocateInput): Promise<{ path: string; source: Exclude<VaultSource, 'default'> } | undefined> {
  const setting = input.setting?.trim();
  if (setting) return { path: path.resolve(expandHome(setting, input.homedir)), source: 'setting' };

  const env = input.env.LEDGER_VAULT?.trim();
  if (env) return { path: path.resolve(env), source: 'env' };

  // Read the way Ledger reads it: a missing or unreadable config.json, or one without a vaultPath text, names none.
  const text = await readFile(path.join(ledgerConfigDir(input), 'config.json'), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  let vaultPath: unknown;
  try {
    vaultPath = (JSON.parse(text) as { vaultPath?: unknown } | null)?.vaultPath;
  } catch {
    return undefined;
  }
  if (typeof vaultPath !== 'string' || vaultPath.trim() === '') return undefined;
  return { path: path.resolve(vaultPath.trim()), source: 'config' };
}
