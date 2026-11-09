# Margin for VS Code

Review the changes on any local git branch in VS Code, comment inline on either side of the diff, and keep the
whole review in your [Ledger](https://github.com/openledger-nl) vault as plain markdown files. Ledger syncs the
vault, so a review you start on one machine can be picked up on another.

It works with any git repository, whatever forge it lives on (or none). Posting a review to GitHub or GitLab is
not part of this version.

## What it does

- **Margin: Start Review** asks for:
  - the **repository**, if the workspace has more than one;
  - the **base**: by default the merge base of HEAD with the default branch (`origin/HEAD`, else `main`, else
    `master`), so you review everything the branch adds. Pick another branch (compared from its merge base), or a
    tag or commit (compared from exactly there);
  - the **Ledger project**, starting on the one this repository's latest review is in;
  - the **thread**: a new one (titled `<repo>: <branch>`) or an existing one, starting on the latest thread that
    has a review of this branch.

  The head is HEAD's commit. Margin then writes the draft review into the thread.
- **The Margin view** (activity bar) lists the review's changed files. Click one for a read-only diff of base
  against head, served straight from git.
- **Comments** go on either side of those diffs: click `+` in the gutter, select several lines first for a range,
  or use the comment button on a file in the view to comment on the whole file. Reply, edit, delete and resolve
  from the comment itself. Every action is written to the vault at once.
- **Live**: Margin watches the vault, so comments arriving from your other machines through Ledger's sync show up
  as they land.
- **Margin: Resume Review** lists the draft reviews of the repositories in this workspace, from any machine, and
  puts their comments back inline. If the branch has new commits since, it offers to review up to HEAD
  (**Margin: Move Review to HEAD** does the same later).
- **Outdated comments**: a comment made on another commit than the one a diff shows is looked for again near
  where its lines went. If its code is gone, it is listed under **Outdated** in the view, still readable.
- **Margin: Submit Review** asks for a verdict (Approve, Request changes or Comment), then opens an editor for
  the summary (markdown, may stay empty). Submit from the editor's title bar or the notification. A submitted
  review is read-only; the next Start Review on the branch suggests the same thread, for the next round.

The window remembers its review: reopen it and the review is back. **Margin: Close Review** stops showing it
(nothing is deleted).

### Settings

| Setting | |
|---|---|
| `margin.vaultPath` | The Ledger vault folder. Per machine, not synced. |

When it is empty, Margin uses the `LEDGER_VAULT` environment variable, else the vault Ledger itself uses
(`vaultPath` in Ledger's `config.json`, else Ledger's default: `Ledger` in your Documents folder). If none is
found, Margin says so and offers to choose the folder.

Margin runs `git` from your PATH, or the one in VS Code's `git.path` setting. It doesn't run in untrusted
workspaces: a repository's own git config can make git run other programs.

## Install

Margin isn't on the Marketplace yet. Install the `.vsix`:

```sh
code --install-extension margin-code-0.1.0.vsix
```

or, in VS Code: Extensions view → `⋯` → **Install from VSIX…**. It needs VS Code 1.100 or newer.

### Build it

With Node 26 (see `.nvmrc`) and pnpm:

```sh
cd code
pnpm install
pnpm test        # vitest: the vault format, git, anchoring and a whole review against real repositories
pnpm typecheck
pnpm package     # builds dist/extension.js and margin-code-<version>.vsix
pnpm fixture     # writes test/fixtures/ again (see below)
```

`test/fixtures/vault/` is a small vault written by margin-code's own code, with a fixed clock, id seed and
commit dates; `test/fixtures/CONTENTS.md` says what each file shows. Ledger's tests read it as margin-code's
output, and `src/fixture.test.ts` fails when margin-code would write it differently. When a change is meant to
change those files, run `pnpm fixture`, commit them, and tell the Ledger side.

`pnpm watch` rebuilds on change; press F5 in VS Code with this folder open to try it in an Extension Development
Host (add a launch configuration of type `extensionHost` first).

## Layout

```
src/
  format.ts, frontmatter.ts   the review format: reading and writing review and comment files
  vault.ts, atomic.ts         the vault on disk; atomic writes through a dotfile
  locate.ts, documents.ts     finding the vault; the Documents folder the way Ledger finds it
  ids.ts, slug.ts             Ledger's ids, timestamps and thread slugs
  git.ts, repoIdentity.ts     git through execFile (no shell); a repo's identity
  anchor.ts, placement.ts     where a comment's lines are now
  session.ts, model.ts        the active review: every change written at once
  publisher.ts                the seam for posting a submitted review to a forge (none yet)
  fixture.ts                  writes the fixture vault in test/fixtures/
  ui/                         VS Code: the view, diffs, comments, Start/Resume/Submit
  extension.ts                wires it together
```

Only `ui/` and `extension.ts` know about VS Code; the rest is tested against real folders and repositories.

## The contract: margin review format, version 1

Ledger reads what margin-code writes, built against this spec at the same time. Change it only together.

Paths are relative to the vault root. Ids are Ledger's: `<epoch-millis>-<8 chars of [0-9a-z]>`, which sort chronologically as strings. The file name is the id plus `.md`. Timestamps are ISO-8601 UTC with milliseconds (`2026-11-09T10:15:00.123Z`). Frontmatter is YAML with camelCase keys. The body is markdown.

```
projects/<project>/threads/<thread>/thread.md                       the thread (Ledger's own format)
projects/<project>/threads/<thread>/reviews/<review>.md             a review: one round of reviewing one diff
projects/<project>/threads/<thread>/reviews/<review>/<comment>.md   a comment in it, or a reply
```

Review, `reviews/<review>.md`:
```yaml
---
format: 1
repo: github.com/openledger-nl/margin   # repo identity, see below
repoName: margin                        # for display
base: <40-char sha>                     # the commit compared against
baseRef: main                           # optional, display only
head: <40-char sha>                     # the commit reviewed
headRef: feat/code                      # optional, display only
state: draft                            # draft | submitted; submitted is final, a next round is a new review
verdict: approve                        # approve | changes | comment; only when submitted
author: Milan Molenbrugge               # git user.name
createdAt: 2026-11-09T10:15:00.123Z
updatedAt: 2026-11-09T10:15:00.123Z
submittedAt: 2026-11-09T11:00:00.000Z   # only when submitted
---
The summary in markdown (may be empty while a draft).
```

Comment, `reviews/<review>/<comment>.md`:
```yaml
---
format: 1
path: browser/server/src/mcp.ts   # repo-relative, forward slashes, the file as it is on `side`
side: new                         # new = the head's version, old = the base's (e.g. a removed line)
line: 42                          # 1-based first line; leave line and endLine out for a comment on the whole file
endLine: 44                       # last line; equal to line for a single line
commit: <40-char sha>             # the commit those line numbers belong to
code: |                           # the commented lines, verbatim: readable without the repo, and how the place is found again after the code moves
  …
codeBefore: |                     # optional, up to 3 lines before
  …
codeAfter: |                      # optional, up to 3 lines after
  …
replyTo: <comment id>             # only on a reply; a reply leaves out path/side/line/endLine/commit/code and sits where its parent does
resolved: false                   # on the first comment of a conversation
author: Milan Molenbrugge
createdAt: …
updatedAt: …
---
The comment in markdown.
```

**Repo identity.** Take the `origin` remote, or else the first remote by name, as host/path. Lowercase the host, and drop the scheme, user, port and trailing `.git`. So `git@github.com:openledger-nl/margin.git` and `https://github.com/openledger-nl/margin` both become `github.com/openledger-nl/margin`. A repo without remotes is `git:<sha of its root commit>` (`git rev-list --max-parents=0 HEAD`, the oldest if there are several).

**Who writes what**
- margin-code writes and deletes review and comment files. Ledger reads them and never rewrites or deletes them, except together with their thread or project when the user deletes that in Ledger.
- margin-code may create a thread for a review. It makes a new folder `threads/<slug>/` with a `thread.md` holding `title` and `createdAt` in its frontmatter (the body is an optional description).
- The slug is made the way Ledger makes it: lowercase ASCII letters and digits are kept, and any other run of characters becomes one `-`. There is no leading or trailing `-`, and the fallback is `thread`. Add `-2`, `-3`… when the slug is taken. After creating it, margin-code never writes that `thread.md` again: it is Ledger's.
- Writes are atomic: write a temp file whose name starts with `.` in the same folder, then rename it over the target. Ledger ignores dotfiles.
- Both sides keep unknown frontmatter keys as they are and otherwise ignore them. A file with a `format` higher than a side knows is shown read-only by Ledger and left untouched by margin-code, with a note.
- While Ledger runs, it notices these files within seconds (through a vault watcher) and syncs them. Until it runs, they wait on disk.

**Finding the vault** (margin-code):
1. The `margin.vaultPath` setting.
2. Else the `LEDGER_VAULT` environment variable.
3. Else `vaultPath` in `config.json` in Ledger's config folder for the app id `nl.openledger.ledger`: `%APPDATA%\nl.openledger.ledger\` on Windows, `~/Library/Application Support/nl.openledger.ledger/` on macOS, `$XDG_CONFIG_HOME` or `~/.config` plus `nl.openledger.ledger/` on Linux. `LEDGER_CONFIG_DIR`, when set, replaces that folder.
4. Else Ledger's own default, as Ledger falls back to when `config.json` is missing, unreadable or has no `vaultPath`: `Ledger` in the user's Documents folder, or `vault` in Ledger's config folder when there is no Documents folder. The Documents folder is the one Tauri's `document_dir` gives: the known folder `FOLDERID_Documents` on Windows (which may be redirected, to OneDrive say), `~/Documents` on macOS, and `XDG_DOCUMENTS_DIR` from `user-dirs.dirs` on Linux (none when it isn't set there). Only when that folder exists.

### How margin-code fills in what the contract leaves open

Not part of the contract; Ledger shouldn't depend on these, but may find them useful to know.

- Files are laid out the way Ledger renders its own: `---`, the YAML, `---`, a blank line, the body, a final
  newline. New keys go in the order above; keys already in a file stay where they are, with their comments.
- `code`, `codeBefore` and `codeAfter` hold whole lines, each ending in a newline (so they read as `key: |`
  blocks), with `\n` line endings. A value a `|` block can't hold exactly (a line of only spaces, say) is written
  double-quoted instead.
- A reply's `replyTo` is the first comment of its conversation: VS Code's threads are flat. A reply to a reply,
  if one turns up, is read as part of the same conversation; a reply whose first comment is gone is listed as
  outdated.
- Deleting the first comment of a conversation deletes its replies with it (after asking). A review's comments
  folder is removed when its last comment is.
- A review's `updatedAt` changes when its own file does (summary, submit, moving its head), not when one of its
  comments changes; each comment has its own `updatedAt`.
- `headRef` is left out on a detached HEAD.
- A file without `format` is read as format 1.
- A remote without a host (a local path or `file://`) counts as no remote: the identity is `git:<root commit>`.
  "First remote by name" sorts names by code point; "the oldest" root commit is the one with the earliest
  committer time (ties: the lowest sha).
- **Margin: Move Review to HEAD** rewrites a draft's `head` (and `headRef`) when the branch moved on. Its
  comments keep their own `commit`, which is how they are found again.
