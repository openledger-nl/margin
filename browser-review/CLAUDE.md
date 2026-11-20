# Margin Browser Review

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
.githooks/   commit-msg hook: checks the Conventional Commit message
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

CI (`.github/workflows/ci.yml` at the repo root) runs the same on every push and pull request, and
on main versions and releases every Margin extension together (`scripts/release.ts` at the
repo root): one GitHub release `Margin x.y.z` with the installers for both extensions. The
release notes list the `feat` and `fix` commit summaries, so those are what users read:
write them for users. The MCP server is published to npm by hand, not by CI.
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

## Versioning: Semantic Versioning, automatic, in CI

All Margin extensions share one version (`MAJOR.MINOR.PATCH`, [SemVer](https://semver.org/)), and CI
sets it: on every push to `main`, `scripts/release.ts` (repo root) reads the Conventional Commits since
the last `vX.Y.Z` tag and takes the largest bump:

| Commit | Bump |
|---|---|
| `!` after the type, or a `BREAKING CHANGE:` footer | major |
| `feat` | minor |
| `fix`, `perf` | patch |
| anything else (`docs`, `ci`, `chore`, `refactor`, `test`, ...) | none: no release |

It writes the version into every `package.json` and `manifest.json` of both extensions, commits
`chore(release): vX.Y.Z`, tags it and publishes the release. So:

- **Never edit version numbers by hand**, and don't make `chore(release)` commits or `v*` tags:
  CI owns them. Pull `main` before new work, it has CI's release commit on top.
- The commit type is the only thing you choose: pick it for what the user gets.
