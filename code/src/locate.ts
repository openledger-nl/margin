// Finding the Ledger vault:
//   1. the `margin.vaultPath` setting;
//   2. else the LEDGER_VAULT environment variable;
//   3. else `vaultPath` in config.json in Ledger's config folder for the app id nl.openledger.ledger
//      (LEDGER_CONFIG_DIR, when set, replaces that folder).
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';

export const LEDGER_APP_ID = 'nl.openledger.ledger';

export interface LocateInput {
  setting: string | undefined;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homedir: string;
}

export type VaultSource = 'setting' | 'env' | 'config';

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

/** Where the vault is, and where that came from; or why there is none. The first source that names one wins. */
export async function locateVault(input: LocateInput): Promise<Located> {
  const chosen = await choose(input);
  if (!chosen.ok) return chosen;
  if (!(await isDirectory(chosen.path))) {
    const from =
      chosen.source === 'setting' ? 'The margin.vaultPath setting' : chosen.source === 'env' ? 'LEDGER_VAULT' : "Ledger's config.json";
    return { ok: false, reason: `${from} points to ${chosen.path}, which isn't a folder on this machine.` };
  }
  return chosen;
}

async function choose(input: LocateInput): Promise<Located> {
  const setting = input.setting?.trim();
  if (setting) return { ok: true, path: path.resolve(expandHome(setting, input.homedir)), source: 'setting' };

  const env = input.env.LEDGER_VAULT?.trim();
  if (env) return { ok: true, path: path.resolve(env), source: 'env' };

  const configFile = path.join(ledgerConfigDir(input), 'config.json');
  let text: string;
  try {
    text = await readFile(configFile, 'utf8');
  } catch {
    return { ok: false, reason: `No vault is set: margin.vaultPath and LEDGER_VAULT are empty, and Ledger's ${configFile} isn't there.` };
  }
  let vaultPath: unknown;
  try {
    vaultPath = (JSON.parse(text) as { vaultPath?: unknown }).vaultPath;
  } catch {
    return { ok: false, reason: `Ledger's ${configFile} isn't valid JSON.` };
  }
  if (typeof vaultPath !== 'string' || vaultPath.trim() === '') {
    return { ok: false, reason: `Ledger's ${configFile} has no vaultPath. Ledger may be using its default vault; set margin.vaultPath to it.` };
  }
  return { ok: true, path: path.resolve(vaultPath.trim()), source: 'config' };
}
