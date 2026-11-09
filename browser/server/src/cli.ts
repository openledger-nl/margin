#!/usr/bin/env node
// browser-review-mcp: the MCP server Claude Code starts over stdio.
//   claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest
// It talks to the Browser Review extension over ws://127.0.0.1:4777.
// stdout belongs to the MCP protocol: log to stderr only.
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { DEFAULT_PORT, MCP_ADD_COMMAND } from '@brm/shared';
import { Bridge } from './bridge.ts';
import { buildMcpServer } from './mcp.ts';

/** From package.json, which scripts/version.ts keeps in step with the root version. */
const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  console.log(VERSION);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(`browser-review-mcp ${VERSION}

MCP server for the Browser Review browser extension. Claude Code starts it;
you don't run it yourself. Add it to Claude Code once with:

  ${MCP_ADD_COMMAND}

Environment: BRM_PORT (default ${DEFAULT_PORT}, the extension expects ${DEFAULT_PORT}).`);
  process.exit(0);
}

const port = Number(process.env.BRM_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`BRM_PORT is not a valid port: ${process.env.BRM_PORT}`);
  process.exit(1);
}

const log = (msg: string) => console.error(`[browser-review] ${msg}`);
const bridge = new Bridge({ port, version: VERSION, log });
void bridge.start(); // in the background: Claude Code must get its answer to "initialize" right away

const server = buildMcpServer(bridge, VERSION);
const transport = new StdioServerTransport();

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await bridge.close().catch(() => {});
  process.exit(0);
}
// Claude Code closes stdin when the session ends.
process.stdin.on('close', () => void shutdown());
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => void shutdown());

await server.connect(transport);
log(`MCP server ${VERSION} ready`);
