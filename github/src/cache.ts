// The last fetched homepage data per account, so the page shows at once and
// refreshes in the background.
import type { HomeData } from './github.ts';

/** Bump when HomeData changes shape: older caches are then ignored. */
const VERSION = 3;
const key = (login: string) => `cache:v${VERSION}:${login.toLowerCase()}`;

export async function readCache(login: string): Promise<HomeData | null> {
  try {
    const k = key(login);
    const stored = (await chrome.storage.local.get(k)) as Record<string, HomeData | undefined>;
    return stored[k] ?? null;
  } catch {
    return null;
  }
}

export async function writeCache(data: HomeData): Promise<void> {
  try {
    await chrome.storage.local.set({ [key(data.login)]: data });
  } catch {
    // Full or unavailable: the page still works, it just fetches every time.
  }
}
