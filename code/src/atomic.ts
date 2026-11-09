// Atomic writes: a temp file whose name starts with "." (Ledger ignores dotfiles) in the same folder, renamed over
// the target. Ledger and its sync never see half a file.
import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
  try {
    await renameWithRetry(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** On Windows a rename over a file that another program (a sync, a virus scanner) has open fails for a moment. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 6 || !RETRYABLE.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}
