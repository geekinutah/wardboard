# T-116: Server persistence, import apply, and operation channel for gender

**Milestone:** 3 — Server and collaboration / 6 — Import and photos
**Depends on:** T-114 (`packages/core` calling gender rules and placement refusal) and T-115 (`packages/importer` member gender parsing and reconciliation), both done before this task starts.
- Promoted from B-068 (Mike's decisions on 2026-10-30).

**Spec refs:**
- SPEC.md §5: imported callings get their default gender rule (`classifyCallingGender`) from their organization and title; custom positions added over the operation channel may specify `genderRule`; placements violating a gender rule are refused (`gender_mismatch`).
- SPEC.md §7, §8, §15: member `gender` (`'M' | 'F'`) is stored in SQLite, previewed, resolved when unknown on a new member (`needsGender`), and persisted on import replace.

## Goal
The server persists `members.gender` and `calling_assignments.gender_rule` in SQLite, plans and applies member genders and Handbook calling gender rules during import (requiring `gender: 'M' | 'F'` in `resolutions` whenever a new member's gender is unresolved), and accepts optional `genderRule` on `addAssignment` over the WebSocket operation channel while enforcing core's `gender_mismatch` refusal on placements.

## Design decisions (binding)

### SQLite migration (`apps/server/src/db/migrations/003-gender.ts`, new)
Register in `apps/server/src/db/migrations/index.ts` as migration `3` (`003-gender`):
```sql
ALTER TABLE members ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('M', 'F'));
ALTER TABLE calling_assignments ADD COLUMN gender_rule TEXT CHECK (gender_rule IS NULL OR gender_rule IN ('M', 'F', 'any', 'presidency_aligned'));
```
- **Persistence (`apps/server/src/store/persist.ts`):**
  - `readWard`: select `gender` from `members`. When non-null, validate with `oneOf(MEMBER_GENDERS, ..., 'member gender')` and set `gender` on the `Member`; when `null`, omit `gender` so existing tests that construct `Member` without `gender` still pass `toEqual`.
  - `writeWard` / member insert & update statements: write `member.gender ?? null` into `members.gender`.
  - `readAssignments`: select `gender_rule` from `calling_assignments`. When non-null, validate with `oneOf(CALLING_GENDER_RULES, ..., 'calling gender rule')` and set `genderRule` on `CallingAssignment`; when `null`, omit `genderRule`.
  - `writeBoard` / assignment insert statements: write `assignment.genderRule ?? null` into `calling_assignments.gender_rule`.

### Import plan, HTTP, and apply (`apps/server/src/import/`)
- **`types.ts`:**
  - `ImportResolution` for `action: 'new'` gains `readonly gender?: 'M' | 'F'`:
    `{ readonly action: 'new'; readonly category?: 'adult' | 'youth'; readonly gender?: 'M' | 'F' }`.
  - `PlannedCreation` for `kind: 'assignment'` gains `readonly organization: string` (the row's organization name so `applyImport` can call `classifyCallingGender(creation.organization, creation.title)`).
  - `ImportPlan` gains `readonly needsGender: readonly string[]`.
- **`plan.ts`:**
  - Compute `needsGender: string[]` in parallel with `needsCategory`: for each decision in `reconciled.decisions`, if `decision.kind === 'new'` and `decision.gender === null`, or if `decision.kind === 'ambiguous'` and `decision.gender === null`, push `decision.key` to `needsGender`.
  - Pass `row.organization` into `pushAssignment` so each `PlannedCreation` of `kind: 'assignment'` records `organization: row.organization`.
- **`apply.ts`:**
  - `genderForNew(decision, resolution)`: if `decision.gender !== null`, return `{ ok: false }` if `resolution?.gender !== undefined && resolution.gender !== decision.gender`, else return `{ ok: true, gender: decision.gender }`; if `decision.gender === null`, return `{ ok: true, gender: resolution?.gender }` (`'M' | 'F' | undefined`).
  - When `choice.kind === 'new'`, `Choice` carries `readonly gender?: 'M' | 'F'`. If `genderForNew` returns `{ ok: false }`, `choose(...)` returns `null` (causing `applyImport` to return `{ ok: false, error: 'unresolved' }`). When `choice.gender !== undefined`, set `gender: choice.gender` on the created `Member`; when `choice.gender === undefined`, omit `gender` on the created `Member`.
  - When `choice.kind === 'existing'`, let `nextGender = choice.decision.gender ?? existing.gender`; when `nextGender !== undefined`, set `gender: nextGender` on the updated `Member`.
  - When creating a new `CallingAssignment` (`creation.kind === 'assignment'`), set `genderRule: classifyCallingGender(creation.organization, creation.title)` from `@wardboard/core`. Existing matched assignments keep their stored `genderRule`.
- **`http.ts`:**
  - In `parseResolution`, allow optional `gender: 'M' | 'F'` on `{ action: 'new', ... }` (accepting `['action']`, `['action', 'category']`, `['action', 'gender']`, or `['action', 'category', 'gender']`; reject any other value for `gender` or extra keys with `400` `{"error":"bad_request"}`).
  - Include `needsGender: plan.needsGender` in the `/api/import/preview` JSON response.

### WebSocket operation channel (`apps/server/src/ws/operations.ts`)
- In `addAssignment` payload validation, allow optional `genderRule` (`'M' | 'F' | 'any' | 'presidency_aligned'`). Accept either `['groupId', 'title', 'type', 'positionCount']` or `['groupId', 'title', 'type', 'positionCount', 'genderRule']`. If `genderRule` is provided and not one of `CALLING_GENDER_RULES`, refuse with `bad_request` per existing payload validation conventions. Pass `genderRule` through to core's `addAssignment`.
- Placement operations (`placeInPosition`, `addToList`, `swap`, `releaseOccupant`) already call core and forward `{ ok: false, error }`, so `gender_mismatch` is automatically returned over the channel.

## Existing tests
Only these existing test files may be updated for the B-068 / SPEC §15 change promoting `gender` from discarded to kept and adding migration 3:
- `apps/server/test/db/schema.test.ts` (remove `gender` from `FORBIDDEN_MEMBER_COLUMN` and include `'gender'` in the expected `members` columns)
- `apps/server/test/backup/routes.test.ts` (update hardcoded `schemaVersion: 2` to `schemaVersion: 3` after adding migration 3)
- `apps/server/test/import/member-list-route.test.ts` (in `the member list leaves no discarded fields behind`, keep the check that all numeric age, birth date, phone, and email `values` are absent from disk and logs, and update the `gender` check to assert `gender` is stored on `members` rather than absent)
- `apps/server/test/import/routes.test.ts` (only if an assertion checks the exact key list of `/api/import/preview` JSON)

No assertion on numeric age, birth date, phone number, email, or record number may be removed, loosened, or skipped.

## Scope
May change:
- `apps/server/src/db/migrations/003-gender.ts` (new), `apps/server/src/db/migrations/index.ts`
- `apps/server/src/store/persist.ts`
- `apps/server/src/import/types.ts`, `apps/server/src/import/plan.ts`, `apps/server/src/import/apply.ts`, `apps/server/src/import/http.ts`
- `apps/server/src/ws/operations.ts`
- The existing test files listed under "Existing tests" above, within that rule.
- `apps/server/test/import/gender-server.test.ts` (new)

Must not change:
- `packages/**`, `apps/web/**`, `fixtures/**`, `docs/**`, `SPEC.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New server gender tests | `pnpm --filter @wardboard/server exec vitest run test/import/gender-server.test.ts` | all new tests pass |
| 2 | All server tests | `pnpm --filter @wardboard/server test` | all pass |
| 3 | Mutation A | in a disposable worktree at the candidate, omit `genderRule: classifyCallingGender(...)` in `apply.ts`, then run check 1 | `first import assigns Handbook gender rules and refuses mismatched placements over WebSocket` fails; remove the worktree |
| 4 | Mutation B | in a disposable worktree at the candidate, make `genderForNew` in `apply.ts` ignore a contradicting `resolution.gender` when `decision.gender !== null`, then run check 1 | `preview reports needsGender and replace validates resolution gender` fails; remove the worktree |
| 5 | Existing-test edits | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts'` | only files listed under "Existing tests" |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`apps/server/test/import/gender-server.test.ts`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `persists member gender and assignment genderRule across SQLite round-trips` | `gender` (`'M' \| 'F'`) and `genderRule` (`'M' \| 'F' \| 'any' \| 'presidency_aligned'`) survive `readWard` / `readBoard` and backup/restore | migration or `persist.ts` mapping missing |
| `first import assigns Handbook gender rules and refuses mismatched placements over WebSocket` | after importing the four fixture PDFs on an empty server and starting a proposal, placing a female imported member into a Bishopric/Elders Quorum calling or a male imported member into a Relief Society/Primary Presidency calling over WS fails with `gender_mismatch`, while placing a male imported member into `Primary Teacher` (`any`) succeeds | `apply.ts` not setting `gender` or `genderRule` |
| `preview reports needsGender and replace validates resolution gender` | `/api/import/preview` returns `needsGender: ['fairwell, sage casey kendall reagan', 'westdale, gus']`; `/api/import/replace` returns `400` on `gender: "X"`, `409` `{"error":"unresolved"}` when `resolution.gender` contradicts a known `decision.gender`, and `200` (persisting `gender: 'M'` / `'F'` on the namesake members) when valid `gender` is supplied | not validating or persisting `resolution.gender` |
| `addAssignment over WebSocket accepts optional genderRule` | sending `addAssignment` with `genderRule: 'F'` creates an assignment with `genderRule: 'F'` that refuses `'M'` members, and sending an invalid `genderRule` is refused with `bad_request` | WS handler dropping or not validating `genderRule` |

## Edge cases (each needs a test)
- Re-import preserves an existing matched assignment's custom `genderRule`.
- Invalid `gender` in `/api/import/replace` resolution returns `400`.
- Invalid `genderRule` in WS `addAssignment` returns an error and does not mutate the board.

## Human checks
none (T-117 carries the UI and end-to-end checks).

## Out of scope
- Web UI changes (T-117).
