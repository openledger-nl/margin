// Types and small helpers shared by the MCP process and the extension.
// Keep this file free of Node or DOM APIs: it runs in both places.

export const STATUSES = ['open', 'in_progress', 'review_ready', 'accepted'] as const;
export type Status = (typeof STATUSES)[number];

export const KINDS = ['comment', 'remove', 'edit'] as const;
export type Kind = (typeof KINDS)[number];

/** 'claude' means the coding agent, whichever one it is. The value stays 'claude' so stored comments keep loading. */
export type Author = 'user' | 'claude' | 'system';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

/** Everything we know about the element a comment is pinned to. */
export interface TargetInfo {
  /** Best first. The extension tries them in order to find the element again. */
  selectors: string[];
  tag: string;
  /** Visible text, trimmed and shortened. */
  text: string;
  /** Short piece of outerHTML. */
  html: string;
  /** Position in the viewport when the comment was made. */
  rect: Rect;
  /** React components from outer to inner, for example ["CaseOverview", "EvidenceTable", "Row"]. */
  components: string[];
  /** File that rendered the element, from React's dev stack. Line is approximate. */
  source: string | null;
}

export interface TextChange {
  /** Index among the non-empty text nodes inside the element. */
  index: number;
  before: string;
  after: string;
}

export type Change =
  | { kind: 'remove' }
  | { kind: 'edit'; texts: TextChange[]; css: string };

export interface Message {
  id: number;
  author: Author;
  body: string;
  createdAt: string;
}

export interface Solution {
  note: string;
  files: string[];
  createdAt: string;
}

export type ScreenshotKind = 'page' | 'element';
export type ScreenshotSource = 'initial' | 'capture';

export interface ScreenshotMeta {
  id: number;
  kind: ScreenshotKind;
  source: ScreenshotSource;
  createdAt: string;
}

export interface Comment {
  id: number;
  kind: Kind;
  status: Status;
  /** For example "http://localhost:5173". */
  origin: string;
  /** For example "/cases/12". No query string, no trailing slash (except "/"). */
  path: string;
  /** Full URL when the comment was made. */
  url: string;
  title: string;
  viewport: Viewport;
  target: TargetInfo | null;
  change: Change | null;
  messages: Message[];
  solution: Solution | null;
  screenshots: ScreenshotMeta[];
  createdAt: string;
  updatedAt: string;
}

/** Screenshots travel as PNG data URLs ("data:image/png;base64,..."). */
export interface ScreenshotUpload {
  page?: string;
  element?: string;
}

export interface CreateCommentInput {
  kind: Kind;
  url: string;
  title: string;
  viewport: Viewport;
  target: TargetInfo | null;
  change: Change | null;
  body: string;
  screenshots?: ScreenshotUpload;
}

// ---------- bridge: MCP process <-> extension ----------
//
// Claude Code starts the MCP process (npx browser-review-mcp). It listens on
// ws://127.0.0.1:4777. The extension connects to it and owns all data: the MCP
// process only forwards Claude's tool calls as "call" messages.

/** Every call the MCP process can make, with its params and result. */
export interface BridgeCalls {
  list: { params: { statuses: Status[]; origin?: string }; result: Comment[] };
  get: { params: { id: number }; result: Comment };
  screenshot: {
    params: { id: number; kind: ScreenshotKind; which: 'latest' | 'initial' };
    result: { meta: ScreenshotMeta; dataUrl: string } | null;
  };
  capture: {
    params: { id: number };
    result: { comment: Comment; page: string; element: string | null; note: string | null };
  };
  start_work: { params: { id: number }; result: Comment };
  reply: { params: { id: number; message: string }; result: Comment };
  submit_solution: { params: { id: number; note: string; files: string[] }; result: Comment };
}
export type BridgeMethod = keyof BridgeCalls;

export type ToExtension =
  | { type: 'hello'; version: string }
  | { type: 'call'; id: number; method: BridgeMethod; params: unknown }
  | { type: 'ping' };

export type FromExtension =
  | { type: 'hello'; version: string }
  | { type: 'result'; id: number; ok: true; data: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'pong' };

export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  review_ready: 'Review ready',
  accepted: 'Accepted',
};

export const KIND_LABELS: Record<Kind, string> = {
  comment: 'Comment',
  remove: 'Remove',
  edit: 'Edit',
};

/** Splits a URL into the origin and normalised path used to group comments per page. */
export function pageKey(url: string): { origin: string; path: string } {
  const u = new URL(url);
  let path = u.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return { origin: u.origin, path };
}

/** The visual preview of a remove or edit is only shown while Claude has not delivered a fix yet. */
export function isPreviewActive(c: Pick<Comment, 'kind' | 'status'>): boolean {
  return c.kind !== 'comment' && (c.status === 'open' || c.status === 'in_progress');
}

export const DEFAULT_PORT = 4777;

/** What the user runs once to add the MCP server to Claude Code. */
export const MCP_ADD_COMMAND = 'claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest';

/** The same for Codex. */
export const MCP_ADD_COMMAND_CODEX = 'codex mcp add browser-review -- npx -y browser-review-mcp@latest';

/** For any other MCP client that reads an mcpServers JSON config (Cursor, Gemini CLI and others). */
export const MCP_JSON_CONFIG = `{
  "mcpServers": {
    "browser-review": {
      "command": "npx",
      "args": ["-y", "browser-review-mcp@latest"]
    }
  }
}`;
