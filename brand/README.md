# Margin brand

The Margin mark is an M with a terminal in its left stem: the sibling of
Ledger's laptop L. Green `#2F9E6B` on paper `#F4F1EA`, screen `#0E1016`,
prompt `#4CC38A`, code lines `#B4BACB`.

| File | What |
|---|---|
| `margin-mark.svg`, `margin-mark-512.png` | The square mark |
| `icons/16.png` … `icons/128.png` | Extension icons. 16 px shows only the M and the screen, 32 px adds the prompt, 48 px and up are the full mark |
| `margin-wordmark-on-light.svg`, `-on-dark.svg` (and `@2x.png`) | "Margin_": the mark as the M, "argin" in Inter SemiBold, the green cursor. Same metrics as Ledger's wordmark |

Every extension in this repo copies `icons/` into its build (`browser/extension/build.ts`,
`github/build.ts`), so a new icon goes here once.

The designs live in Penpot (file "Ledger", page "Margin · Logos"). The letters
in the wordmark are outlines, so the SVG needs no font installed.
