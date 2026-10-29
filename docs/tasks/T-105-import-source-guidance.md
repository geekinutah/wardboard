# T-105: The import screen says which reports to download and how

**Milestone:** 6 — Import and photos
**Depends on:** T-097, T-103 (import section, first import). Done.
- From Mike's first-import feedback on 2026-10-29: "The initial import page doesn't tell me exactly which reports I need and how to navigate to them on LCR."
- Runs in parallel with T-106 (import review clarity, `features/import/**`), T-107 (leadership roles on import, server) and T-108 (reconnected notice, `sync/**`). None of them edits a file listed here.

**Spec refs:** SPEC.md §15 "Human instructions to ship with Import" says the app must provide the guide; do not rely on a chat agent. It lists the three report routes, the "prefer Callings only, with Members/Ministering excluded" tip, and the rule never to paste credentials. `docs/import/guide.md` is the shipped guide. SPEC.md §8 covers the 2026-10-29 first-import sentence.

## Goal
On the import sources step (in Settings and on the first-import setup page), each file picker names its report and shows its exact LCR menu path. A short "How to get these reports" note gives the sign-in rule and the Callings-only tip. On a first import, the section's text no longer talks about replacing a Current that doesn't exist. Each chosen file name shows once.

## Design decisions (binding)
All changes are in `apps/web/src/shell/ImportSection.tsx` and its CSS.

**Each picker.** Keep the existing accessible label text, because existing tests use it: `Organizations and callings`, `Members without callings`, `Out-of-unit callings`. Under each label, add a hint linked with `aria-describedby`. The hints use exactly these paths:
- Organizations and callings: `In LCR: Callings → Callings by Organization → Print → Download PDF. Choose Callings only, without Members or Ministering, if offered.`
- Members without callings: `In LCR: Reports → Members without Callings → Print → Download PDF.`
- Out-of-unit callings: `In LCR: Reports → Out-of-Unit Callings → Print → Download PDF.`

**"How to get these reports".** Add a `<details>` with that summary text, closed by default. Inside it, a short ordered list:
1. `Sign in to LCR in your own browser. WardBoard never asks for your Church password or MFA code.`
2. `Download the three reports above and keep them in a private folder.`
3. `Choose each file here, then press Preview import. Nothing changes until you confirm.`

Below the list, add a sentence saying the full guide is `docs/import/guide.md` in the WardBoard repository. It is plain text, not a link, because the app does not serve the docs.

**Intro text.**
- With a Current: keep `Replace Current with the three LCR reports. Nothing changes until you confirm.`
- With no Current: `Create Current from the three LCR reports. Nothing changes until you confirm.`

**File name.** Show the chosen file name once. The visible caption stays, because existing tests may read it. Hide the native input's own file-name text visually, keeping the input accessible, focusable and at least 44px. If you can't do this without breaking an existing test, keep both and report it under Notes.

**Copy rule.** Never mention a collector, a scraper, or any command that downloads Church files. The guide says the collector is not shipped.

## Scope
May change:
- `apps/web/src/shell/ImportSection.tsx`, `apps/web/src/shell/import-section.css`
- `apps/web/src/shell/import-guidance.test.tsx` (new)
- `apps/web/e2e/gui/import-guidance.capture.ts` (new)

Must not change:
- every existing test file (unit, e2e and capture)
- `apps/web/src/features/import/**`, `FirstImport.tsx`, `SettingsRoute.tsx`, `App.tsx`
- `docs/import/**`, `apps/server/**`, `packages/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/import-guidance.test.tsx src/shell/import-section.test.tsx src/shell/first-import.test.tsx` | every new test passes; existing tests pass unmodified |
| 2 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/import-guidance/` has `sources-closed`, `sources-open` (details expanded, three files chosen) for `desktop-chromium` and `phone-chromium` |
| 3 | Mutation | in a disposable worktree at the candidate, swap the Members-without-callings and Out-of-unit hints, then run check 1 | `each picker shows its LCR path` fails; remove the worktree |
| 4 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 5 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`import-guidance.test.tsx`)
Use the fake socket + SyncClient pattern from `import-section.test.tsx` (copy the helpers).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `each picker shows its LCR path` | each file input's accessible description is exactly its hint above | hints swapped or missing |
| `the how-to note is closed and gives the sign-in rule` | `How to get these reports` is a closed `details`; expanded, it shows the three steps and the guide path | open by default; credential rule missing |
| `first import says Create Current` | with `boards.current === null`, the intro says `Create Current …` and not `Replace Current` | wording unchanged |
| `with a Current the intro still says Replace Current` | the existing sentence | wording changed for re-imports |
| `the copy never mentions a collector or scraper` | the section's text (details expanded) contains none of `collector`, `scrape`, `scraper` | an invented tool in the copy |
| `a chosen file name shows once` | after choosing a file, its name appears exactly once in the visible caption | duplicate caption (if a native-input limitation forces keeping both, the test asserts the caption and the implementer reports it) |

## GUI verification
Required. On desktop-chromium and phone-chromium, at `/settings` with the seeded Current, capture the sources step closed and open. Compare with `Settings.dc.html`. Fail on:
- horizontal scroll at 390px
- a hint cut off or overlapping the input
- a picker under 44px
- the details summary under 44px tall

## Human checks
- At `/settings` and on `pnpm dev -- --empty --reset`, read the hints. Confirm they match what LCR shows today, and that the steps are clear without the full guide.

## Out of scope
- The review screen (T-106).
- A fourth report (pending Mike's decision).
- Serving `docs/import/guide.md` from the app.
