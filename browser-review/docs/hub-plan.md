# Margin review hub: client feedback on staging, Docker only

## Context

Today Browser Review (`browser-review/`) only works for the developer: the extension stores comments in their own browser and their agent reads them over a local WebSocket. We want customers to leave feedback on a **staging site** with no install and no account, and the developer to **pull** that feedback into the Margin extension with a developer token. From there the agent works on it as it does today.

Decisions:
- **Docker only** (no Netlify, no shared hosting for now). **One hub is one project**: one site, one name.
- **The customer** opens `https://website.nl/?review_token=…`. The token carries their name.
- **Tokens:** multiple review tokens and multiple developer tokens, all named, stored hashed, revocable, and created only from inside the container.
- **The developer token lives in the extension.** The MCP setup stays exactly as it is now (`claude mcp add … browser-review-mcp`): the MCP server goes through the extension, so it never needs a hub URL or a token.
- **Pulling** works from the UI (a project picker plus a "Pull feedback" button) and from MCP (the agent pulls the project of the repo it runs in).
- **The script** is one include on staging, served by the hub itself, not from npm or a CDN.
- **Storage:** a Docker volume, `.margin/` outside the webroot, with each comment also written as Markdown.
- **Screenshots** in the page by redrawing the DOM (html-to-image, bundled into the script).

```
customer browser (staging)               hub container (Docker)              developer browser                agent
website.nl/?review_token=…               one project: "acme-shop"            Margin extension                 MCP (unchanged setup)
<script src="/__margin/margin.js">       /api/review/*  review token          projects: hub URL + dev token
overlay (same Preact UI) ──fetch──────►  Store over FsDb → /data/.margin/  ◄── pull / push status ──────────── list_comments, pull_feedback
                                         /api/dev/*     developer token                                     (project from .margin/project.json)
```

## Progress

- **Done:** step 0 (zebwithb's PRs #2–#6, merged with attribution on branch `zeb-prs`, plus a fix for #4's per-frame text scan), step 1 (Store and formatComment in `shared/`, `Message.name`), step 2 (the hub, its tests and the Docker image; see `hub/README.md`).
- **Next:** step 3 (the staging overlay `margin.js`), step 4 (projects in the extension), step 5 (MCP project support).
- Differences from the plan below: `Comment.project`/`remoteId` and `shared/src/hub.ts` come with step 4; the hub image uses Node 26 (as `.nvmrc`), installs pnpm with npm (Node 26 has no corepack), and a `deletions.json` lets developers drop comments a customer deleted.

## Step 0: base from zebwithb's PRs

Apply to the working tree under `browser-review/` (`git apply --3way --directory=browser-review`, version files excluded), using the already-fetched local branches:
- **#2** `pr-tmp-2` (agent-neutral text): needed, #6 is built on it.
- **#6** `pr-tmp-6` (Host interface): the overlay talks to `Host` instead of `chrome.*`. This makes the staging build possible.
- Skip #5 (moving `Store` to shared in step 1 covers it), #4 (per-frame perf issue, separate fix) and #3 (unrelated).

The PRs were made against the old `browser-review-mcp` repo, before the move to `browser-review/` and the Margin rename, so expect some 3-way merges (mostly texts). Leave out their version bumps: CI sets the version now (`scripts/release.ts`). Nothing gets committed until asked.

## Step 1: shared code the hub and the extension both use

- **Store:** move `extension/src/store.ts` (Store, Db, MemoryDb, StoreError, checkPngDataUrl) and `store.test.ts` to `shared/src/store.ts`. It has no DOM or Node APIs; `isWebUrl` from `extension/src/sites.ts` becomes a small http/https check in shared. `background.ts` and `idb.ts` import it from `@brm/shared`.
- **Markdown:** move `formatComment` and `formatListLine` from `server/src/format.ts` to `shared/src/format.ts`, so the hub's `.md` files match what the agent gets from `get_comment`.
- **Types** (all optional, so old data loads):
  - `Message.name`: who wrote it, from the token name ("Anna (client)", "Andor").
  - `Comment.project`: set on comments pulled from a hub.
  - `Comment.remoteId`: the comment's id on that hub.
- **Hub API types:** `shared/src/hub.ts` holds the request and response types of `/api/review/*` and `/api/dev/*`, as the one definition both sides use (like `BridgeCalls`).

## Step 2: the hub (`browser-review/hub/`, new workspace package `@brm/hub`)

Plain `node:http` with no framework, bundled with esbuild like `server/`.

### Storage (`src/fs-db.ts`, implements `Db`)

```
/data/.margin/
  comments/0012.json      source of truth (the Comment)
  feedback/0012.md        rewritten on every putComment: frontmatter + formatComment + image links
  feedback/0012-7.png     screenshots (decoded from the data URL)
  counters.json
  tokens.json             { kind, name, sha256, created, expires?, lastUsed }
```

Writes are atomic (temp file + rename). `Store`'s write queue serializes writes in the one process.

### Tokens (`src/tokens.ts`, `src/cli.ts`)

Managed only with `docker compose exec margin margin …`. There is no token API on the network.

```sh
margin token add --reviewer "Anna (client)" [--expires 30d]   → https://website.nl/?review_token=mrev_…
margin token add --developer "Andor"                         → mdev_…  (shown once)
margin token list
margin token revoke "Anna (client)"
margin sri                                                   → <script> tag with integrity hash
```

- Tokens are 32 random bytes with a `mrev_` or `mdev_` prefix, so they can't be mixed up and secret scanners recognize them. Only a SHA-256 hash is stored, and comparison is constant-time.

### API (`src/app.ts`)

**Review token**, used by the customer's page:
- Only accepted when `Origin` equals `MARGIN_ORIGIN`.
- `GET /api/review/comments`
- `POST /api/review/comments`: the URL must be on `MARGIN_ORIGIN`, rate limited per token (e.g. 60 per hour).
- `POST /api/review/comments/:id/reply|accept|reopen`
- `DELETE /api/review/comments/:id`: only the token's own comments, with the sidebar's existing rule.
- `GET /api/review/screenshots/:id`
- Every message gets the token's name.

**Developer token**, used by the extension's background worker:
- No CORS needed: the extension has host permission for the hub.
- `GET /api/dev/project` → `{ name, origin, version }`, which checks the token when the project is added.
- `GET /api/dev/comments?since=<iso>` → comments changed since then.
- `GET /api/dev/screenshots/:id`
- `POST /api/dev/comments/:id/start_work|reply|submit_solution`, with the `BridgeCalls` params. It returns the updated comment.

**Static and other:**
- `GET /margin.js` (short cache) and `GET /margin-<version>.js` (immutable, for pinning with SRI).
- `GET /help`: a short page for customers.
- A 15 MB body limit, JSON errors, and no stack traces in responses.
- CORS on `/api/review/*` only for `MARGIN_ORIGIN`, for when the hub runs on its own subdomain.

**Config via env:** `MARGIN_PROJECT` (name), `MARGIN_ORIGIN` (the staging site), `MARGIN_DATA=/data/.margin`, `PORT=4780`. The hub refuses to start without the first two.

### Docker

- `Dockerfile`, multi-stage: build with pnpm (shared, the extension's embed build, hub), then a `node:24-alpine` runtime with only `dist/`, a non-root user and `VOLUME /data`.
- `docker-compose.example.yml` and an nginx `location /__margin/` snippet go in the README.

## Step 3: the customer's overlay (`extension/src/embed/`)

Same overlay code, a different `Host` (the interface from PR #6, `extension/src/content/host.ts`).

**`embed/web-host.ts`, `createWebHost(hubUrl, token)`:**
- `comments.*` → `fetch` to `/api/review/*`
- `settings` → `localStorage` (try/catch) plus the `storage` event for `watch`
- `panel: null`, so threads show in the overlay's own Sidebar
- `subscribe` → polls every 5 s and emits `comments-changed`
- `onRequest` → nothing; shortcuts are handled in the page
- `openHelp` → `/help` on the hub
- `alive()` → always true
- A host flag `mode: 'review'` hides the developer texts (agent connection, setup help) and shows "Your feedback is saved" instead.

**`embed/capture.ts`:** `capture(rect)` with html-to-image renders the visible viewport (page PNG) and the element (element PNG) at pixel ratio 1. It reuses `withCapture` from `content/capture.ts` to hide our UI and draw the outline.

**`embed/index.ts`:**
- Reads `?review_token=`, keeps it in localStorage and removes it from the address bar with `history.replaceState`.
- Without a token it does nothing, so normal visitors and the team never see a toolbar.
- Takes the hub URL from `document.currentScript.src`, so `<script src="/__margin/margin.js" defer>` needs no configuration. `data-hub` overrides it.
- Registers the React-source probe from `extension/src/main-world.ts`, then calls `mountOverlay(createWebHost(...))` from `content/mount.tsx`.

**`extension/build.ts`:** an `--embed` build that writes one IIFE, `dist-embed/margin.js`, with Preact and html-to-image bundled. `html-to-image` is a dev dependency at an exact version.

## Step 4: projects in the developer's extension

### Storage (`extension/src/projects.ts`)

- Projects are `{ id, name, hubUrl, token, origin, lastPull }`, kept in `chrome.storage.local`.
- The token is never sent to pages or content scripts. Only the background worker uses it.

### Adding a project (help/settings page, `extension/static/help.html` and `help.ts`)

- The developer pastes the hub URL and the developer token, under "Projects → Add".
- `chrome.permissions.request` asks for host permission for the hub's origin, using the same optional-permission mechanism `sites.ts` uses for "turn on for this site".
- Then `GET /api/dev/project` checks the token and fills in the name and origin.
- Projects can be listed, renamed, removed, and given a new token.

### Pull (`extension/src/sync.ts`, in the background)

- `GET /api/dev/comments?since=lastPull` plus the screenshots.
- Upsert into the local store by `(project, remoteId)`, with `project` and `remoteId` set.
- Customer replies, accepts and reopens arrive the same way.

### Push

`start_work`, `reply` and `submit_solution` on a comment that has a `project` go to the hub **first**. The local store then takes the comment the hub returns, so the hub stays the source of truth for project comments. If the hub can't be reached, the tool returns a clear error and nothing changes locally.

### When it pulls

- When you press "Pull feedback" or open the side panel.
- When the agent calls `list_comments` or `pull_feedback`.
- Every 5 minutes while a project is selected.

### UI

- The side panel and the overlay Sidebar get a **project picker**: "This site (local)" or "acme-shop (staging)".
- Next to it are a **Pull feedback** button, the last pull time, and the hub's status.
- Project threads show in the list with the customer's name. "Go to" opens the staging URL.
- **Download as Markdown** saves the selected project's feedback as `.md` files plus PNGs.

## Step 5: MCP, with the same setup as today

- `BridgeCalls` (`shared/src/index.ts`):
  - `list` gets an optional `project`.
  - New calls: `projects` → `{ name, origin, lastPull }[]`, and `pull` `{ project }` → `{ added, updated }`.
  - An older extension that doesn't know them gets a clear message: "update the Margin extension".
- **Which project:** the MCP server reads `.margin/project.json` (`{ "project": "acme-shop" }`) from the folder it was started in, i.e. the repo.
  - With that file, `list_comments` pulls that project first and only shows its comments.
  - Without it, behaviour is as today.
- **New tools** in `server/src/mcp.ts`:
  - `list_projects`
  - `pull_feedback` (optional `project`)
  - `list_comments` gets an optional `project`.
- Existing tools work unchanged on project comments. Status changes go to the hub through the extension (step 4). `capture_screenshot` on a project comment says it only works for local pages.
- The `.margin/project.json` in the repo holds **no secrets**, only the name, so it can be committed.

## Safety

- **Customers:** a review token can only create, reply to, accept or reopen comments, and delete its own. It only works from the project's own site, with an optional expiry and a rate limit.
- **Developers:** a developer token can only read and set agent statuses. It lives only in the extension's background worker and is never in a page, the repo or the MCP config.
- **Tokens:** managed only through `docker exec`, so there's no admin API to attack. They're stored hashed, revocable one by one, and `lastUsed` shows misuse.
- **Data:** stays on the developer's own server, in `.margin/` on a volume, outside the webroot. `.margin/` stays out of deploys, and the script never goes into the production build.
- **Audit trail:** every message keeps the name of the token that wrote it.

## Docs

- `browser-review/README.md`: a new section, "Feedback from customers on staging":
  - compose snippet and nginx rule
  - script tag (quick, and pinned with SRI)
  - `token add` for reviewers and developers
  - adding a project in the extension
  - `.margin/project.json`
  - keeping `.margin/` out of deploys and the script out of production
- `extension/static/help.html`: the "Projects" section.
- `browser-review/CLAUDE.md` layout: add `hub/`, `extension/src/embed/`, `projects.ts` and `sync.ts`.
- The hub's `/help` page for customers.

## Out of scope (later)

- Publishing the hub image to ghcr.io, and a CI job for it.
- One hub serving several projects.
- Showing staging feedback as pins on your local dev site.
- Live updates (SSE) instead of polling.
- Renaming the package and image to margin.
- PR #4 with a performance fix.
- Netlify or shared hosting.

## Verification

1. `pnpm install`, then `pnpm typecheck`, `pnpm test` and `pnpm build` in `browser-review/`.
2. New tests (node:test, like the existing ones):
   - `hub/src/fs-db.test.ts`: round trip; the `.md` is rewritten; atomic writes.
   - `hub/src/tokens.test.ts`: hashing, kinds, expiry, revoke.
   - `hub/src/app.test.ts`:
     - a review token can't use `/api/dev/*`, and a developer token can't create comments
     - wrong Origin and a URL outside `MARGIN_ORIGIN` are rejected
     - the rate limit works
     - the flow open → in_progress → review_ready → accept
   - `extension/src/sync.test.ts` against a hub started in the test: pull upserts by `remoteId`, push goes hub-first, and nothing changes locally when the hub is offline.
   - `server/src/mcp.test.ts`: `project` from `.margin/project.json`, `list_projects`, `pull_feedback`.
   - The moved `store.test.ts` still passes.
3. End to end, local:
   - Build and start the hub: `docker build -t margin-hub browser-review/hub`, then run it with `MARGIN_PROJECT=demo` and `MARGIN_ORIGIN=http://localhost:5173`.
   - Wire up the demo app: a Vite proxy `/__margin → :4780` in `browser-review/demo`, and the script tag in the demo's `index.html` behind an env flag.
   - `token add --reviewer Test`: open the link in a clean browser profile, leave a comment, an edit and a page comment, and check that the screenshot appears.
   - Check that `/data/.margin/feedback/0001.md` and its PNG exist in the volume.
   - `token add --developer Andor`: add the project in the extension, pull, and see the threads with the name "Test".
   - In a folder with `.margin/project.json`, have the agent call `list_comments` → `start_work` → `submit_solution`. The customer's page then shows "Review ready" within 5 s.
4. Extension regression: local comments, edits, the side panel and the MCP round trip all work as before, without any project.
