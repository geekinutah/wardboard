# T-112: The import requires the Member List to set youth/adult

**Milestone:** 6 — Import and photos
**Depends on:**
- T-111 (Member List parser), which must be done first.
- T-105 and T-106 (the import screen), and T-113 (the `member-list.pdf` fixture), which are done.

Notes:
- Promoted from B-069, option (a), which Mike chose on 2026-10-29.
- **Revised 2026-10-30:** Mike said "It shouldn't be optional. It is necessary." The Member List is the fourth **required** report. LCR path, from Mike: **Reports → Member Directory → Print**. The printed title of the report is `Member List`.
- This task changes the import end to end: importer, server, web, guide and SPEC. Because the report becomes required, existing tests that send or name three reports must be updated, under the narrow rule in "Existing tests" below. Run it alone, with no other task editing import code or import tests.

**Spec refs:**
- SPEC.md §8 and §15: the report routes, preview before replace, the allow-list, and the shipped guide, which must match the app.
- SPEC.md §8: name-only matching; namesakes are never merged silently.
- SPEC.md §9: discarded fields never reach storage, logs or backups.

## Goal
Preview and replace require four PDFs: the existing three plus the LCR Member List. Any person whose youth/adult category is otherwise unknown gets it from the Member List, as long as their printed name appears there exactly once. The review asks Adult or Youth only for the people the Member List can't settle. The Member List never adds people and never changes matching.

## Design decisions (binding)

### Importer (`packages/importer`)
- `importReports` takes a required `memberList` document. It parses it with `parseMemberList` and allow-lists it as the `member-list` source. A Member List that fails to parse rejects the import the same way a bad report of the other three does.
- In `reconcile`, a person whose category is `null` takes the category of the Member List entry whose name exactly matches theirs. The match uses the canonical name, the same normalization reconcile already applies.
- The category stays `null` in these cases:
  - no Member List entry has that name;
  - the name appears more than once in the Member List;
  - the matching entry was excluded because the person is under 11.
- A category already derived from Members without Callings is kept. If the Member List disagrees with it, the person's category becomes `null`, so the review asks. Neither report wins silently.
- Matching decisions (matched, new, namesake, resembles, report conflict) do not change.
- The Member List takes part in the same unit consistency check as the other three reports: a Member List for a different unit makes `inconsistentReports` true.

### Server (`apps/server/src/import/http.ts`)
- Preview and replace bodies require exactly the four keys `organizations`, `withoutCallings`, `outOfUnit` and `memberList` (replace also keeps `expectedVersion` and `resolutions`). `memberList` takes the same base64 encoding as the other three.
- A body with only the three old keys, a missing or misspelled key, or an extra key is `400` `{"error":"bad_request"}`.
- Duplicate-import fingerprints keep using the three existing reports only. Do not change `plan.ts` or the stored fingerprint shape.
- Size limits and logging are unchanged. No log line names a person.

### Web
- **`features/import/client.ts`:** `ImportReportFiles` gains a required `memberList`. `readReportFiles` encodes it, and preview and replace always send it.
- **`shell/ImportSection.tsx`:**
  - Add a fourth required picker, labeled `Member list`, after `Out-of-unit callings`.
  - Its hint reads: `In LCR: Reports → Member Directory → Print → Download PDF. The printed report is titled "Member List".`
  - Preview stays disabled until all four reports are chosen.
  - Every "three" in the section's copy becomes "four" (for example `Create Current from the four LCR reports. …`, `Download the four reports above …`, and the read-failure message `Those files couldn't be read as the four LCR reports.`).
- **`features/import/plan.ts` / `ImportReview.tsx`:** the sources row shows a fourth card, `Member list`, with the same validated status as the other three. No other review change.

### Docs and SPEC
- `docs/import/guide.md`: the Member List is the fourth required download, with the same clicks as the hint. Every "three" that counts reports or PDF fields becomes "four", and the JSON examples include `memberList`.
- `scripts/import-guide.test.mjs`: update the two "three" tests to require the four downloads and the four JSON fields (see "Existing tests").
- SPEC.md:
  - §15, step 3 of the collection list (line ~499): add `**Reports → Member Directory → Print → Download PDF** (the printed title is "Member List")` as the fourth report.
  - After that list, add: `**CONFIRMED (2026-10-30):** The Member List is a required fourth report. It supplies youth/adult for people the other reports don't age. Only name and the derived category are kept; gender, age, birth date, phone and email are discarded before storage.`
  - §8: in the two `CONFIRMED` sentences that say "three reports" / "three verified PDF report routes" (lines ~229 and ~231), change "three" to "four". Change nothing else in SPEC.md, including the historical field-notes paragraph (line ~435) and the acceptance line at ~527 unless it counts the import PDFs (it does: "harvest the three PDFs" becomes "harvest the four PDFs").

## Existing tests
Existing tests that build a three-report body, choose three files, or assert three-report wording are now wrong per SPEC and may be updated, **only** in these ways:
- add the Member List fixture, field, file, label or picker alongside the existing three;
- change "three" to "four" in a test name, an expected string, or a label list;
- change an assertion that a three-key body succeeds into one that the four-key body succeeds, and add (not replace) an assertion that the three-key body is now `400`.

No other change to an existing test. No assertion may be deleted or loosened, and no test may be skipped. The files expected to need this are:
- `apps/server/test/import/routes.test.ts`, `first-import.test.ts`, `aaronic-links.test.ts`, `leadership-import.test.ts`, `helpers.ts`
- `apps/web/src/shell/import-section.test.tsx`, `apps/web/src/features/import/client.test.ts`
- `apps/web/src/features/import/plan.test.ts` (it asserts the three source cards at about lines 91 and 295), `ImportReview.test.tsx`, `review-clarity.test.tsx`, only where they list the report sources
- `apps/web/e2e/first-import.spec.ts`, `import-review.spec.ts`, `import-settings.spec.ts`
- `apps/web/e2e/gui/first-import.capture.ts`, `import-review.capture.ts`, `import-guidance.capture.ts`, `import-settings.capture.ts`, `tile-leaders.capture.ts`
- `scripts/import-guide.test.mjs`
- `packages/importer/test/reconcile.test.ts`, `allowlist.test.ts`, only if they call `importReports` without a Member List.

If another existing test must change, stop and report it. List every changed existing test file in the report with a one-line reason.

## Scope
May change:
- `packages/importer/src/allowlist/import.ts`, `packages/importer/src/reconcile/reconcile.ts`, `packages/importer/src/index.ts`
- `apps/server/src/import/http.ts`
- `apps/web/src/features/import/client.ts`, `plan.ts`, `ImportReview.tsx`, and `preview.tsx` (only if its sample data must gain the fourth source to typecheck)
- `apps/web/src/shell/ImportSection.tsx`, `import-section.css`
- `docs/import/guide.md`
- `SPEC.md` (only the sentences named above)
- The existing test files listed under "Existing tests", within that rule.
- New tests:
  - `packages/importer/test/member-list-reconcile.test.ts`
  - `apps/server/test/import/member-list-route.test.ts`
  - `apps/web/src/shell/member-list-picker.test.tsx`
  - `apps/web/e2e/member-list-import.spec.ts`
  - `apps/web/e2e/gui/member-list-import.capture.ts`

Must not change:
- `fixtures/**`
- `apps/server/src/import/apply.ts`, `apps/server/src/import/plan.ts`, `roles.ts`, `references.ts`
- the store
- `packages/importer/src/reports/**` (T-111 owns the parser)
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Importer tests | `pnpm --filter @wardboard/importer test` | all pass |
| 2 | Server tests | `pnpm --filter @wardboard/server exec vitest run test/import` | all pass |
| 3 | Web tests | `pnpm --filter web exec vitest run src/shell src/features/import` | all pass |
| 4 | Guide tests | `node --test scripts/import-guide.test.mjs` | all pass |
| 5 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/member-list-import.spec.ts e2e/first-import.spec.ts e2e/import-review.spec.ts e2e/import-settings.spec.ts` | pass; the new spec runs on desktop-chromium and phone-chromium, and the other projects skip it with the reason `Member list import runs on one desktop and one phone engine` |
| 6 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/member-list-import/` has `sources` and `review` for desktop-chromium and phone-chromium |
| 7 | Mutation A | in a disposable worktree at the candidate, make reconcile take the Member List category even when the name appears twice, then run check 1 | `a name listed twice in the member list stays unknown` fails; remove the worktree |
| 8 | Mutation B | in a disposable worktree, make the server accept the three old keys without `memberList`, then run check 2 | `preview requires all four reports` fails; remove the worktree |
| 9 | Existing-test edits | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.test.mjs' '*.spec.ts' '*.capture.ts' 'apps/server/test/import/helpers.ts'` | only files listed under "Existing tests"; the verifier reads each hunk and confirms no assertion was deleted, loosened or skipped (`git diff origin/main...HEAD -- <file> \| grep '^-' ` shows only lines replaced per the rule) |
| 10 | No leftover "three reports" | `grep -rniE "three (lcr )?reports\|three pdfs?\|three (official )?downloads\|three json fields\|three pdf fields" apps/web/src docs/import SPEC.md` | prints nothing, except SPEC's historical field-notes paragraph (~435) |
| 11 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 12 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Tests to write

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the member list fills unknown categories` (importer) | a person with a calling and no age gets the Member List category | not applied |
| `a name listed twice in the member list stays unknown` (importer) | namesakes in the Member List → category `null` | guessing between namesakes |
| `a child in the member list gives no category` (importer) | the person was excluded as under 11 → `null` | treating children as youth |
| `the member list never overrides or adds people` (importer) | someone only in the Member List creates no decision; matching kinds are unchanged | adding members |
| `a disagreement asks instead of choosing` (importer) | without-callings says youth and the Member List says adult → `null` | silent precedence |
| `a member list for another unit is inconsistent` (importer) | a Member List with a different unit → `inconsistentReports: true` | skipping the unit check |
| `preview requires all four reports` (server) | the 4-key body returns 200; the old 3-key body, a 5-key body, and a misspelled `memberList` key each return 400 | relaxing the key check |
| `with the member list, fewer people need a category` (server) | with the fixture set, the preview's `needsCategory` is smaller than the number of people with a calling and no Members-without-Callings age (compute that count from the same fixtures in the test), and replace succeeds | not wired |
| `the member list leaves no discarded fields behind` (server) | after replace, the database files and logs contain none of the Member List fixture's genders, birth dates, phone numbers or emails | leakage |
| `the fourth picker is required` (web) | Preview is disabled with three files and enabled with four; the fourth file is sent as `memberList`; its label and hint are as specified | still optional |
| `the review shows the member list source` (web) | the sources row has a `Member list` card with the validated status | missing card |

## e2e (`member-list-import.spec.ts`)
- Uses its own `startCheckoutServer({ seed: false })` and the four fixture PDFs.
- With three files chosen, Preview is disabled. Choose the Member List; Preview is enabled.
- Preview; the review shows the `Member list` source card. Assert the number of rows needing Adult or Youth, and that it is smaller than the count from check "with the member list, fewer people need a category" without the Member List (hard-code the expected numbers from the fixtures and say in the report how they were derived).
- Resolve the remaining rows, Replace, and confirm the board appears.

## GUI verification
Required, on desktop-chromium and phone-chromium: the sources step with four pickers, and the review. Compare with `Import.dc.html`. Fail on:
- horizontal scroll at 390px;
- controls under 44px;
- the label or hint clipped.

## Human checks
- `pnpm dev -- --empty --reset`: confirm Preview stays disabled until all four fictional reports are chosen, then import them. Confirm that far fewer people need Adult or Youth than before, and that the review shows the Member List source.
- In real LCR, confirm the hint's clicks (Reports → Member Directory → Print → Download PDF) produce a PDF titled "Member List".

## Out of scope
- Storing gender (B-068).
- Creating members from the Member List alone.
- Including the Member List in duplicate-import fingerprints.
