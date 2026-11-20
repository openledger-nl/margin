// Which pages customers looked at (path, title, when, token name), for the
// overview's site map. Kept in memory, written to visits.json.
import { join } from 'node:path';
import { mergeVisit, pageKey, type PageVisit } from '@brm/shared';
import { readJson, writeFileAtomic } from './files.ts';

/** The oldest go first beyond this. */
const MAX_VISITS = 5000;

export class Visits {
  readonly #file: string;
  #list: PageVisit[] = [];
  #saving: Promise<void> = Promise.resolve();

  private constructor(dir: string) {
    this.#file = join(dir, 'visits.json');
  }

  static async open(dir: string): Promise<Visits> {
    const v = new Visits(dir);
    v.#list = await readJson<PageVisit[]>(v.#file, []);
    return v;
  }

  list(): PageVisit[] {
    return this.#list;
  }

  /** One page view by a reviewer. The caller checks the URL is on the staging site. */
  record(by: string, url: string, title: string, at: Date): Promise<void> {
    const { origin, path } = pageKey(url);
    this.#list = mergeVisit(this.#list, { origin, path, title: title.slice(0, 300), by, at: at.toISOString() }, MAX_VISITS);
    const json = `${JSON.stringify(this.#list)}\n`;
    this.#saving = this.#saving.then(() => writeFileAtomic(this.#file, json)).catch(() => {});
    return this.#saving;
  }
}
