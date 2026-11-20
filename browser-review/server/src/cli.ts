#!/usr/bin/env node
// browser-review-mcp: the MCP server Claude Code starts over stdio.
//   claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest
// It talks to the Margin Browser Review extension over ws://127.0.0.1:4777.
// stdout belongs to the MCP protocol: log to stderr only.
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { DEFAULT_PORT, MCP_ADD_COMMAND, MCP_ADD_COMMAND_CODEX } from '@brm/shared';
import { Bridge } from './bridge.ts';
import { buildMcpServer } from './mcp.ts';
import { PROJECT_FILE, readProjectFile } from './project-file.ts';

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

MCP server for the Margin Browser Review browser extension. Your coding agent
starts it over stdio; you don't run it yourself. Add it to your agent once:

  Claude Code:  ${MCP_ADD_COMMAND}
  Codex:        ${MCP_ADD_COMMAND_CODEX}
  Other agents: command "npx", args ["-y", "browser-review-mcp@latest"]

Customer feedback from a margin review hub: add the project in the extension,
and put { "project": "<name>" } in .margin/project.json in your repo so
list_comments shows that project's feedback.

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

// Which review-hub project this repo belongs to, if any (the agent starts us in the repo).
let project: string | null = null;
try {
  project = readProjectFile(process.cwd());
  if (project) log(`project "${project}" from ${PROJECT_FILE}`);
} catch (err) {
  log(err instanceof Error ? err.message : String(err));
}
const server = buildMcpServer(bridge, VERSION, { project });
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
