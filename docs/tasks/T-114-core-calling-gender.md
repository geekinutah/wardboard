# T-114: Core model, Handbook calling gender rules, and placement refusal

**Milestone:** 2 — Board domain
**Depends on:** none (promoted from B-068; Mike's decisions on 2026-10-30, documented in `HUMAN_BACKLOG.md` item 8 and `docs/handbook-calling-gender.md`).
- Runs in parallel with T-115 (`packages/importer`). Neither touches the other's files.

**Spec refs:**
- SPEC.md §5: gender-limited callings per the General Handbook Chart of Callings (30.8.1; `docs/handbook-calling-gender.md`), Sunday School presidency gender alignment (Handbook 13.2.2.1), custom position gender rule option, and hard refusal (`gender_mismatch`) on incompatible placements.
- SPEC.md §7: `Member.gender` (`'M' | 'F'`) and `CallingAssignment.genderRule` (`'M' | 'F' | 'any' | 'presidency_aligned'`).

## Goal
`packages/core` models optional member gender (`'M' | 'F'`) and calling assignment gender rules (`'M' | 'F' | 'any' | 'presidency_aligned'`), classifies any calling's default gender rule from its organization and title per `docs/handbook-calling-gender.md`, accepts an optional `genderRule` on `addAssignment`, and refuses (`gender_mismatch`) any placement, list addition, swap, or occupant replacement that violates a calling's gender rule or Sunday School presidency gender alignment.

## Design decisions (binding)

### Model (`packages/core/src/model/`)
```ts
export const MEMBER_GENDERS = ['M', 'F'] as const;
export type MemberGender = (typeof MEMBER_GENDERS)[number];

export const CALLING_GENDER_RULES = ['M', 'F', 'any', 'presidency_aligned'] as const;
export type CallingGenderRule = (typeof CALLING_GENDER_RULES)[number];
```
- `Member` gains `readonly gender?: MemberGender`.
  - In `copyMember` (`ward.ts`), copy `gender` **only** when `input.gender !== undefined` (`...(input.gender !== undefined ? { gender: input.gender } : {})`), so existing tests that compare `createWard` output with `toEqual` against fixtures without `gender` pass untouched.
  - In `validateMember` (`ward.ts`), when `member.gender !== undefined`, require `isOneOf(MEMBER_GENDERS, member.gender)`, else report `invalid_field` at `members.<key>.gender`.
- `CallingAssignment` gains `readonly genderRule?: CallingGenderRule`.
  - In `copyBoard` (`board.ts`), copy `genderRule` **only** when `a.genderRule !== undefined` (`...(a.genderRule !== undefined ? { genderRule: a.genderRule } : {})`).
  - In `validateAssignments` (`board.ts`), when `assignment.genderRule !== undefined`, require `isOneOf(CALLING_GENDER_RULES, assignment.genderRule)`, else report `invalid_field` at `assignments.<key>.genderRule`.

### Handbook classifier & placement check (`packages/core/src/rules/gender.ts`, new)
Export from `packages/core/src/rules/index.ts` and `packages/core/src/index.ts`:
```ts
export function classifyCallingGender(organizationName: string, title: string): CallingGenderRule;
export function canPlaceMemberInAssignment(
  board: Board,
  ward: Ward,
  memberId: MemberId,
  assignmentId: AssignmentId,
  options?: { readonly ignorePositions?: ReadonlySet<PositionId> },
): { readonly ok: true } | { readonly ok: false; readonly requiredGender: MemberGender; readonly message: string };
```

**`classifyCallingGender(organizationName, title)` rules** (case-insensitive, trimmed, internal whitespace collapsed; matches `docs/handbook-calling-gender.md`):
1. Organization is `Bishopric`, `Elders Quorum`, `Aaronic Priesthood Quorums`, or `Young Men / Aaronic Priesthood` (or contains `Aaronic Priesthood` or `Elders Quorum` or `Bishopric`) → `'M'`.
2. Organization is `Relief Society` or `Young Women` (or contains `Relief Society` or `Young Women`) → `'F'`.
3. Organization is `Primary`:
   - Title is or ends with `President`, `First Counselor`, `Second Counselor`, or `Secretary` (excluding any title containing `Activity`, `Music`, `Teacher`, or `Nursery`) → `'F'`.
   - Everything else in `Primary` (`Primary Teacher`, `Nursery Leader`, `Primary Music Leader`, `Primary Pianist`, `Valiant Activities Leader`, etc.) → `'any'`.
4. Organization is `Sunday School`:
   - Title is `President`, `Sunday School President`, `First Counselor`, `Sunday School First Counselor`, `Second Counselor`, `Sunday School Second Counselor`, `Secretary`, or `Sunday School Secretary` → `'presidency_aligned'`.
   - Everything else in `Sunday School` (`Sunday School Teacher`, `Gospel Doctrine Teacher`, `Youth Sunday School Teacher`, `Resource Center Specialist`, etc.) → `'any'`.
5. Across any organization (including `Ward Missionaries`, `Temple and Family History`, `Other Callings`, `Ward-wide Callings`, `Music`):
   - Title is `Ward Mission Leader` or `Assistant Ward Mission Leader` → `'M'`.
   - Title is `Ward Temple and Family History Leader` → `'M'`.
   - Title is `Priesthood Music Director` → `'M'`.
   - Everything else → `'any'`.

**`canPlaceMemberInAssignment` rules:**
- Look up `member = ward.members[memberId]` and `assignment = board.assignments[assignmentId]`.
- If `member?.gender === undefined` (legacy/synthetic test member with no gender recorded), return `{ ok: true }`.
- Determine `rule = assignment?.genderRule ?? 'any'`.
- If `rule === 'any'`, return `{ ok: true }`.
- If `rule === 'M'` or `rule === 'F'`:
  - If `member.gender === rule`, return `{ ok: true }`.
  - Otherwise return `{ ok: false, requiredGender: rule, message: `${assignment.title} requires a ${rule === 'M' ? 'male' : 'female'} member` }`.
- If `rule === 'presidency_aligned'` (Handbook 13.2.2.1 — Sunday School presidency and secretary):
  - Find all positions belonging to assignments in the same `CallingGroup` (`assignment.groupId`) whose `genderRule` is `'presidency_aligned'`, excluding any position in `options?.ignorePositions`.
  - For each such position that is occupied in `board.placements`, look up the occupant's `gender` in `ward.members`.
  - If any remaining occupied seat in that presidency group has a known `gender` (`'M'` or `'F'`) that differs from `member.gender`, return `{ ok: false, requiredGender: existingGender, message: `${assignment.title} must match the gender of the Sunday School presidency (${existingGender})` }`.
  - Otherwise return `{ ok: true }`.

### Operations (`packages/core/src/ops/`)
- **`move.ts` (`placeInPosition`, `addToList`):**
  - Add `'gender_mismatch'` to `MOVE_ERROR_CODES`.
  - Before committing the placement, check `canPlaceMemberInAssignment(board, ctx.ward, memberId, assignment.id, { ignorePositions: from !== null ? new Set([from]) : undefined })`. (Also if `from !== null` and `from` is a president whose release vacates counselors/secretary in the same group, compute the post-release positions or check against the drafted board's remaining presidency occupants!)
  - Simplest, exact way for all placement operations (`placeInPosition`, `addToList`, `swap`, `releaseOccupant`):
    - Check static `'M'` / `'F'` and `'presidency_aligned'` against the **post-presidency-release** placements (`applyPresidencyRelease(board, drafted).placements`)!
    - Why? Because if someone replaces a male Sunday School President with a female Sunday School President via `releaseOccupant` (or moves a counselor out of a presidency), `applyPresidencyRelease` vacates the old president's counselors and secretary in the same atomic operation (Handbook 30.6), leaving no conflicting presidency occupants!
    - And in `swap(board, ctx, { memberId, from, to })`, check **both** `memberId` at `to` and `displaced` at `from` on the post-release board; if either fails, return `operationError('gender_mismatch', check.message)`.
- **`occupied.ts` (`swap`, `releaseOccupant`, `occupiedDropOptions`):**
  - Add `'gender_mismatch'` to `OCCUPIED_ERROR_CODES`.
  - Because `occupiedDropOptions` runs `swap` and `releaseOccupant`, it automatically omits any option that fails with `'gender_mismatch'`.
- **`positions.ts` (`addAssignment`):**
  - `AddAssignmentRequest` gains `readonly genderRule?: CallingGenderRule`.
  - If `request.genderRule !== undefined`:
    - Validate `isOneOf(CALLING_GENDER_RULES, request.genderRule)`; if invalid, return `operationError(INVALID_OPERATION, 'genderRule must be M, F, any, or presidency_aligned')`.
    - Set `genderRule: request.genderRule` on the created `CallingAssignment`.
  - If `request.genderRule === undefined`, omit `genderRule` on the created `CallingAssignment` so existing `positions.test.ts` assertions pass unmodified.

## Scope
May change:
- `packages/core/src/model/types.ts`, `packages/core/src/model/ward.ts`, `packages/core/src/model/board.ts`, `packages/core/src/model/index.ts`
- `packages/core/src/rules/gender.ts` (new), `packages/core/src/rules/index.ts`
- `packages/core/src/ops/move.ts`, `packages/core/src/ops/occupied.ts`, `packages/core/src/ops/positions.ts`
- `packages/core/src/index.ts`
- `packages/core/test/rules/gender.test.ts` (new)

Must not change:
- `packages/core/src/fixtures/ward.ts`
- every existing test file
- `packages/importer/**`, `apps/**`, `docs/**`, `SPEC.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New gender tests | `pnpm --filter @wardboard/core exec vitest run test/rules/gender.test.ts` | all new tests pass |
| 2 | Full core suite | `pnpm --filter @wardboard/core test` | all tests pass; existing tests pass unmodified |
| 3 | Mutation A | in a disposable worktree at the candidate, make `classifyCallingGender` return `'any'` for Primary Presidency titles, then run check 1 | `classifies Primary presidency and secretary as F and other Primary callings as any` fails; remove the worktree |
| 4 | Mutation B | in a disposable worktree at the candidate, skip the gender check in `placeInPosition`, then run check 1 | `refuses placing a member into a mismatched M or F calling` fails; remove the worktree |
| 5 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`packages/core/test/rules/gender.test.ts`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `createWard and createBoard validate gender and genderRule` | accepts `'M'` and `'F'` on members and `'M' \| 'F' \| 'any' \| 'presidency_aligned'` on assignments; rejects invalid strings with `invalid_field` | missing runtime validation |
| `classifyCallingGender classifies male-only organizations and leaders` | Bishopric (including clerks/executive secretary), Elders Quorum, Aaronic Priesthood Quorums, Ward Mission Leader, Assistant Ward Mission Leader, Ward Temple and Family History Leader, Priesthood Music Director → `'M'` | missing org or leader rule |
| `classifyCallingGender classifies female-only organizations` | Relief Society and Young Women callings (presidencies, teachers, advisers, specialists, class presidencies) → `'F'` | missing org rule |
| `classifies Primary presidency and secretary as F and other Primary callings as any` | Primary President, First/Second Counselor, Secretary → `'F'`; Primary Teacher, Nursery Leader, Primary Music Leader, Primary Pianist, Valiant Activities Leader → `'any'` | classifying all of Primary as `'F'` |
| `classifies Sunday School presidency and secretary as presidency_aligned and teachers as any` | Sunday School President, First/Second Counselor, Secretary → `'presidency_aligned'`; Sunday School Teacher, Gospel Doctrine Teacher, Resource Center Specialist → `'any'` | static `'M'` or `'any'` on Sunday School presidency |
| `refuses placing a member into a mismatched M or F calling` | `placeInPosition` and `addToList` return `gender_mismatch` when placing an `'F'` member into an `'M'` calling or an `'M'` member into an `'F'` calling; matching gender and `'any'` succeed | no check in `move.ts` |
| `enforces Sunday School presidency gender alignment` | when Sunday School President is `'F'`, placing an `'M'` counselor or secretary returns `gender_mismatch` while an `'F'` counselor succeeds; when President is vacant and a counselor is `'M'`, placing an `'F'` President returns `gender_mismatch`; replacing an `'M'` President with an `'F'` President via `releaseOccupant` succeeds because `applyPresidencyRelease` vacates the male counselors and secretary | presidency alignment not checked or checked before presidency release |
| `swap and releaseOccupant enforce gender rules on both positions` | `swap` fails with `gender_mismatch` if either member violates the other position's rule; `occupiedDropOptions` omits refused choices | checking only `to` on swap |
| `addAssignment stores an optional genderRule and rejects invalid values` | `addAssignment` with `genderRule: 'F'` persists `'F'` on the assignment; invalid `genderRule` returns `invalid_operation` | ignoring `request.genderRule` |

## Edge cases (each needs a test)
- Member with `gender: undefined` (legacy fixture) is allowed in any calling.
- Assignment with `genderRule: undefined` is treated as `'any'`.
- Case-insensitive and whitespace-normalized organization and calling titles in `classifyCallingGender`.
- Replacing a Sunday School President of one gender with a President of the other gender via `releaseOccupant` succeeds because counselors/secretary are released atomically.

## Human checks
none

## Out of scope
- Parsing gender from PDFs (T-115).
- Persisting gender in SQLite or wiring import/WS on the server (T-116).
- Web UI changes (T-117).
