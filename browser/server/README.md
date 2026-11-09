# browser-review-mcp

The MCP server for **Browser Review**, a browser extension for Brave, Chrome and Firefox.
You review your localhost dev app like you would in Figma: comment on an
element, remove it, or edit its text and CSS. Claude Code picks each one up as a
task, fixes it in your code and marks it ready for your review.

## Setup

1. Install the Browser Review extension.
2. Add this server to Claude Code, once:

   ```sh
   claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest
   ```

That's all. Claude Code starts the server with each session, and the
extension connects to it by itself. The extension's help page (right-click its
icon, **Options**) shows whether it is connected.

Needs Node.js 20 or newer.

## Use

Leave comments in the browser, then tell Claude Code in your app's project:

> Check the review comments.

## Tools

| Tool | What it does |
|---|---|
| `list_comments` | List comments. Default: open and in progress. Filter by status or site. |
| `get_comment` | Everything about one comment: page, selectors, HTML, React components, source file, requested change, thread, solution, plus the screenshot. |
| `get_screenshot` | A stored page or element screenshot. |
| `capture_screenshot` | A fresh screenshot from the open tab, to check a fix. |
| `start_work` | Set to In progress. |
| `reply` | Write in the thread, for example to ask a question. |
| `submit_solution` | Set to Review ready with a note and the changed files. |

## How it works

The comments live in the extension (in your browser profile). This server is a
bridge: it listens on `ws://127.0.0.1:4777`, the extension connects to it, and
Claude's tool calls go through. Only the extension (a `chrome-extension://`
origin) and other local Browser Review processes may connect; websites can't.
With several Claude Code sessions open, the first one holds the port and the
others go through it.

`BRM_PORT` changes the port, but the extension expects 4777.

## License

MIT
