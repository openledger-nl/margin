# Browser Review

A Brave/Chromium extension plus an MCP server (browser-review-mcp, on npm) that Claude Code starts, so the user can comment on,
remove and edit elements of their dev app (localhost, dev domains, sites they turn
on) and Claude picks the comments up
over MCP. See README.md for how it works and how to use it.

## Layout and commands

```
shared/      types used by both sides, including the bridge protocol (BridgeCalls)
server/      browser-review-mcp, published to npm: MCP over stdio + WebSocket bridge
extension/   MV3 extension: background worker owns the data (store.ts over IndexedDB),
             overlay (Preact in a Shadow DOM), threads side panel (panel.tsx;
             Firefox: sidebar_action), help page, notice popup.
             build.ts makes dist/ (Chromium) and, with --firefox, dist-firefox/
demo/        Vite + React demo app with flaws on purpose (`pnpm demo`); not released
scripts/     version.ts: Conventional Commit checks and version bumps
.githooks/   commit-msg and post-commit hooks (enabled by `pnpm install`)
```

How it fits together: Claude Code starts `npx browser-review-mcp` per session.
It listens on ws://127.0.0.1:4777; the extension connects and answers Claude's
tool calls from its own store. The MCP process stores nothing. Several sessions:
the first holds the port (hub), the rest connect to it (/peer).

```sh
pnpm build           # extension/dist, extension/dist-firefox, server/dist/cli.js
pnpm dev             # watch + hot reload of extension/dist (dev:firefox: dist-firefox)
pnpm demo            # demo app on http://localhost:5173 to try it on
pnpm test            # all tests
pnpm typecheck       # all packages
pnpm package         # release/browser-review-<version>-chrome.zip and -firefox.zip
pnpm publish:mcp     # publish browser-review-mcp to npm (only when the user asks)
```

After a change: run `pnpm typecheck`, `pnpm test` and `pnpm build`.

CI (`.github/workflows/ci.yml`) runs the same on every push and pull request, and
on main creates GitHub release `v<version>` (chrome zip, firefox zip, MCP tarball)
when the version changed. Release notes come from `scripts/release-notes.ts`, so
the commit summaries are what users read: write them for users.
When a change is visible to the user (a button, shortcut, behaviour, setup), update
the README, and the help page (`extension/static/help.html`) when it affects how to
set up or use it. The help page is what users read first.

Firefox: the same code, built with `chrome` mapped to Firefox's `browser`
namespace and a Firefox manifest (`firefoxManifest()` in `extension/build.ts`:
background.scripts instead of a service worker, gecko id, min version 140).
Use only APIs both support; when not sure, check MDN's browser compatibility.
Keep the gecko id fixed: Firefox keys the add-on's stored comments to it.

Changing a tool, its parameters or the bridge protocol: keep `BridgeCalls` in
`shared/` as the single definition, and remember that users run the newest npm
version against whatever extension version they have installed.

## Commits: Conventional Commits

Every commit message must follow [Conventional Commits](https://www.conventionalcommits.org/).
The `commit-msg` hook rejects anything else.

```
<type>(<optional scope>)<optional !>: <summary in the imperative, lower case>

<optional body: what and why>

<optional footer, e.g. BREAKING CHANGE: what breaks and how to migrate>
```

| Type | Use for | Version bump |
|---|---|---|
| `feat` | a new feature the user can see or use | **minor** 0.1.0 → 0.2.0 |
| `fix` | a bug fix | **patch** 0.1.0 → 0.1.1 |
| `perf` | a speed-up without behaviour change | **patch** |
| `refactor` | code change, no behaviour change | none |
| `docs` | README, CLAUDE.md, comments | none |
| `style` | formatting only | none |
| `test` | tests only | none |
| `build` | build script, dependencies, tooling | none |
| `ci` | CI config | none |
| `chore` | anything else that is not shipped | none |
| `revert` | reverting an earlier commit | none |

A `!` after the type/scope (`feat!:`, `fix(api)!:`) or a `BREAKING CHANGE:` footer
makes it a **major** bump (0.4.2 → 1.0.0), whatever the type. Breaking means the user
has to do something: the MCP tools change shape, the extension API changes, stored
data or settings no longer load, the Node version requirement goes up.

Scopes in use: `extension`, `mcp`, `shared`, `overlay`, `sidebar`, `help`, `deps`.

Examples:

```
feat(overlay): add keyboard shortcuts for pick, page comment and threads
fix(sidebar): keep the reply draft after a reload
feat(mcp)!: rename get_comment to get_task

BREAKING CHANGE: Claude Code sessions must use get_task instead of get_comment.
docs: explain the localhost-only notice
```

One logical change per commit. If a change has both a feature and a fix, the
highest bump wins, so a `feat` commit may include the fixes it needed.

## Versioning: Semantic Versioning, automatic

The version follows [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH`.

- The root `package.json` `"version"` is the single source of truth.
- It is copied into `shared/`, `server/` and `extension/` `package.json` and
  `extension/static/manifest.json`. The MCP server reads its version from its
  `package.json` at runtime, the extension from its manifest.
- **Never edit version numbers by hand.** The `post-commit` hook reads the commit
  message, bumps the version (table above), syncs all files and amends the bump into
  the same commit. It prints `Version x.y.z (level)` when it does.
- It does not bump again when the commit already changes the version (for example
  `git commit --amend`), nor during rebase, cherry-pick or merge.
- If it says the version files have uncommitted changes, commit or stash those
  first, then run the command it prints.

By hand, when really needed:

```sh
pnpm version:bump patch|minor|major   # bump and sync
pnpm version:sync                     # copy the root version into every file
```

Do not use `git commit --no-verify` unless the user asks for it: it skips the
message check (the version bump still runs).

The hooks are enabled by `pnpm install` (the `prepare` script sets
`core.hooksPath` to `.githooks`). In a fresh clone without install, run
`git config core.hooksPath .githooks`.
