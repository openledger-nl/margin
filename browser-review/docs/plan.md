# browser-review-mcp: plan

Status: v0.2 built and tested. The MCP server moved to npm (`browser-review-mcp`, started by Claude Code), the data moved into the extension.
Repo: https://github.com/andor00/browser-review-mcp. Setup guide: README.md.

## Goal

A Brave extension for reviewing my own dev apps on localhost. I leave comments
on the page (general or pinned to an element), hide elements or edit them in
place, and Claude picks the comments up over MCP, fixes them in code, and writes
back how it solved each one. I accept the solution in the browser.

Only for me, on this machine. Only localhost sites.

## The two parts

```
Brave extension  <---- WebSocket ---->  browser-review-mcp  <-- MCP (stdio) -->  Claude Code
(overlay, sidebar,                      (127.0.0.1:4777,                         (starts it
 data in IndexedDB)                      a bridge, no data)                       per session)
```

Everything is TypeScript (strict), Node 26 for development (pinned in `.nvmrc`),
pnpm workspaces.

1. **Extension** (Manifest V3). The UI runs only on `http://localhost/*` and
   `http://127.0.0.1/*`. Built with esbuild (content scripts must be one plain
   script file each, esbuild does that with no plugins). UI in Preact inside a
   Shadow DOM. The background worker **owns all data**: comments, threads and
   screenshots in IndexedDB (`store.ts` over `idb.ts`). So reviewing works with
   no Claude session open.
2. **browser-review-mcp** (npm package, `server/`). Works like Browser MCP:
   Claude Code starts it over stdio with each session, so I never start a
   server myself. Added once with:
   `claude mcp add --scope user browser-review -- npx -y browser-review-mcp@latest`

   It is only a bridge. It listens on `ws://127.0.0.1:4777`; the extension
   connects there and answers Claude's tool calls from its store (the calls are
   typed in `shared/`, `BridgeCalls`). Bundled with esbuild into one
   `dist/cli.js` so `npx` installs nothing else. Needs Node 20+.

   Several Claude Code sessions: the first process to get the port is the hub;
   the others connect to it on `/peer` and send their calls through it. When the
   hub's session ends, a peer takes the port over and the extension reconnects
   (it retries every few seconds).

   Security: binds to 127.0.0.1 only, checks `Host` (DNS rebinding), accepts
   `/ws` only from a `chrome-extension://` origin and `/peer` only from
   non-browser clients (no Origin, no Sec-Fetch headers). Websites get a 403.

Why not run the MCP server inside the extension: Claude Code is a separate
program and needs a process or a local address to talk to; an extension can't
listen on a port. Browser MCP solves it the same way.

### Why the extension asks for "all sites"

Chrome only allows `captureVisibleTab` (the screenshot API) with the
`<all_urls>` permission or a fresh click on the extension icon. Claude asking
for a fresh screenshot over MCP has no click, so the extension needs
`<all_urls>`. The content scripts (the overlay, picker, previews) still only
run on localhost. Nothing runs on other sites.

## What I can do in the browser

A small toolbar sits in the bottom right corner. The extension icon or
Alt+Shift+R shows the overlay with the threads sidebar open; again hides it.
The sidebar's open state is remembered per site.

Shortcuts: Alt+Shift+P pick an element, Alt+Shift+C page comment, Alt+Shift+T
open or close the threads. They also bring a hidden overlay back.

- **Comment on the page.** A general comment for the current page.
- **Comment on an element.** Pick an element, write a comment. A numbered pin
  appears on it. Pins follow the element when the page scrolls or resizes.
- **Element picker** (like the uBlock picker): hover highlights, mouse wheel or
  arrow up/down go to parent / child, click selects, Esc cancels.
- **Remove an element.** It disappears right away and stays gone on reload
  (re-applied when the SPA re-renders). Every removal has an undo in the
  sidebar. A removal is always a task for Claude: remove it in code.
- **Edit an element.** Change its texts (one box per text in the element, live
  preview) and add CSS (live preview). Same as removal: preview stays on
  reload, undo possible, task for Claude.
- **Sidebar.** All threads for this page or the whole site, filtered by status.
  Reply in threads. Claude's replies and solution notes show up live. Shows
  when the server is not running.
- **Go to.** Every thread has Go to (scroll to the element; on another page,
  open that page first and then show it; when the element is gone, land on the
  page with a note) and Open page.
- **Drafts survive reloads.** An unsaved comment, removal or edit (with the
  picked element) and unsent replies are kept in the tab's sessionStorage and
  come back after the app reloads (dev server restart, full HMR reload, F5).
- **Not localhost.** On other pages the extension icon and shortcuts open a
  small popup: it only works on localhost, with buttons for the open localhost
  tabs. On a localhost tab opened before the extension loaded, it asks to
  reload the page.

## Statuses

| Status | Who sets it | Meaning |
|---|---|---|
| open | me (on create, or when I reopen) | waiting for Claude |
| in progress | Claude | Claude is working on it |
| review ready | Claude | fixed, solution note written, waiting for me |
| accepted | me (button "Accept solution") | done |

Claude can only move to `in progress` and `review ready`. Moving to
`review ready` needs a short solution note (what was wrong, what changed,
which files). From `review ready` I accept, or reopen with a reply.

The visual preview (hidden element, edited text) is only on while the status is
`open` or `in progress`. When Claude says it's review ready, the preview turns
off so I see the real result from the code, not my preview.

## What a comment stores

- page URL (origin + path, the query string is kept but not used for grouping),
  page title, viewport size
- for element comments: several selectors (data-testid, id, aria-label, then a
  CSS path as last resort), the element's text, a short piece of its HTML, its
  size and position
- the React component chain above the element (for example
  `CaseOverview > EvidenceTable > Row`), read from React's fiber in dev mode
- a source hint: the file that rendered the element, read from React 19's dev
  stack (`_debugStack`). The file is reliable, the line number is approximate.
  No change to the app needed.
- screenshots: the visible part of the page with the element outlined, plus a
  crop of just the element
- for removals and edits: what changed (before / after)
- the thread: my messages, Claude's replies, status changes, the solution note

## MCP tools for Claude

- `list_comments(status?, origin?)` short list. Default: open + in progress.
- `get_comment(id)` everything above, the full thread
- `get_screenshot(id, kind)` the stored screenshot (page or element) as an
  image
- `capture_screenshot(id)` a fresh screenshot right now: the server asks the
  extension, which finds an open tab on that page, switches to it, scrolls the
  element into view and captures it. Lets Claude check its own fix. Fails
  clearly if no tab is open.
- `start_work(id)` sets `in progress`
- `reply(id, message)` a question or update in the thread
- `submit_solution(id, note, files?)` sets `review ready` with the note

Workflow: I say "check the review comments", Claude calls `list_comments`,
picks them up one by one.

## Folder layout

```
browser-review-mcp/
  docs/plan.md
  shared/             types shared by server and extension
  server/             browser-review-mcp (MCP over stdio, WebSocket bridge to the extension)
  extension/          MV3 extension (background, content script, main-world probe)
  package.json        pnpm workspaces, engines: node >= 26
  pnpm-workspace.yaml
  .nvmrc              26
  tsconfig.base.json  strict, shared by all three
```

## Decisions on the open questions

1. Source file: done with React's dev stack, no Vite plugin in pv-designer.
2. Port: 4777 (change with `BRM_PORT`).
3. Pages: grouped by origin + path, query string ignored for grouping.
