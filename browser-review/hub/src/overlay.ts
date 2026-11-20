// margin.js, the overlay for the staging site, read once at startup.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface Overlay {
  code: Buffer;
  /** For the integrity attribute: "sha384-…". */
  integrity: string;
}

/** Null when the file is not there (a hub built without the overlay). */
export async function loadOverlay(path: string): Promise<Overlay | null> {
  let code: Buffer;
  try {
    code = await readFile(path);
  } catch {
    return null;
  }
  return { code, integrity: `sha384-${createHash('sha384').update(code).digest('base64')}` };
}
