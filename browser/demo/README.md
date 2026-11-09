# Demo app: Pebble

A made-up product site (Vite + React) to try Browser Review on, and to show it.

```sh
pnpm demo        # from the repo root; opens on http://localhost:5173
```

It has a few things worth a review comment, on purpose:

| Where | What is off |
|---|---|
| Top of every page | a "beta" banner that should go: **Remove** it |
| Home, headline | the typo "acutally": **Edit** the text |
| Home, "Start for free" | the main button hardly stands out: **Comment** or **Edit** its CSS |
| Home, "Why teams switch" | the third icon sits lower than the other two |
| Pricing | "Most popular" is on Business; it should be on Team |
| Footer | the year says 2023 |

Then ask Claude Code: "fix the review comments". It fixes them in `demo/src`,
and the page updates as you watch.

Reset it afterwards with `git checkout demo/`.
