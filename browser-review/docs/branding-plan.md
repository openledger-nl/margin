# Your own logo and colors on the customer side

## What it is

A company (or agency) that runs the margin review hub can show its own logo and
colors to its customers, so the review feels like part of their own product.

Decided (Nov 2026):
- **Customer side only**: the toolbar on staging, the welcome, the comments sidebar,
  the Feedback button, the overview and its PDF, and the hub's help page. The
  developer's extension keeps the Margin look, also when it shows a project.
- **Set with files in the hub's `.margin` folder**: `brand.json` plus a logo file. The
  hub picks up changes by itself: no rebuild, no restart.
- **Two colors**: the main color and the toolbar color. Text colors follow
  automatically for contrast. The status colors (open, in progress, review ready,
  accepted) stay the same everywhere, so they always mean the same thing.
- **Credit**: one quiet "Powered by Margin" line, linking to
  https://github.com/openledger-nl/margin, in the help page and the overview/PDF
  footer. Nothing in the toolbar, nothing more.

## The files

```
/data/.margin/            (demo: demo/.margin/)
  brand.json
  logo.svg  or  logo.png
```

```json
{
  "name": "Acme",
  "color": "#e4572e",
  "toolbar": "#1b1f3b"
}
```

- `name`: shown instead of "Margin" ("Acme feedback", the welcome, the overview title).
  At most 40 characters.
- `color`: the main color: buttons, links, focus rings, the selected tool, the
  numbered steps in the welcome. `#rrggbb` or `#rgb`.
- `toolbar`: the toolbar and the Feedback button. Default: the Margin screen color.
- Every field is optional; without `brand.json` it is the Margin look as today.
- **Logo**: `logo.svg` or `logo.png`, square works best, at most 200 KB. It replaces
  the Margin mark in the toolbar, the welcome, the sidebar header, the Feedback button
  and the overview.

`margin brand check` (inside the container) says what the hub found and what is wrong,
for example "color must look like #e4572e" or "logo.png is 640 KB, at most 200 KB".
A broken file is ignored (the Margin look stays) and logged once, never fatal.

## How it works

### Hub

- `hub/src/brand.ts`: reads `brand.json` and the logo, re-reads when the files change
  (mtime, like `tokens.json`), validates them.
- `GET /brand.json`: `{ name, color, toolbar, logo }` where `logo` is
  `brand/logo?v=<hash>` or null. Public (no token): it only holds what any visitor of the
  staging site sees anyway, and the overview and help page need it before anything else.
- `GET /brand/logo`: the file. SVG is served as `image/svg+xml` with
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and only ever
  used in an `<img>`, where an SVG can't run scripts. PNG is checked by its first bytes.
  Long cache, the `?v=` changes with the file.
- `/help` and `/overview` use the brand; both get the "Powered by Margin" footer link.

### Colors, one place

- `shared/src/theme.ts`: `brandTokens({ color, toolbar })` returns the CSS variables:
  - the main color, a darker one for hover, and a light one for soft backgrounds (mixed
    with white)
  - the text on the main color: white or near-black, whichever has more contrast
    (WCAG luminance)
  - the toolbar color, a slightly lighter one for its border and hover
  - the text and icon colors on the toolbar, and the selected-tool color, readable on that
    toolbar (the main color when it has enough contrast against it, else a lighter one)
  Pure and unit tested, including bad contrast pairs.
- The overlay already runs on `--brm-*` variables; the overview on its own. Both take
  these values instead of the Margin ones when a brand is set.

### Overlay (margin.js)

- The web host loads `brand.json` when it starts (with `/api/review/me`) and holds it as
  `host.brand`.
- `mountOverlay` sets the variables on the overlay root. The extension never has a brand,
  so it stays Margin.
- A `BrandMark` component: the company logo as an `<img>`, else the Margin mark. It replaces
  `Mark` wherever the customer sees it.
- The texts use `brand.name`: the toolbar's label ("Acme feedback"), and the welcome
  ("Hi Milan! Thanks for looking at the staging preview. Acme would love your feedback…").
  `MARGIN_WELCOME` still replaces the welcome text.

### Overview and PDF (the hub's /overview)

- `hub-entry.tsx` loads `brand.json` and sets the variables on `:root`, plus the logo in the
  header. The print layout keeps the colors, so the PDF is in the company's look.
- The footer reads "Powered by Margin", a link to the repo.

## Also in this round: a more visual welcome, and the site map in reach

Decided (Nov 2026):

### Animated mini-demos in the welcome

Each step in the welcome gets a small looping animation next to it, drawn in the page
itself (HTML and CSS in the overlay's Shadow DOM, no video or GIF files):

1. **Pick element**: a mini page; the cursor moves to a heading, it gets outlined, the
   comment box opens, a few words appear, *Add comment*, a numbered pin lands on it.
2. **Page comment**: the cursor clicks *Page comment*, the box opens at the bottom, the
   comment is sent, the Comments count goes up.
3. **Comments**: the sidebar slides in; a reply from the team appears; the status turns
   *Review ready*; the cursor clicks *Accept*.
4. **Overview**: the map icon, then a small tree of pages with colored dots.

- They use the company's colors and logo (the brand variables above), so they always
  look like the real toolbar.
- About 3 to 5 seconds per loop, paused for people who ask their system for less motion
  (`prefers-reduced-motion`: a still frame instead).
- Phone width: the animation goes above the text.
- A few KB of CSS in margin.js; no extra requests.

### The site map in reach

- **A map button in the toolbar**, next to Comments: opens the Overview (the site map with
  all feedback, Export PDF). On the customer side it moves out of the sidebar into the
  toolbar; the developer's extension keeps it in the sidebar.
- **A 4th step in the welcome**: "See everything you said on a map of the site:
  Overview", with its animation.

## Try it in the demo

`demo/.margin/brand.json` with a sample brand, plus a sample logo, so `pnpm demo:hub` shows a
branded toolbar; removing the file brings back the Margin look. `hub/brand.example.json` as
the reference.

## Steps

1. `shared/src/theme.ts` + tests.
2. Hub: `brand.ts`, `/brand.json`, `/brand/logo`, `margin brand check`, the help page and
   footer, tests.
3. Overlay: `host.brand`, the variables in `mountOverlay`, `BrandMark`, the texts.
4. Overview: brand in `hub-entry.tsx`, the footer, print colors.
5. Docs: hub README (Brand section, files, check), main README one paragraph, demo sample.
6. Welcome: the four animated mini-demos (brand colors, reduced motion, phone width),
   the 4th step; the map button in the toolbar.
7. Test: unit tests; the demo with a bright and a dark sample brand (screenshots of the
   toolbar, the welcome with its animations, the sidebar, the overview and the PDF); a
   broken brand.json and an oversized logo fall back to Margin.

## Out of scope

- Branding the developer's extension, also per project (decided: the customer side only).
- Fonts, a full palette, per-page or per-customer brands.
- Uploading the brand through a web page: the files are the setup, like the tokens.
