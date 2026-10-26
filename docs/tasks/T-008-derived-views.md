# T-008: Derived views

**Milestone:** 2 — Board domain
**Depends on:** T-007
**Spec refs:** SPEC.md §5 (vacancies are concrete unfilled positions; dugout = no callings ∪ explicit inclusion), §7 (derived information: vacancies, each person's calling list; do not store a move list), §8 (removed members), §4 (overview vacancy counts)

## Goal
Pure functions in `packages/core/src/derive/` compute, from a `Board` and the `Ward`, the board's vacancies, each member's callings, the dugout, and vacancy counts per board group — the read model every screen uses.

## Design decisions (binding for this task)
- Functions (all pure, no mutation of inputs, deterministic ordering):
  - `vacancies(board): readonly Vacancy[]` — every position with no placement whose assignment is `enabled`. `Vacancy = { positionId, assignmentId, callingGroupId, boardGroupId }` (`boardGroupId` = the board group at the root of the calling-group chain). Positions of disabled assignments are never vacancies (SPEC §8: optional roles not shown as vacancies by default).
  - `callingsOf(board, memberId): readonly HeldCalling[]` — every position the member occupies, `HeldCalling = { positionId, assignmentId, title, callingGroupId, boardGroupId }`. Includes positions of disabled assignments only if occupied (an occupied position is still a calling).
  - `callingCounts(board): ReadonlyMap<MemberId, number>` — number of positions held per member (members with zero are absent).
  - `dugout(board, ward): readonly DugoutEntry[]` — `DugoutEntry = { memberId, explicit: boolean, callings: readonly HeldCalling[] }`. Membership is the union of (a) ward members holding no position on this board and (b) members in `board.dugoutInclusions`. A member in both appears once with `explicit: true`. **Removed members** (non-null `removedDate`) are included only through (b) — they never enter the dugout automatically (they are no longer in Current, and auto-including every removed member in every proposal would be noise). Explicit entries keep their remaining callings listed.
  - `vacancyCountsByBoardGroup(board): ReadonlyMap<BoardGroupId, number>` — vacancies per board group (every board group present, zero allowed).
  - `rootBoardGroupOf(board, callingGroupId): BoardGroupId` — exported helper used above.
- Ordering: vacancies and held callings by board-group `order`, then calling-group chain `order`s, then assignment `order`, then position `order`, then id (stable tiebreak). Dugout by member name using `localeCompare(…, 'en', { sensitivity: 'base' })`, then id.
- Inputs are assumed valid (produced by `createBoard`/`createWard`); no re-validation.

## Scope
May change:
- `packages/core/src/derive/` (new)
- `packages/core/src/index.ts` (one export line)
- `packages/core/test/derive/` (new)

Must not change: `packages/core/src/model/**`, `packages/core/src/fixtures/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Derive tests | `pnpm --filter core exec vitest run test/derive` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Build boards with `createBoard` (small hand-built boards for edge cases, `buildFixtureWard()` for realistic ones).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `vacancies lists unplaced positions of enabled assignments` | list of 4 with 3 filled → 1 vacancy; vacant single → 1 | counts placements instead of positions |
| `vacancies ignores disabled assignments` | disabled assignment with an empty position → not a vacancy | enabled flag ignored |
| `vacancies are ordered by board structure` | shuffled record insertion order still yields structural order | relies on object key order |
| `callingsOf returns every position a member holds` | fixture's two-calling member → 2 entries with titles | stops at first |
| `callingsOf is empty for an unplaced member` | → `[]` | — |
| `callingCounts counts positions per member` | fixture: two-calling member → 2; dugout members absent | — |
| `dugout includes members with no callings` | fixture's no-calling members all present with `explicit: false` | — |
| `dugout includes explicit inclusions with remaining callings` | member with 1 calling in `dugoutInclusions` → `explicit: true`, callings listed | union missing |
| `dugout lists a member once when both automatic and explicit` | no calling + explicit → one entry, `explicit: true` | duplicates |
| `removed members enter the dugout only explicitly` | removed member with no calling → absent; same member explicitly included → present | removed members flood dugout |
| `dugout is sorted by name case-insensitively` | `ada`, `Ben`, `Ádám` deterministic order | default sort |
| `vacancyCountsByBoardGroup covers every board group` | groups with zero vacancies present with 0; fixture totals equal `vacancies().length` | missing zero entries |
| `rootBoardGroupOf walks nested calling groups` | class inside a presidency-less nested group → its board group | only one level |
| `derive functions do not mutate inputs` | frozen fixture inputs; no throw and results equal across calls | in-place sort of a frozen array |

## Edge cases (each needs a test)
- Empty board and empty ward (all functions return empty results / empty maps).
- Member placed in a disabled assignment's position (still a calling).
- Nested calling groups three levels deep.

## Human checks
none

## Out of scope
- Any operation that changes a board (T-009+); diff (T-016); removed-position flags (T-017); search (T-019).
