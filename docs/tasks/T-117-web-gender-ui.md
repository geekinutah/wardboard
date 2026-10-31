# T-117: Web UI — import gender resolution, custom position gender rule, and desktop/phone placement refusal

**Milestone:** 4 — Desktop board / 5 — Phone / 6 — Import and photos
**Depends on:** T-114 (`packages/core`), T-115 (`packages/importer`), and T-116 (`apps/server`), all done before this task starts.
- Promoted from B-068 and B-072 (Mike's decisions on 2026-10-30).

**Spec refs:**
- SPEC.md §5: gender-mismatched placements are refused on desktop drag-and-drop, and incompatible destinations/candidates are omitted in phone Move and Fill sheets; adding a custom position lets the Editor choose `Any`, `Men only (M)`, or `Women only (F)` (defaulting to the Handbook rule for that organization and title).
- SPEC.md §8, §15: the import review lists `Gender` under **Kept** (resolving B-072) and asks `Male (M)` or `Female (F)` whenever a row resolved as a new member has `gender: null`.

## Goal
The web app:
1. Shows `Gender` in the import review's **Kept** chips (and not in Discarded) and requires choosing `Male` or `Female` for any row resolved as a new member whose `gender` is `null`.
2. Lets an Editor choose the gender rule (`Any`, `Men only`, `Women only`) when adding a position in Level 3 group detail, defaulting to `classifyCallingGender(organizationName, title)`.
3. Refuses gender-mismatched drops on the desktop board (including occupied single-position drops where neither Swap nor Release occupant is valid due to `gender_mismatch`) and filters out gender-incompatible destinations and candidates in the phone Move and Fill sheets.

## Design decisions (binding)

### 1. Import review (`apps/web/src/features/import/`)
- **`ImportReview.tsx`:**
  - Add `'Gender'` to `KEPT` (`['Name', 'Adult / Youth', 'Gender', 'Organization & calling', 'Vacancies', 'Outside callings']`). `DISCARDED` stays `['Phone', 'Email', 'Address', 'Birth date', 'Age', 'Record number', 'Class rosters', 'Ministering']` (resolving B-072).
- **`plan.ts` & `ImportReview.tsx` & `client.ts`:**
  - `ImportPersonDecision` in `plan.ts` includes `readonly gender?: 'M' | 'F' | null` (defaulting to `'M'` or `'F'` when present, or `null` when explicitly `null`; if omitted in older unit-test fixtures, treat `undefined` as settled so existing tests that don't test `gender: null` pass untouched!).
  - `Resolution` for `action: 'new'` gains `readonly gender?: 'M' | 'F'`.
  - When a row's effective action is `'new'` and `decision.gender === null`, `isDecisionResolved` requires `resolution.gender === 'M' || resolution.gender === 'F'`, and `ImportReview.tsx` renders a `Male` / `Female` radio group (`aria-label={`Gender for ${decision.name}`}`) alongside the `Adult` / `Youth` radio group.
  - Note: in `fixtures/lcr-reports/`, what are the two namesake rows (`Westdale, Gus` and `Fairwell, Sage Casey Kendall Reagan`)?
    - Both `Westdale, Gus` rows in `member-list.pdf` are `'M'`, and both `Fairwell, Sage Casey Kendall Reagan` rows in `member-list.pdf` have genders — wait: if `reconcile` in T-115 sets `memberListGenders` to keep the gender when all Member List rows with that canonical name share the **same** gender (e.g. both `Westdale, Gus` rows are `'M'`) and only sets `null` when namesake rows in `member-list.pdf` have **different** genders (or no row), OR if `ImportReview` renders the `Male` / `Female` picker whenever `decision.gender === null`, then if a test resolves a row with `decision.gender === null`, the test clicks `Male` or `Female` as well!
    - Even better: in `ImportReview.tsx`, when `decision.gender === null`, render the `Male` / `Female` picker; when `decision.gender === 'M' || decision.gender === 'F'`, `gender` is already known from the reports so no extra click is needed!

### 2. Add position gender rule (`apps/web/src/features/group-detail/GroupDetailView.tsx`)
- In the "+ Add position" form in `GroupDetailView.tsx`:
  - Add a `Gender requirement` select or radio control (`aria-label="Gender requirement"`) with options:
    - `Any` (`'any'`)
    - `Men only` (`'M'`)
    - `Women only` (`'F'`)
  - When the form opens (or as the user types the title before manually changing the control), default the selection using `classifyCallingGender(boardGroupName, title)` (mapping `'presidency_aligned'` to `'any'`).
  - Pass the chosen `genderRule` in `onAddAssignment({ groupId, title, type, positionCount, genderRule })` and forward it through `EditingLayer.tsx` / `sync` client to the server's `addAssignment` operation.

### 3. Desktop drag-and-drop & Phone Move/Fill sheets
- **Desktop (`apps/web/src/features/dnd/resolve.ts`):**
  - When dropping onto an occupied single position (`choices.length === 0` at line ~138), if `releaseOccupant` failed with `refusal.error.code === 'gender_mismatch'`, return `{ kind: 'blocked', message: refusal.error.message }` (just like `board_not_editable`), so the user sees the specific gender requirement refusal instead of the generic `FILLED_NO_OPTIONS` message.
- **Phone (`apps/web/src/features/phone-person/model.ts`):**
  - In `buildVacantDestinations(board, ward, memberId, query)`: filter out any destination where `canPlaceMemberInAssignment(board, ward, memberId as MemberId, assignment.id)` returns `{ ok: false }`.
  - In `buildFillCandidates(board, ward, positionId, query)`: look up the position's assignment and filter out any candidate where `canPlaceMemberInAssignment(board, ward, candidate.id, assignment.id)` returns `{ ok: false }`.

## Scope
May change:
- `apps/web/src/features/import/plan.ts`, `apps/web/src/features/import/ImportReview.tsx`, `apps/web/src/features/import/client.ts`
- `apps/web/src/features/group-detail/GroupDetailView.tsx`
- `apps/web/src/shell/EditingLayer.tsx`, `apps/web/src/sync/protocol.ts`, `apps/web/src/sync/client.ts` (only to forward optional `genderRule` on `addAssignment`)
- `apps/web/src/features/dnd/resolve.ts`
- `apps/web/src/features/phone-person/model.ts`
- Existing tests that list the `KEPT` chips in `ImportReview.test.tsx` (adding `'Gender'`) or resolve a `new` row with `gender: null` in e2e (`first-import.spec.ts`, `import-review.spec.ts`, `import-settings.spec.ts`, `member-list-import.spec.ts`, and their `gui/*.capture.ts` equivalents, only if a fixture namesake has `gender: null`).
- New tests:
  - `apps/web/src/features/import/gender-review.test.tsx` (new)
  - `apps/web/src/features/phone-person/gender-filter.test.ts` (new)

Must not change:
- `packages/**`, `apps/server/**`, `fixtures/**`, `docs/**`, `SPEC.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New web unit tests | `pnpm --filter web exec vitest run src/features/import/gender-review.test.tsx src/features/phone-person/gender-filter.test.ts` | all new tests pass |
| 2 | Full web unit suite | `pnpm --filter web test` | all pass |
| 3 | e2e | `pnpm --filter web run test:e2e` | all pass |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; inspect updated import/group-detail screenshots at desktop and phone viewports per `docs/gui-verification.md` |
| 5 | Mutation A | in a disposable worktree at the candidate, remove the `canPlaceMemberInAssignment` filter from `buildVacantDestinations` in `phone-person/model.ts`, then run check 1 | `phone move and fill models omit gender-incompatible destinations and candidates` fails; remove the worktree |
| 6 | Mutation B | in a disposable worktree at the candidate, allow `isDecisionResolved` in `import/plan.ts` to return `true` when `decision.gender === null` and `resolution.gender` is undefined, then run check 1 | `import review requires choosing Male or Female when a new member has null gender` fails; remove the worktree |
| 7 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 8 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `import review lists Gender under Kept and not Discarded` | `ImportReview` renders a `Gender` chip in the Kept list and not in Discarded | `Gender` missing from `KEPT` |
| `import review requires choosing Male or Female when a new member has null gender` | a `new` decision with `gender: null` is unresolved until `Male` or `Female` is selected, and selecting it includes `gender: 'M' \| 'F'` in the resolution payload | not requiring or sending `resolution.gender` |
| `add position form defaults gender requirement from Handbook and sends override` | opening Add position in `GroupDetailView` defaults `Gender requirement` and submits the selected `genderRule` (`'any' \| 'M' \| 'F'`) | dropping `genderRule` from `onAddAssignment` |
| `resolveDrop returns the gender_mismatch message on an occupied single position` | dropping a male member onto an occupied female-only single position returns `{ kind: 'blocked', message }` with the gender mismatch message rather than `FILLED_NO_OPTIONS` | swallowing `gender_mismatch` on occupied positions |
| `phone move and fill models omit gender-incompatible destinations and candidates` | `buildVacantDestinations` omits `'F'` callings for an `'M'` member (and vice versa) while keeping `'any'` callings; `buildFillCandidates` omits `'M'` members when filling an `'F'` vacancy | phone sheets offering invalid placements |

## Edge cases (each needs a test)
- `decision.gender` is `'M'` or `'F'` on a `new` row: only `Adult` / `Youth` is asked; no redundant `Male` / `Female` prompt is shown.
- Sunday School presidency alignment in `buildVacantDestinations` and `buildFillCandidates`: when the Sunday School President is `'F'`, vacant Sunday School Counselor seats are shown only to `'F'` members.

## Human checks
- In `pnpm dev -- --empty --reset`, import the four fixture PDFs, start a proposal, and try dragging a brother into a Relief Society calling or a sister into an Elders Quorum calling; confirm the drop is refused. On a phone viewport, tap a brother and tap `Move…`; confirm Relief Society and Young Women callings do not appear as destinations while Primary Teacher and Sunday School Teacher do.

## Out of scope
- Showing gender badges on Presentation mode tiles.
