# T-106: The import review is clearer on a first import and points to unresolved rows

**Milestone:** 6 — Import and photos
**Depends on:** T-059, T-097, T-103. Done.
- From Mike's first-import feedback on 2026-10-29:
  - "244 of the callings were 'Unfamiliar'" on an empty ward.
  - "what does 'Treat as new person' mean? This is an empty ward."
  - "I managed to miss one row somewhere in the middle … it didn't tell me which and it wasn't easy to find."
- Runs in parallel with T-105 (`shell/ImportSection.tsx`), T-107 (server) and T-108 (`sync/**`). It does not edit their files.

**Spec refs:**
- SPEC.md §8: the preview shows ambiguous identities and they must be resolved explicitly, never by a silent merge. An exact, unique name match reuses the existing member. Namesakes, changed names and resembling names need confirmation.
- SPEC.md §8, the 2026-10-29 first-import sentence.
- SPEC.md §12: the preview reconciles unfamiliar callings against the configured catalog.
- AGENTS.md: color is never the only signal; touch targets are at least 44px.

## Goal
In the import review:
- A row with no existing member to match asks one question, Adult or Youth, with no confusing "Treat as new person" button.
- On a first import, the callings stat says "New callings" instead of "Unfamiliar callings".
- When any row still needs a choice, the review names the next one and jumps to it.
- Each unresolved row is marked in text.

Rows that can match an existing member work exactly as today.

## Design decisions (binding)
All changes are in `apps/web/src/features/import/ImportReview.tsx`, `plan.ts` and `import.css`.

**First import.** `ImportReview` already receives `expectedVersion`. Treat `expectedVersion === 0` as a first import: there is no Current, and every stored Current has a version of 1 or more. Do not add a prop.

**Callings stat.** On a first import, `planImportReview` (or the component) labels the stat `New callings`, with the same count. Otherwise it stays `Unfamiliar callings`. Add an optional `firstImport` argument to `planImportReview`, default `false`; existing callers and tests are unchanged.

**Rows with no match options** (`row.matchOptions.length === 0`):
- Render only `Adult` and `Youth` buttons. Pressing one resolves the row as `{ action: 'new', category }`.
- Do not render `Treat as new person`.
- For `row.kind === 'new'`, the row's detail line reads `Not in WardBoard yet. Choose adult or youth.`
- Any other kind, such as `report_conflict`, keeps its existing detail text, so the reason it needs attention stays visible. Add the test `a report conflict keeps its explanation`.
- If such a row does not need a category, it is already new and needs no choice, so render no buttons and the text `Will be added`.

**Rows with match options** keep today's buttons and behavior, including `Treat as new person` and the category buttons after it.

**Unresolved marking.**
- Each row that still needs a choice shows a text tag `Needs a choice`, with `aria-label` on the row including it. Resolved rows don't show it.
- The tag is text plus style, never color alone.

**Next unresolved.**
- When `decision.unresolved > 0`, show a button `Go to next: {name}` next to the disabled Replace button. `{name}` is the first unresolved row in display order.
- Activating it scrolls that row into view (`scrollIntoView({ block: 'center' })` when available) and moves focus to the row. The row container gets `tabIndex={-1}`.
- The button is at least 44px.
- It disappears when nothing is unresolved.

**Count line.** Below the decisions heading, show `{n} of {total} need a choice` (live region `aria-live="polite"`) while any are unresolved.

**Wording.** Keep `IMPORT · REPLACE CURRENT` and the replace button wording as they are; T-105 changes the section intro, not the review.

## Authorized changes to existing tests
Existing e2e loops click `Treat as new person`, then a category, for rows that have no match options. That button no longer exists on those rows. In only these files, change only the per-row clicks for rows without match options so they press `Adult`, or `Youth` where the loop already chose Youth, directly:
- `apps/web/e2e/first-import.spec.ts`
- `apps/web/e2e/import-settings.spec.ts`
- `apps/web/e2e/gui/import-settings.capture.ts`
- `apps/web/e2e/gui/first-import.capture.ts`

Rows with match options keep clicking `Treat as new person`.

In `src/shell/import-section.test.tsx` and `src/features/import/ImportReview.test.tsx`, change an assertion or click only where it targets `Treat as new person` on a row with no match options. Make the same substitution there and nothing else.

`e2e/import.spec.ts` and `e2e/gui/import.capture.ts` must not change, because their rows have candidates.

Every other existing test is unchanged.

## Scope
May change:
- `apps/web/src/features/import/ImportReview.tsx`, `plan.ts`, `import.css`
- `apps/web/src/features/import/review-clarity.test.tsx` (new)
- the authorized substitutions in the six test files named above
- `apps/web/e2e/import-review.spec.ts`, `apps/web/e2e/gui/import-review.capture.ts` (new)

Must not change:
- `apps/web/src/features/import/client.ts`, `preview.tsx`
- `apps/web/src/shell/**` except `import-section.test.tsx` as authorized
- `apps/server/**`, `packages/**`, `fixtures/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/features/import src/shell/import-section.test.tsx src/shell/first-import.test.tsx` | every new test passes; existing tests pass (only the authorized substitutions) |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/import-review.spec.ts e2e/first-import.spec.ts e2e/import-settings.spec.ts e2e/import.spec.ts` | passes; `import-review.spec.ts` runs on desktop-chromium and phone-chromium; the others skip with the reason `Import review runs on one desktop and one phone engine` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/import-review/` has `first-import-rows`, `next-unresolved` for `desktop-chromium` and `phone-chromium` |
| 4 | Mutation | in a disposable worktree at the candidate, make `Go to next` target the last unresolved row, then run check 1 | `Go to next names and focuses the first unresolved row` fails; remove the worktree |
| 5 | Only authorized test edits | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | a subset of the six authorized files; `git diff origin/main...HEAD` on them shows only `Treat as new person` → category substitutions for rows without match options |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`review-clarity.test.tsx`)
Build small fictional `ImportPreview` objects.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `a row without match options asks only Adult or Youth` | no `Treat as new person`; detail `Not in WardBoard yet. Choose adult or youth.`; pressing `Youth` resolves it as new youth (replace sends `{ action: 'new', category: 'youth' }`) | button still shown; wrong resolution |
| `a row with match options keeps Treat as new person` | a namesake row still shows its match buttons and `Treat as new person` | removing it everywhere |
| `first import labels callings New callings` | `expectedVersion={0}` → stat `New callings N`; `expectedVersion={3}` → `Unfamiliar callings N` | label never changes |
| `unresolved rows say Needs a choice` | unresolved rows show the tag; after resolving, it is gone | color-only marking |
| `Go to next names and focuses the first unresolved row` | with rows 1 and 3 unresolved, the button says row 1's name and focuses it; after resolving row 1, it names row 3 | wrong order; no focus |
| `the count line tracks unresolved rows` | `2 of 3 need a choice`, then `1 of 3 …`, then gone | stale count |
| `planImportReview defaults firstImport to false` | called without the argument, the label is `Unfamiliar callings` | default flipped |

## e2e (`apps/web/e2e/import-review.spec.ts`)
desktop-chromium and phone-chromium, on its own `startCheckoutServer({ seed: false })`, with the fixture PDFs.
1. Preview. The stat says `New callings`.
2. Resolve every row except one in the middle, using `Adult`, `Youth` or the in-report conflict's choice.
3. The Replace button is disabled and `Go to next: {name}` names that row. Press it: that row is focused and visible in the viewport.
4. Resolve it, then Replace. The board appears.

Assert no horizontal overflow on phone.

## GUI verification
Required, on desktop-chromium and phone-chromium. Capture the first-import rows (Adult/Youth only, with `Needs a choice` tags) and the next-unresolved state after jumping. Compare with `Import.dc.html`. Fail on:
- a tag shown only by color
- controls under 44px
- horizontal scroll at 390px
- the focused row hidden behind sticky UI

## Human checks
- On `pnpm dev -- --empty --reset`, resolve all but one row, then use `Go to next`. Confirm it is easy to find.

## Out of scope
- Bulk "mark remaining as adult" and the fourth report (pending Mike).
- Mapping unfamiliar callings to existing ones (B-054).
- Server, preview JSON and `ImportSection` changes.
