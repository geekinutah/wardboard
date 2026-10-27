# T-013: Presidency release rule

**Milestone:** 2 — Board domain
**Depends on:** T-009, T-010, T-011, T-012
**Spec refs:** SPEC.md §5 (releasing a president also releases that presidency's counselors, Handbook 30.6; counselors keep their other callings and enter the dugout only if left with no callings; **no confirmation**; same atomic change; **PROPOSED** and adopted here: also applies to a bishop and the bishopric counselors, and to replacing a president through Release occupant; secretaries are not released), §3 (multiple callings), §12 scenario "Releasing a president also releases the counselors in the same atomic change…"

## Goal
Every board operation that releases the occupant of a president position also releases the counselors of that presidency, in the same operation, without touching secretaries or anyone's other callings.

## Design decisions (binding for this task)
- **Who is a president / counselor:** an assignment of type `single` with `leadershipRole: 'president'` (the bishop is the `president` of the `bishopric` group) or `'counselor'`. A presidency is one calling group: its counselors are the `counselor` single assignments whose `groupId` equals the president assignment's `groupId` (not nested groups). Assignments with `leadershipRole: null` (secretaries, clerks, advisers) are never affected.
- **When the rule fires:** the rule compares the board before and after an operation. A president is released when a president position that was occupied by member M before the operation is not occupied by M afterwards — vacated, given to someone else (Release occupant, swap), or deleted (`removeAssignment`). Filling a vacant president position does not fire it.
- **What it does:** for each released president, every counselor position of that presidency that is occupied after the operation is vacated, **except** a counselor position whose occupant was placed there by this same operation (for example, swapping the president with the first counselor keeps the former president in the first counselor position and releases only the second counselor). Released counselors keep every other calling. They get **no** explicit dugout inclusion (they appear in the dugout only through derived no-calling membership); existing explicit inclusions are left alone. Approvals for vacated positions are dropped by the usual `dropStaleApprovals`.
- **Where it applies:** add a pure helper in `packages/core/src/ops/presidency.ts`, `applyPresidencyRelease(before: Board, after: BoardInput): BoardInput`, and call it from **every** operation that changes placements, before `dropStaleApprovals` / `finalizeBoard`: `placeInPosition` and `addToList` (T-009, moving out of a president position), `swap` and `releaseOccupant` (T-010), `releaseCalling` and `moveToDugout` (T-011), `removePosition` and `removeAssignment` (T-012). The helper must be idempotent in effect and must not depend on which operation called it.
- Also export `presidencyReleases(before: Board, after: Board): readonly { memberId: MemberId; positionId: PositionId }[]` — the counselor placements the rule removed (positions held before but vacated by the rule), in board structural order. This lets UI and tests see the cascade without a separate operation.
- Each operation's error behavior is unchanged; the rule never causes an operation to fail.

## Scope
May change:
- `packages/core/src/ops/presidency.ts` (new)
- `packages/core/src/ops/move.ts`, `occupied.ts`, `dugout.ts`, `positions.ts` (only to call `applyPresidencyRelease`; no other behavior change)
- `packages/core/src/ops/index.ts` (one export line)
- `packages/core/test/ops/presidency.test.ts` (new). You may add helpers to `test/ops/helpers.ts`, but must not change existing helpers.

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/types.ts`, existing tests, anything else. If an existing test fails because it asserts that counselors stay after their president is released, do not change it: stop and report it with the file:line, because it contradicts SPEC §5.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Presidency tests | `pnpm --filter core exec vitest run test/ops/presidency.test.ts` | all pass |
| 2 | Every existing operation test still passes | `pnpm --filter core exec vitest run test/ops` | all pass |
| 3 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use the fixture ward (Relief Society presidency, bishopric, Teachers and Deacons quorum presidencies, Primary presidency with a vacant counselor) and small hand-built presidencies.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `releasing a president releases the counselors` | `releaseCalling` on the RS president → both counselor positions vacant in the same result | counselors kept |
| `the secretary is untouched` | RS secretary still placed | releases every position in the group |
| `counselors keep their other callings` | a counselor who also holds a list position keeps it and is not explicitly included | all callings released; inclusion recorded |
| `a counselor with no other calling gets no explicit inclusion` | `dugoutInclusions` unchanged | explicit inclusion recorded |
| `the bishop counts as a president` | releasing the bishop releases the two bishopric counselors; clerks and executive secretary untouched | bishopric skipped |
| `moving the president to the dugout releases the counselors` | `moveToDugout` → president included, counselors released and not included | counselors included |
| `release occupant on a president releases the counselors` | new president placed; old president released; counselors released | rule only on plain release |
| `moving the president elsewhere releases the counselors` | `placeInPosition` / `addToList` with `from` = president position | rule missed for moves |
| `swapping president and first counselor keeps the swapped-in counselor` | former president now first counselor (kept), second counselor released | releases the person just placed |
| `swapping with someone outside the presidency releases both counselors` | — | — |
| `removing a president assignment releases the counselors` | `removeAssignment` | rule missed for removals |
| `filling a vacant president position releases nobody` | `placeInPosition` into a vacant president | fires on any change to the position |
| `releasing a counselor releases nobody else` | — | fires on counselors |
| `only the same calling group is affected` | releasing the Teachers Quorum president leaves the Deacons Quorum and bishopric counselors | ward-wide release |
| `vacant counselor positions are fine` | Primary presidency with a vacant counselor | crash on vacant |
| `approvals of released counselors are dropped` | — | dangling approval |
| `presidencyReleases reports the cascade` | lists exactly the counselor placements removed, in structural order; `[]` when the rule did not fire | reports the president or secretaries |
| `the rule never makes an operation fail` | a request that previously succeeded still succeeds | — |

## Edge cases (each needs a test)
- President who is also one of the counselors of the same presidency (released from both).
- A counselor whose other calling is in a different presidency's counselor position (only the released presidency's position is vacated).
- Presidency with no counselor assignments.

## Human checks
none

## Out of scope
- Any confirmation dialog (SPEC: none), diff reporting (T-016), the drop dialog (T-035).
