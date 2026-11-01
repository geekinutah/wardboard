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
The server already sends the list of keys that need a gender (`needsGender: string[]` on the preview, next to `needsCategory`; `apps/server/src/import/plan.ts:177-191`, `http.ts:233`). It accepts `resolution.gender` only on a `new` resolution, and refuses one that contradicts a gender the reports settled (`apps/server/src/import/apply.ts:63-74`). The web follows the existing `needsCategory` pattern:

- **`plan.ts`:**
  - `ImportPreview` gains `readonly needsGender?: readonly string[]`. A missing field means `[]`, so existing fixtures without it keep passing.
  - `ImportReviewRow` gains `readonly needsGender: boolean`, true when the row's key is in `preview.needsGender`. `ambiguousRow`, the new-row branch and the returning-row branch of `decisionRows` all set it.
  - `decisionRows` emits a `kind: 'new'` row when the key is in `needsCategory` **or** `needsGender` (today it only checks `needsCategory`, so a new person who has a category but no gender would get no row). That row's `needsCategory` is set from the key's membership in `needsCategory`, not hard-coded to `true`.
  - The `action: 'new'` variant of `ImportResolution` gains `readonly gender?: 'M' | 'F'`.
  - `asNew`: when `row.needsGender`, it returns `null` unless `choice.gender` is `'M'` or `'F'`, and keeps that gender in the result. When the row doesn't need a gender, a supplied `choice.gender` makes it return `null`, the same way an unneeded `category` does today.
  - `normalize`'s shortcut (`matchOptions.length === 0 && !row.needsCategory` → `{ action: 'new' }`) also requires `!row.needsGender`.
  - A `match` resolution never carries a gender.
- **`ImportReview.tsx`:**
  - `KEPT` stays a string and becomes `'Names · youth/adult · gender · callings and positions · vacancies · outside-ward callings'`. `DISCARDED` doesn't change (this resolves B-072).
  - When a row needs a gender and the current choice is `new` (or the row has no match options), render `Male` and `Female` `ChoiceButton`s inside a `role="group"` element with `aria-label={`Gender for ${row.name}`}`, next to the `Adult` / `Youth` buttons. They follow the same visibility rule as `showCategory`.
  - Choosing `Adult`/`Youth` keeps any gender already chosen for that row, and choosing `Male`/`Female` keeps any category already chosen. Today `choose(row.key, { action: 'new', category })` replaces the whole choice, so it must merge instead.
  - The row detail text for a new row that needs a gender says so. For example, a row needing both says `Not in WardBoard yet. Choose adult or youth, and male or female.`; exact wording is up to the implementer.
  - A row where `needsGender` is false shows no Male/Female buttons.
- **`client.ts`:** change it only if it reshapes the preview or the resolutions. It must pass `needsGender` and `resolution.gender` through unchanged.
- **Fixture effect on e2e:** in the four fixture PDFs, `Westdale, Gus` is a report conflict, which T-115 settles as `gender: null`. `Fairwell, Sage Casey Kendall Reagan` appears twice in the Member List, so `memberListGenders` also yields `null` for it (`packages/importer/src/reconcile/reconcile.ts:186-205`). Any e2e or GUI flow that resolves one of those rows, or any other row in `needsGender`, as a new person must now also click `Male` or `Female`. Change only the specs and captures that fail for this reason, and change nothing else in them.

### 2. Add position gender rule (`apps/web/src/features/group-view/GroupDetail.tsx`)
- `AddAssignmentRequest` (from `@wardboard/core`, `packages/core/src/ops/positions.ts:94`) already has an optional `genderRule`. `BoardShell.tsx:170` sends the request object as it is, so the sync layer needs no change.
- The Add position form (`GroupDetail.tsx:~245-370`) gains a `<select aria-label="Gender requirement">` with options `Any` (`any`), `Men only` (`M`) and `Women only` (`F`). While the Handbook default for the current title is `presidency_aligned`, the select also offers `Same as presidency` (`presidency_aligned`). This follows SPEC §5 as amended on 2026-10-31.
- The form receives the organization's name (the board group's `name`, already looked up at `GroupDetail.tsx:511`) as a new prop. Until the Editor changes the select, its value follows `classifyCallingGender(organizationName, title.trim())` as they type, and `presidency_aligned` selects `Same as presidency`. Once the Editor changes the select, typing no longer resets it.
- `onAddPosition` is called with `genderRule` set to the selected value (`'any' | 'M' | 'F' | 'presidency_aligned'`). The server already accepts all four (`apps/server/src/ws/operations.ts:317-322`).

### 3. Desktop drag-and-drop and the phone Move/Fill sheets
- **Desktop (`apps/web/src/features/dnd/resolve.ts:138-145`):** in the `choices.length === 0` branch, if `refusal.error.code === 'gender_mismatch'`, return `{ kind: 'blocked', message: refusal.error.message }`, as the `board_not_editable` case already does. Vacant single and list drops already go through `checked(...)` and get the core refusal.
- **Phone (`apps/web/src/features/phone-person/model.ts`):**
  - `buildVacantDestinations(board, ward, memberId, query)` (line 92) leaves out every destination where `canPlaceMemberInAssignment(board, ward, memberId as MemberId, assignmentId)` returns `{ ok: false }`.
  - `buildFillCandidates(board, ward, positionId, query)` (line 179) uses the position's `assignmentId` and leaves out every candidate where `canPlaceMemberInAssignment(board, ward, candidateId, assignmentId)` returns `{ ok: false }`.

## Scope
May change:
- `apps/web/src/features/import/plan.ts`, `apps/web/src/features/import/ImportReview.tsx`, `apps/web/src/features/import/client.ts` (only as section 1 allows)
- `apps/web/src/features/group-view/GroupDetail.tsx`
- `apps/web/src/features/dnd/resolve.ts`
- `apps/web/src/features/phone-person/model.ts`
- Existing tests, changed only by adding cases:
  - `apps/web/src/features/group-view/GroupDetail.test.tsx` (add-position gender test)
  - `apps/web/src/features/dnd/resolve.test.ts` (gender-mismatch drop test)
- Existing tests, changed only as needed for the new `Kept` text or the new gender step: `apps/web/src/features/import/ImportReview.test.tsx`, `review-clarity.test.tsx`, `plan.test.ts`; e2e `first-import.spec.ts`, `import.spec.ts`, `import-review.spec.ts`, `import-settings.spec.ts`, `member-list-import.spec.ts`, and their `e2e/gui/*.capture.ts` counterparts. The only changes allowed are asserting the new Kept text and clicking `Male`/`Female` on rows in `needsGender`. No assertion may be removed or loosened.
- New tests:
  - `apps/web/src/features/import/gender-review.test.tsx`
  - `apps/web/src/features/phone-person/gender-filter.test.ts`

Must not change:
- `packages/**`, `apps/server/**`, `fixtures/**`, `docs/**`, `SPEC.md`
- `apps/web/src/shell/**`, `apps/web/src/sync/**` (section 2 needs neither)
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New and extended web unit tests | `pnpm --filter web exec vitest run src/features/import/gender-review.test.tsx src/features/phone-person/gender-filter.test.ts src/features/group-view/GroupDetail.test.tsx src/features/dnd/resolve.test.ts` | all pass, including the five named tests and both edge-case tests below |
| 2 | Full web unit suite | `pnpm --filter web test` | all pass |
| 3 | e2e | `pnpm --filter web run test:e2e` | all pass |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. Per `docs/gui-verification.md`, inspect the import review (the Gender chip text and the Male/Female buttons on the namesake rows) and the Add position form (the Gender requirement select) at the desktop and phone viewports |
| 5 | Mutation A | in a disposable worktree at the candidate, remove the `canPlaceMemberInAssignment` filter from `buildVacantDestinations` in `phone-person/model.ts`, then run check 1 | `phone move and fill models omit gender-incompatible destinations and candidates` fails; remove the worktree |
| 6 | Mutation B | in a disposable worktree at the candidate, make `asNew` in `import/plan.ts` ignore `row.needsGender` (accept a `new` choice with no gender), then run check 1 | `import review requires choosing Male or Female when a new member has null gender` fails; remove the worktree |
| 7 | Mutation C | in a disposable worktree at the candidate, delete the `gender_mismatch` branch in `dnd/resolve.ts`, then run check 1 | `resolveDrop returns the gender_mismatch message on an occupied single position` fails; remove the worktree |
| 8 | Mutation D | in a disposable worktree at the candidate, drop `genderRule` from the `onAddPosition` call in `GroupDetail.tsx`, then run check 1 | `add position form defaults gender requirement from Handbook and sends override` fails; remove the worktree |
| 9 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 10 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | File | Behavior it proves | A bug that would make it fail |
|---|---|---|---|
| `import review lists Gender under Kept and not Discarded` | `gender-review.test.tsx` | the Kept text includes `gender`; no Discarded chip says `Gender` | `KEPT` not updated |
| `import review requires choosing Male or Female when a new member has null gender` | `gender-review.test.tsx` | a row in `needsGender` stays unresolved after Adult/Youth alone. After `Male` or `Female` it is resolved and the resolution sent is `{ action: 'new', category, gender }` | the gender isn't required, isn't sent, or is lost when Adult/Youth is chosen after it |
| `add position form defaults gender requirement from Handbook and sends override` | `GroupDetail.test.tsx` | in Relief Society, typing `Teacher` defaults the select to `Women only`. After changing it to `Any`, the submit sends `genderRule: 'any'`. In Sunday School, typing `Sunday School Second Counselor` and submitting without touching the select sends `genderRule: 'presidency_aligned'` | `genderRule` dropped, or the default not taken from `classifyCallingGender` |
| `resolveDrop returns the gender_mismatch message on an occupied single position` | `resolve.test.ts` | dropping an `M` member onto an occupied `F` single position returns `{ kind: 'blocked', message }` with core's gender message, not `FILLED_NO_OPTIONS` | `gender_mismatch` swallowed |
| `phone move and fill models omit gender-incompatible destinations and candidates` | `gender-filter.test.ts` | `buildVacantDestinations` leaves out `F` callings for an `M` member (and the reverse) and keeps `any` callings and members with no gender. `buildFillCandidates` leaves out `M` members for an `F` vacancy | the phone sheets offer placements core would refuse |

## Edge cases (each needs a test, in the file shown)
- `gender-review.test.tsx`: a new row whose key is in `needsCategory` but not `needsGender` shows only `Adult` / `Youth`, with no Male/Female group, and resolves without a gender. A row in `needsGender` only (category known) gets a row with only the Male/Female group.
- `GroupDetail.test.tsx`: `Same as presidency` is not offered for a title whose Handbook rule isn't `presidency_aligned` (for example `Sunday School Teacher` in Sunday School).
- `gender-filter.test.ts`: when the Sunday School President is `F`, vacant Sunday School Counselor seats (`presidency_aligned`) appear as destinations only for `F` members, and their Fill candidates are only `F` members or members with no gender.

## Human checks
- In `pnpm dev -- --empty --reset`, import the four fixture PDFs, start a proposal, and try dragging a brother into a Relief Society calling or a sister into an Elders Quorum calling; confirm the drop is refused. On a phone viewport, tap a brother and tap `Move…`; confirm Relief Society and Young Women callings do not appear as destinations while Primary Teacher and Sunday School Teacher do.

## Out of scope
- Showing gender badges on Presentation mode tiles.
