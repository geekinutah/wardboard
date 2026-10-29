# T-112: The import takes an optional Member List to set youth/adult

**Milestone:** 6 — Import and photos
**Depends on:**
- T-111 (Member List parser), which must be done first.
- T-105 and T-106 (the import screen), which are done.
- The Mike-supplied fixture set described in T-111.

Notes:
- Promoted from B-069, option (a), which Mike chose on 2026-10-29.
- This task changes the import end to end: importer, server and web. Run it alone, with no other task editing `ImportSection.tsx`, `features/import/**` or `apps/server/src/import/http.ts`.

**Spec refs:**
- SPEC.md §15: the report routes, the allow-list, and the shipped guide, which must match the app.
- SPEC.md §8: preview before replace; name-only matching; namesakes are never merged silently.
- SPEC.md §9: discarded fields never reach storage, logs or backups.

## Goal
The import accepts an optional fourth PDF, the LCR Member List. When it is supplied, any person whose youth/adult category is otherwise unknown gets it from the Member List, as long as their printed name appears there exactly once. The review then asks Adult or Youth only for the people the Member List can't settle. Without the fourth file, the import behaves exactly as today. The Member List never adds people and never changes matching.

## Design decisions (binding)

### Importer (`packages/importer`)
- `importReports` accepts an optional `memberList` document. When present, it parses it with `parseMemberList` and allow-lists it as the `member-list` source.
- In `reconcile`, a person whose category is `null` takes the category of the Member List entry whose name exactly matches theirs. The match uses the canonical name, the same normalization reconcile already applies.
- The category stays `null` in these cases:
  - no Member List entry has that name;
  - the name appears more than once in the Member List;
  - the matching entry was excluded because the person is under 11.
- A category already derived from Members without Callings is kept. If the Member List disagrees with it, the person's category becomes `null`, so the review asks. Neither report wins silently.
- Matching decisions (matched, new, namesake, resembles, report conflict) do not change.

### Server (`apps/server/src/import/http.ts`)
- Preview and replace bodies accept an optional fourth key, `memberList`. It takes the same base64 encoding as the other three.
- Exactly these key sets are valid:
  - the three existing keys;
  - the three existing keys plus `memberList`.
- Anything else stays 400.
- Duplicate-import fingerprints keep using the three existing reports only.
- Size limits and logging are unchanged. No log line names a person.

### Web
- **`features/import/client.ts`:** `ImportReportFiles` gains an optional `memberList`. `readReportFiles` encodes it when it is given. Preview and replace send it only when it is present.
- **`shell/ImportSection.tsx`:**
  - Add a fourth picker, labeled `Member list (optional)`, below the three required ones.
  - Its hint reads: `In LCR: Reports → Member List → Print → Download PDF. Optional: fills in adult or youth for people who hold callings.`
  - **Before implementing,** check the menu path against the human-backlog entry. Mike called the report "Member Directory"; the printed title is "Member List". If the backlog entry names a different path, use that one.
  - Preview stays enabled with only the three required reports.
  - The "How to get these reports" steps mention that the fourth file is optional.
- **`features/import/plan.ts` / `ImportReview.tsx`:** the sources row shows a `Member list` card with the status `Validated` or `Not supplied`. No other review change.

### Docs and SPEC
- `docs/import/guide.md`: add the Member List as an optional fourth download, with the same clicks as the hint.
  - If `docs/import`'s structural tests assert exactly three reports, change only that assertion to allow the optional fourth one, and report the diff.
- SPEC.md §15: after the three report routes, add `**CONFIRMED (2026-10-29):** An optional fourth report, Reports → Member List → Print → Download PDF, supplies youth/adult for people the other reports don't age. Only name and the derived category are kept; gender, age, birth date, phone and email are discarded before storage.`

## Scope
May change:
- `packages/importer/src/allowlist/import.ts`, `packages/importer/src/reconcile/reconcile.ts`, `packages/importer/src/index.ts`
- `apps/server/src/import/http.ts`
- `apps/web/src/features/import/client.ts`, `plan.ts`, `ImportReview.tsx`
- `apps/web/src/shell/ImportSection.tsx`, `import-section.css`
- `docs/import/guide.md`
- `SPEC.md` (the one sentence)
- New tests:
  - `packages/importer/test/member-list-reconcile.test.ts`
  - `apps/server/test/import/member-list-route.test.ts`
  - `apps/web/src/shell/member-list-picker.test.tsx`
  - `apps/web/e2e/member-list-import.spec.ts`
  - `apps/web/e2e/gui/member-list-import.capture.ts`
- The one authorized docs structural-test assertion, if needed.

Must not change:
- every other existing test file
- `fixtures/**`
- `apply.ts`, `plan.ts` (server), `roles.ts`, `references.ts`
- the store
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Importer tests | `pnpm --filter @wardboard/importer test` | new tests pass; existing tests pass unmodified |
| 2 | Server tests | `pnpm --filter @wardboard/server exec vitest run test/import` | new tests pass; existing tests pass unmodified |
| 3 | Web tests | `pnpm --filter web exec vitest run src/shell src/features/import` | new tests pass; existing tests pass unmodified |
| 4 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/member-list-import.spec.ts` | passes on desktop-chromium and phone-chromium; the other projects skip with the reason `Member list import runs on one desktop and one phone engine` |
| 5 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/member-list-import/` has `sources` and `review` for desktop-chromium and phone-chromium |
| 6 | Mutation | in a disposable worktree at the candidate, make reconcile take the Member List category even when the name appears twice, then run check 1 | `a name listed twice in the member list stays unknown` fails; remove the worktree |
| 7 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing, or only the one authorized docs-test file |
| 8 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 9 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Tests to write

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the member list fills unknown categories` (importer) | a person with a calling and no age gets the Member List category | not applied |
| `a name listed twice in the member list stays unknown` (importer) | namesakes in the Member List → category `null` | guessing between namesakes |
| `a child in the member list gives no category` (importer) | the person was excluded as under 11 → `null` | treating children as youth |
| `the member list never overrides or adds people` (importer) | someone only in the Member List creates no decision; matching kinds are unchanged | adding members |
| `a disagreement asks instead of choosing` (importer) | without-callings says youth and the Member List says adult → `null` | silent precedence |
| `preview accepts three or four reports` (server) | the 3-key and 4-key bodies return 200; a 5-key body or a misspelled key returns 400 | relaxing the key check |
| `with the member list, fewer people need a category` (server) | with the fixture set, the preview's `needsCategory` is smaller than without the Member List, and replace succeeds | not wired |
| `the member list leaves no discarded fields behind` (server) | after replace, the database files and logs contain none of the Member List fixture's genders, birth dates, phone numbers or emails | leakage |
| `the fourth picker is optional` (web) | Preview is enabled with three files; the fourth file is sent only when chosen; its label and hint are as specified | required by mistake |
| `the review shows the member list source` (web) | `Member list · Validated` when supplied, `Not supplied` otherwise | missing card |

## e2e (`member-list-import.spec.ts`)
- Uses its own `startCheckoutServer({ seed: false })` and the four fixture PDFs.
- Choose all four files, then Preview.
- Fewer rows need a choice than in the same run without the Member List. Assert both counts.
- Resolve the remaining rows, Replace, and confirm the board appears.

## GUI verification
Required, on desktop-chromium and phone-chromium: the sources step with four pickers, and the review. Compare with `Import.dc.html`. Fail on:
- horizontal scroll at 390px;
- controls under 44px;
- the optional label or hint clipped.

## Human checks
- `pnpm dev -- --empty --reset`: import all four fictional reports. Confirm that far fewer people need Adult or Youth, and that the review clearly shows the Member List was used.

## Out of scope
- Storing gender (B-068).
- Creating members from the Member List alone.
- Duplicate detection for the Member List.
