# The fixture vault

`vault/` is made by margin-code's own code (`src/fixture.ts`): its writer, slugs, ids, thread creation and a
review session, against a throwaway repository with fixed commit dates, a fixed clock and a fixed id seed, so
it comes out the same every time. `src/fixture.test.ts` fails when margin-code would write it differently;
`pnpm fixture` writes it again (then tell the Ledger side, which tests that it reads these files).

The repository is `github.com/openledger-nl/margin-fixture`; its commits on `feat/review-me`:

- base `3e0720893e748ccf801b960ac2b7a3b6f89871ce` (main): total.js, legacy.js, README.md
- h1 `05ee15032ecfc5842073d96f0d0dea42593c5761`: adds average.js, removes legacy.js, guards total()
- h2 `83a8485b6c68cbd327062d8b7e7278654e14f960`: answers round 1 (a comment in total.js, NaN for none, average.test.js)
- h3 `704ebb481cfb21b951b1180f0cc559e989cb4a44`: a three-line doc comment on total.js, which moves its lines down by two

| File | What it shows |
|---|---|
| `projects/fixture/project.md` | The project. Ledger's file, written by hand here: margin-code never makes projects. |
| `projects/fixture/threads/margin-fixture-feat-review-me/thread.md` | A thread margin-code made, titled "margin-fixture: feat/review-me" (slug margin-fixture-feat-review-me). |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6.md` | Round 1: submitted, verdict changes, with a summary. base..h1. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6/1794214984011-54fzye5x.md` | A comment on one line of the new side, with codeBefore and codeAfter; resolved: true. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6/1794215045348-40l1bt7b.md` | A reply (replyTo: the first comment). |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6/1794215106685-id1g7ub4.md` | A reply to a reply (replyTo: the reply above). margin-code itself always answers the first comment; this one is written with its writer directly. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6/1794215229359-ts8cm6e7.md` | A comment on a removed line: side old, at the base commit. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6/1794215290696-hqvrfpxw.md` | A comment on a range (line..endLine), edited after another tool added a key with a YAML comment, which stayed. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794214922674-9dxzhga6/1794215413370-xpfjcd04.md` | A comment on the whole file: no line, endLine or code. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794215536044-sk7lhuov.md` | Round 2: a draft with an empty summary. Started at h2, then moved to h3 (Move Review to HEAD). |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794215536044-sk7lhuov/1794215597381-cc4ep86x.md` | A comment made on h2: its commit isn't the review's head (h3) any more. margin-code finds it two lines down. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794215536044-sk7lhuov/1794215720055-4sg9yx7g.md` | A comment made after the move: its commit is the head. |
| `projects/fixture/threads/margin-fixture-feat-review-me/reviews/1794215536044-sk7lhuov/1794215781392-hw6o8g33.md` | Format 2, with a key format 1 lacks: Ledger shows it read-only, margin-code leaves it untouched. |
