// .margin/project.json in the repo the agent works in: which review-hub project
// (customer feedback on staging) belongs to this code base. Only a name, no
// secrets: the developer token stays in the Margin extension, so commit it.
//
//   { "project": "acme-shop" }
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROJECT_FILE = join('.margin', 'project.json');

/** The project name, or null without the file. Throws with a readable message when the file is broken. */
export function readProjectFile(dir: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, PROJECT_FILE), 'utf8');
  } catch {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${PROJECT_FILE} is not valid JSON. It should look like { "project": "acme-shop" }.`);
  }
  const name = (data as { project?: unknown } | null)?.project;
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`${PROJECT_FILE} needs a "project" name, like { "project": "acme-shop" }.`);
  }
  return name.trim();
}
