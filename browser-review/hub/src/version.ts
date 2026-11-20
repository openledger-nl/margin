import { readFileSync } from 'node:fs';

declare const __HUB_VERSION__: string | undefined;

/** Set by build.ts in dist/hub.js; read from package.json when run from source. */
export const VERSION: string =
  typeof __HUB_VERSION__ === 'string'
    ? __HUB_VERSION__
    : (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
