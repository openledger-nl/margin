# Margin - Declutter GitHub homepage

A browser extension for Chrome (and Brave, Edge) and Firefox that replaces the
github.com homepage with what you actually open it for:

- **Your organizations**, with how many repositories each has. Click one to
  show all of its repositories.
- **Recently pushed by you**: the repositories *you* pushed to last, with the
  branch when it is not the default one, as a list next to your organizations.
  The repository list is sorted the same way by default ("Last pushed by
  you"); "Last pushed (anyone)" is one of the other orders.
- **All your repositories** in a grid (or list) across the full width: yours,
  your organizations' and the ones you collaborate on, with open issues and
  pull requests. Search (Enter opens the first match), filter by owner, sort by
  last push, name, stars or open issues and PRs, and show or hide forks and
  archived repositories.
- **Quick links** to pull requests, issues, notifications, stars and your profile.
- **GitHub's side menu** (the ☰ button, on every page) shows your recently
  pushed repositories instead of "Top repositories".

It also **declutters GitHub** everywhere, with a switch for each part: Copilot
buttons and chat, promo banners, the footer, sidebar sections on repository
pages (Sponsor, Packages, Deployments, Used by, …) and profile clutter
(achievements, contribution graph).

All settings are in the popup of the extension's toolbar button (in Chrome,
pin it via the puzzle-piece menu): page width (full, wide, centered),
repositories as grid or list, sort order, which sections show, how many recent
pushes (6 to 30), every declutter switch, and turning the homepage or side menu
change off. Changes apply live to open GitHub tabs.

## Zero config

Install it and open github.com while logged in. There is nothing to set up:
no token, no account to connect. Margin reads the same pages GitHub's own
interface uses, with the session you are already logged in with:

- `/repos?q=…` (GitHub's "Repositories" page, as JSON): the repositories you
  contributed to, own, or administer. Picking an organization loads all of its
  repositories (`org:<name>`).
- `/dashboard/ajax_context_list` (the dashboard's account switcher): your
  organizations.
- `/<repo>/branches/yours` ("Your branches") and `/<repo>/commits?author=<you>`
  (your commits on the default branch, with their push time): your latest push
  per repository. Repositories are asked newest first, a few at a time, and
  asking stops as soon as no remaining repository can hold a newer push of
  yours, which is usually after a dozen. The repositories show first; your
  pushes fill in a second later and are cached.

Nothing leaves github.com, and the extension only asks for access to
github.com. These are GitHub's internal endpoints, not a public API: if GitHub
changes them, `src/github.ts` is the file to update.

If GitHub stops answering those per-repository pages, "Recently pushed" falls
back to the repositories you contribute to by last push (by anyone), leaving
out public repositories of others, which would otherwise always be on top.

## Install

Download the newest build from the
[margin-github-latest release](https://github.com/openledger-nl/margin/releases/tag/margin-github-latest)
(or from the website).

- **Firefox** (140 or newer): open `margin-github-firefox.xpi` in Firefox. It is
  signed by Mozilla, so it installs for good. Until a signed build is there, use
  `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick
  `margin-github-firefox.zip` (gone after a restart). Don't use "Install Add-on
  From File" with the zip: Firefox reports an unsigned add-on as "corrupt".
- **Chrome / Brave / Edge**: extract `margin-github-chrome.zip` into a folder you
  keep, open `chrome://extensions`, turn on Developer mode, click Load unpacked
  and pick that folder. Chrome only installs in one click from the Chrome Web
  Store.

Every version also has its own release, `github-v<version>`. CI
(`.github/workflows/margin-github.yml`) makes one when the version in
`package.json` goes up on `main`.

From source:

```sh
pnpm install
pnpm build        # dist/ (Chrome, Brave, Edge) and dist-firefox/
```

## Develop

```sh
pnpm dev            # rebuild dist/ on every change (dev:firefox for Firefox)
pnpm test           # unit tests
pnpm typecheck
pnpm package        # release/margin-github-<version>-chrome.zip and -firefox.zip
```

After a rebuild, reload the extension in the browser, then the GitHub tab.

```
src/content.ts        content script: applies tweaks, swaps the homepage in and out
src/github.ts         reads repos and orgs from github.com with your session
src/repos.ts          filtering and sorting of the repository list
src/tweaks.ts         the declutter list: selectors per switch
src/settings.ts       settings (storage.sync)
src/cache.ts          last fetched data per account, so the page shows at once
src/ui/Home.tsx       the homepage (Preact)
src/sidepanel.ts      recent pushes in GitHub's ☰ side menu
src/ui/SettingsForm.tsx  all settings, shown in the toolbar popup
static/               manifest, popup page, stylesheet
build.ts              esbuild build for both browsers, icons, zips
```

**When a declutter switch stops working**, GitHub changed its markup: update
the selectors of that switch in `src/tweaks.ts`. Each switch can list several
selectors, and selectors that match nothing do no harm.

How the homepage swap works: on `/` (signed in) the content script adds
`#hb-root` to GitHub's `.application-main` and hides everything else in it with
CSS, so GitHub's top bar stays. GitHub navigates without page loads (Turbo), so
the route is checked on its navigation events and on a 400 ms timer. Data is
cached and refreshed in the background when older than two minutes.

## Similar extensions

[Refined GitHub](https://github.com/refined-github/refined-github) (lots of
improvements, no custom homepage), Repo Foyer and GitPort (Chrome only) and
Better GitHub Dashboard (Firefox only). Margin works in both browsers and
combines repositories, organizations, recent pushes and declutter switches.
