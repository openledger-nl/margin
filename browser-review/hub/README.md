# Margin review hub

A small server that runs next to your **staging site** in Docker. Customers leave
feedback through a personal link; developers pull it with a developer token.
Each comment is stored as Markdown with its screenshots, on a volume you own.

> margin.js (the customer toolbar) and the projects in the Margin extension are
> part of this; see the main [README](../README.md#feedback-from-customers-on-staging).

```mermaid
flowchart LR
  customer(["Customer"]) -->|"website.nl/?review_token=…"| site["Staging site<br/>+ margin.js"]
  site -->|"/api/review/*<br/>review token"| hub["margin hub<br/>(Docker)"]
  hub --- data[("/data/.margin<br/>Markdown + PNG")]
  ext["Margin extension<br/>(developer)"] -->|"/api/dev/*<br/>developer token"| hub
  agent["Coding agent"] <-->|"MCP, as today"| ext
```

## Run it

1. **Build the image** from the `browser-review/` folder:

   ```sh
   docker build -f hub/Dockerfile -t margin-hub:1.2.0 .
   ```

2. **Add it to your staging `docker-compose.yml`** (see [docker-compose.example.yml](docker-compose.example.yml)):

   ```yaml
   services:
     margin:
       image: margin-hub:1.2.0
       restart: unless-stopped
       environment:
         MARGIN_PROJECT: acme-shop
         MARGIN_ORIGIN: https://staging.acme.com
       volumes:
         - margin-data:/data
   volumes:
     margin-data:
   ```

3. **Route one path to it** in the web server you already have, so it lives on
   the staging domain (no CORS, no extra certificate):

   ```nginx
   location /__margin/ {
     proxy_pass http://margin:4780/;
     client_max_body_size 16m;   # comments carry screenshots
   }
   ```

   Caddy: `handle_path /__margin/* { reverse_proxy margin:4780 }`

4. **Load the toolbar on staging** (never in the production build). It does
   nothing without a review link:

   ```html
   <script src="/__margin/margin.js" defer></script>
   ```

   To pin a version with an integrity hash, use what `margin sri` prints.

## Tokens

Tokens are managed only from inside the container: there is no admin API on
the network.

```sh
docker compose exec margin margin token add --reviewer "Anna (client)" --expires 30
#   → https://staging.acme.com/?review_token=mrev_…   (send this link to Anna)
docker compose exec margin margin token add --developer "Andor"
#   → mdev_…                                          (paste into the Margin extension)
docker compose exec margin margin token list
docker compose exec margin margin token revoke "Anna (client)"
```

- **Review tokens** (`mrev_`) can create comments, reply, accept, reopen, and
  delete their own open comments. They only work from `MARGIN_ORIGIN`, for pages
  on that site, and at most `MARGIN_COMMENTS_PER_HOUR` (60) new comments per hour.
- **Developer tokens** (`mdev_`) can read everything and set *in progress* and
  *review ready*. They are refused when sent from a web page.
- Every token has a name, which goes on each message it writes. Only a SHA-256
  hash is stored, the token is shown once, and a revoke works right away.

## Where the data lives

```
/data/.margin/
  comments/0012.json     the comment (source of truth)
  feedback/0012.md       the same comment as Markdown, rewritten on every change
  feedback/0012-7.png    its screenshots
  tokens.json            token names and hashes (written by the CLI only)
  site-map.md            every page reviewers opened, who looked, and its comments
  visits.json            the page visits behind it
  review.json            focus pages and who sees whose feedback (set from the extension)
  brand.json, logo.svg   your own look on the customer side (optional, you write them)
  token-usage.json, counters.json, deletions.json
```

The Markdown is what an agent gets from `get_comment`, with frontmatter
(status, page, reviewers) and links to the images. Back up the volume like any
other data. It is never served by the web server: the hub only hands out data
to valid tokens.

## Your own look

Customers see your name, logo and colors instead of Margin's: in the toolbar, the
Feedback button, the welcome, the comments, the overview and its PDF, and `/help`.
Put these in the data folder (next to `tokens.json`):

```json
// brand.json, every field optional
{
  "name": "Acme",          // instead of "Margin": "Acme feedback", the welcome; 1 to 40 characters
  "color": "#e4572e",      // buttons, links, focus rings, the selected tool
  "toolbar": "#1b1f3b"     // the toolbar and the Feedback button
}
```

(No comments in the real file: see `brand.example.json`.)

- **Logo**: `logo.svg` or `logo.png`, square works best, at most 200 KB
  (`logo.example.svg` is a sample).
- Text on your colors is white or near-black, whichever reads better; a color too
  light for text on white is darkened for links. The status colors (open, in
  progress, review ready, accepted) never change.
- Changes are picked up by themselves, no restart. A broken file is ignored (the
  Margin look stays) and logged.
- `docker compose exec margin margin brand check` shows what the hub found and what
  is wrong.
- The overview and `/help` keep one line, *Powered by Margin*, linking to the Margin repo.
- The developer's extension keeps the Margin look.

## Focus pages and who sees what

Set from the Margin extension (**Review settings** in a project's overview) and kept in
`review.json`:

- **Focus pages**: the pages customers are asked to look at, each with an optional
  note. They show in the customer's welcome and overview, and in `site-map.md`.
- **Who sees what**: by default each customer sees only their own comments,
  screenshots and visits; someone else's comment is a 404 for them. `share: true`
  makes it one shared review; `shareFor` sets it per customer (by token name).
  Developers always see everything.

## Environment

| Variable | Default | |
|---|---|---|
| `MARGIN_PROJECT` | required | Project name, shown in the Margin extension |
| `MARGIN_ORIGIN` | required | The staging site; review links only work there |
| `MARGIN_DATA` | `/data/.margin` | Data folder, a volume outside the webroot |
| `PORT` | `4780` | |
| `MARGIN_COMMENTS_PER_HOUR` | `60` | New comments per review token per hour |
| `MARGIN_WELCOME` | – | Welcome text customers see once, `{name}` for theirs; without it a default welcome |

## API

| | Token | |
|---|---|---|
| `GET /api/review/me` | review | `{ name, project, welcome, share, focusPages }`: whose link this is, and what they see |
| `POST /api/review/visits` `{ url, title }` | review | A page the customer opened (path and title only) |
| `GET /api/review/visits`, `GET /api/dev/visits` | review, developer | `{ visits }`: who looked at which page |
| `GET /api/review/comments` | review | Their own comments, or all of the project when they share |
| `POST /api/review/comments` | review | New comment (`CreateCommentInput`, up to 15 MB with screenshots) |
| `GET /api/review/comments/:id` | review | One comment |
| `POST /api/review/comments/:id/reply` `{ body }` | review | |
| `POST /api/review/comments/:id/accept` | review | |
| `POST /api/review/comments/:id/reopen` `{ body? }` | review | |
| `DELETE /api/review/comments/:id` | review | Own comments, while open (or as the sidebar allows) |
| `GET /api/review/screenshots/:id` | review | `{ dataUrl }` |
| `GET /api/dev/project` | developer | `{ name, origin, version, you }` |
| `GET /api/dev/comments?since=&status=` | developer | `{ comments, deleted, now }`: pass `now` as the next `since` |
| `GET /api/dev/comments/:id` | developer | |
| `POST /api/dev/comments/:id/start_work` | developer | |
| `POST /api/dev/comments/:id/reply` `{ message }` | developer | |
| `POST /api/dev/comments/:id/submit_solution` `{ note, files? }` | developer | |
| `GET /api/dev/screenshots/:id` | developer | `{ dataUrl }` |
| `GET /api/dev/settings`, `PUT` or `POST` `{ focusPages, share, shareFor }` | developer | Focus pages and who sees whose feedback |
| `GET /api/dev/reviewers` | developer | `{ reviewers }`: the customers' names and when they last used their link |
| `GET /brand.json`, `GET /brand/logo` | – | Your look: `{ name, color, toolbar, logo }` and the logo file (public: it is what anyone on staging sees anyway) |
| `GET /margin.js`, `/margin-<version>.js` | – | The customer toolbar; `margin sri` prints a pinned tag with integrity |
| `GET /overview` | – | The customer's feedback overview with a site map and PDF export (its script reads the token from the staging site) |
| `GET /help`, `/healthz` | – | |

Errors are JSON `{ error }` with 400, 401, 403, 404, 409 (not allowed in this
status), 413, 415 or 429.

## Develop

```sh
pnpm --dir hub test        # storage, tokens and the API against a real server
pnpm --dir hub build       # dist/hub.js, one file without dependencies
MARGIN_PROJECT=demo MARGIN_ORIGIN=http://localhost:5173 MARGIN_DATA=./.margin-dev pnpm --dir hub start
```
