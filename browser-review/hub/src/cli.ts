#!/usr/bin/env node
// margin-hub: the review hub server, and the commands to manage its tokens.
// In Docker: `docker compose exec margin margin token add --reviewer "Anna (client)"`.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from '@brm/shared';
import { createHandler } from './app.ts';
import { ConfigError, readConfig, type Config } from './config.ts';
import { FsDb } from './fs-db.ts';
import { loadOverlay } from './overlay.ts';
import { TokenError, Tokens, type TokenKind } from './tokens.ts';
import { VERSION } from './version.ts';

const HELP = `margin-hub ${VERSION}: the Margin review hub

Customers leave feedback on your staging site through a personal link; you pull
it into the Margin extension with a developer token.

Commands (in Docker: docker compose exec margin margin <command>):
  serve                                        run the hub (the default)
  token add --reviewer "<name>" [--expires <days>] [--path /page]
                                               a review link for a customer
  token add --developer "<name>" [--expires <days>]
                                               a token for a developer's Margin extension
  token list                                   all tokens, without the secrets
  token revoke "<name>"                        stop a token working, right away
  sri                                          the <script> tag for your staging site

Environment:
  MARGIN_PROJECT   project name, for example acme-shop            (required)
  MARGIN_ORIGIN    the staging site, https://staging.acme.com      (required)
  MARGIN_DATA      data folder, default /data/.margin (a volume, never the webroot)
  PORT             default 4780
  MARGIN_COMMENTS_PER_HOUR   per review token, default 60`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} needs a value.`);
  return value;
}

function overlayPath(): string {
  return process.env.MARGIN_OVERLAY ?? fileURLToPath(new URL('./public/margin.js', import.meta.url));
}

async function serve(config: Config): Promise<void> {
  const db = await FsDb.open(config.dataDir, config.project);
  const store = new Store(db);
  const tokens = new Tokens(config.dataDir);
  const overlay = await loadOverlay(overlayPath());
  const server = createServer(createHandler({ config, store, db, tokens, overlay }));
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const log = (msg: string) => console.error(`[margin-hub] ${msg}`);
  log(`${VERSION} serving project "${config.project}" for ${config.origin} on ${config.host}:${config.port}`);
  log(`data in ${config.dataDir}`);
  log(overlay ? `margin.js ${overlay.integrity}` : 'built without margin.js (the staging overlay)');
  if ((await tokens.list()).length === 0) log('no tokens yet: create one with `margin token add --reviewer "<name>"`');
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

async function token(config: Config, args: string[]): Promise<void> {
  const tokens = new Tokens(config.dataDir);
  const [sub, ...rest] = args;
  if (sub === 'add') {
    const reviewer = option(rest, '--reviewer');
    const developer = option(rest, '--developer');
    if ((reviewer === undefined) === (developer === undefined)) fail('Use either --reviewer "<name>" or --developer "<name>".');
    const kind: TokenKind = reviewer !== undefined ? 'reviewer' : 'developer';
    const expires = option(rest, '--expires');
    const days = expires === undefined ? undefined : Number(expires.replace(/d$/, ''));
    const secret = await tokens.add(kind, (reviewer ?? developer)!, days === undefined ? {} : { expiresInDays: days });
    if (kind === 'reviewer') {
      const path = option(rest, '--path') ?? '/';
      if (!path.startsWith('/')) fail('--path starts with /, for example --path /pricing');
      const link = new URL(path, config.origin);
      link.searchParams.set('review_token', secret);
      console.log(`Review link for ${reviewer}${days ? ` (valid ${days} days)` : ''}:\n\n  ${link.href}\n\nSend it to them. It is shown only this once.`);
    } else {
      console.log(
        `Developer token for ${developer}${days ? ` (valid ${days} days)` : ''}:\n\n  ${secret}\n\n` +
          `In the Margin extension: Projects, Add, then paste the hub URL and this token.\nIt is shown only this once.`,
      );
    }
    return;
  }
  if (sub === 'list') {
    const list = await tokens.list();
    if (list.length === 0) return console.log('No tokens yet.');
    for (const t of list) {
      const expires = t.expires ? `expires ${t.expires.slice(0, 10)}` : 'no expiry';
      console.log(`${t.kind.padEnd(9)}  ${t.name.padEnd(28)}  created ${t.created.slice(0, 10)}  ${expires}  last used ${t.lastUsed?.slice(0, 16).replace('T', ' ') ?? 'never'}`);
    }
    return;
  }
  if (sub === 'revoke') {
    const name = rest[0];
    if (!name) fail('Which token? margin token revoke "<name>"');
    if (!(await tokens.revoke(name))) fail(`No token named "${name}". See margin token list.`);
    console.log(`Revoked "${name}". It stops working right away.`);
    return;
  }
  fail('Use token add, token list or token revoke. See margin --help.');
}

async function sri(): Promise<void> {
  const overlay = await loadOverlay(overlayPath());
  if (!overlay) fail('This hub was built without margin.js (the staging overlay).');
  console.log(`Quick, always this hub's current version:
  <script src="/__margin/margin.js" defer></script>

Pinned to ${VERSION}, the browser checks the file:
  <script src="/__margin/margin-${VERSION}.js" integrity="${overlay.integrity}" crossorigin="anonymous" defer></script>`);
}

const [command = 'serve', ...args] = process.argv.slice(2);
if (command === '--version' || command === '-v') {
  console.log(VERSION);
} else if (command === '--help' || command === '-h' || command === 'help') {
  console.log(HELP);
} else {
  try {
    const config = readConfig(process.env);
    if (command === 'serve') await serve(config);
    else if (command === 'token') await token(config, args);
    else if (command === 'sri') await sri();
    else fail(`Unknown command "${command}". See margin --help.`);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof TokenError) fail(err.message);
    throw err;
  }
}
