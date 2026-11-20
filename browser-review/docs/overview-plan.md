# Feedback overview with a site map

> **Status:** built. Export PDF is the browser's print dialog (Save as PDF), with a print layout that shows every comment with its thread. Customers see everyone's visits.

## What it is

A full page, opened from an **Overview** button in the comments sidebar, that shows
the whole site as a map of pages: which pages were looked at, by whom and when, and
what feedback was given where. It answers "what did we review, and what not yet".

Decided (Nov 2026):
- **For both**: customers open it from their toolbar on staging, developers from the
  extension, for their own sites and for each review-hub project. One component, two hosts.
- **Every page opened counts as visited**, while the toolbar is on. Customers' visits
  are stored on the hub, the developer's in the extension.
- **A full page in a new tab**, not a view inside the sidebar.

## The page

```
┌ Margin  Overview: acme-shop (staging.acme.com)        [Everyone ▾] [Not accepted yet ▾] ┐
│ 14 pages visited · 9 with feedback · 23 comments (4 review ready)                        │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ /                      Home              ●3 ●1        Anna, Bob · today 10:41            │
│ ├ /pricing             Pricing           ●2           Anna · today 10:54                 │
│ ├ /features            Features          (no feedback) Bob · yesterday                   │
│ └ /blog                Blog              ●1           Anna · yesterday                   │
│   ├ /blog/launch       We launched       ●4 ●2        Anna, Bob · today                  │
│   └ /blog/pricing-2026 …                 (not visited) …                                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **The map** is a tree of paths (`/blog/launch` sits under `/blog`). Every node shows
  the page title, the feedback counts as colored dots per status (the same colors as
  the sidebar), who visited it and when last. Parent paths that were never visited
  still show, dimmed, so the tree stays whole.
- **Pages without feedback** that were visited are marked, so gaps stand out: looked at,
  nothing said.
- **Click a page** to unfold its comments as collapsed cards (id, status, who, first
  line). **Open** goes to the page and opens that comment in the sidebar (see "Jump").
- **Filters**: by person (Everyone, You, Anna, Bob) and by status (the sidebar's Show).
- **Stats line** at the top: pages visited, pages with feedback, comments by status.
- Margin colors, works at phone width, no external requests.

## Visits

```ts
// shared/src/index.ts
interface PageVisit {
  origin: string;
  path: string;        // as pageKey(): no query, no trailing slash
  title: string;       // the latest one
  by: string;          // token name on the hub; "You" in the extension
  firstAt: string;
  lastAt: string;
  count: number;       // page views, at most one per minute counted
}
```

- **Customers (margin.js)**: on load and on every SPA navigation (the overlay's
  `useHref`), `POST /api/review/visits { url, title }`, at most once a minute per path.
  The hub only takes paths on `MARGIN_ORIGIN`, merges per (token name, path) into
  `visits.json`, and caps it (e.g. 5000 entries, oldest dropped).
  `GET /api/review/visits` and `GET /api/dev/visits` return them.
- **Developer (extension)**: the overlay sends `{ type: 'visit', url, title }` to the
  background, which keeps visits per origin in IndexedDB (a `visits` store, a new IDB
  version). Only on sites where the overlay runs. A pull of a project also copies the
  hub's visits (`/api/dev/visits?since=`), so the developer's map of a project shows
  the customers' visits.
- **Markdown for the agent**: the hub also writes `.margin/site-map.md`, the same
  tree as text with comment ids and statuses per page, rewritten on change (debounced).
  It sits next to `feedback/*.md`, so the demo folder (`demo/.margin/`) shows it too.

## Two hosts, one component

- `extension/src/overview/Overview.tsx`: the page, given `{ title, origin, comments,
  visits, me }` and an `openComment(c)` callback. `buildSiteMap(comments, visits)` in
  `shared/src/site-map.ts` makes the tree (pure, unit tested), and `formatSiteMap` the
  Markdown from it.
- **Extension**: `overview.html` + `overview.ts`, an extension page. A picker at the top:
  each site with comments or visits, and each project. Data through store ops
  (`list`, new `visits`). Opened from the sidebar with `?origin=` or `?project=`.
- **Hub**: `GET /overview` serves a small HTML page plus `overview.js` (built like
  margin.js, copied into the hub's `public/`). Served under `/__margin/overview` on the
  staging domain, it reads the review token from the staging site's localStorage
  (same origin), and talks to `/api/review/*`. Without a token it says to open the
  review link first. Strict CSP: only its own script, `connect-src 'self'`.
- **Jump**: "Open" goes to the page with `?margin_comment=12`. The overlay (extension
  and margin.js) reads it, removes it from the address bar, and opens that comment in
  the sidebar with Go to, like a pin. In the extension, project comments use their
  `remoteId`-free local id; the parameter carries the hub id for project comments and
  the overlay on staging maps it.

## Privacy and safety

- Visits only record path, title, time and the token name: no query strings (they can
  hold personal data), no clicks, no scrolling.
- Customers see everyone's visits in the project, like they see everyone's comments.
  (Open question: or only their own? Default: everyone, a review is a shared effort.)
- Visits are rate limited per token like comments; the hub ignores paths off `MARGIN_ORIGIN`.
- The overview page holds no secrets; the token stays in localStorage as today.

## Steps

1. `shared`: `PageVisit`, `buildSiteMap`, `formatSiteMap`, tests.
2. Hub: `visits.json`, `POST/GET /api/review/visits`, `GET /api/dev/visits`,
   `site-map.md`, `/overview` page, tests.
3. margin.js: record visits; `?margin_comment=` jump; Overview button in the sidebar.
4. Extension: visits in IndexedDB, `visit` message, pull copies hub visits,
   `overview.html`, Overview button in the sidebar and side panel, jump.
5. Docs: README (overview, visits, site-map.md), help page, hub README API table.
6. Test: unit tests, then the demo with two reviewers browsing several pages, the
   overview on both sides, and `demo/.margin/site-map.md`.

## Out of scope

- A crawl of pages nobody visited (sitemap.xml import could come later).
- Heatmaps, scroll depth, time on page.
- An MCP tool for the site map (the agent can read `site-map.md`; a `get_site_map` tool later if useful).
