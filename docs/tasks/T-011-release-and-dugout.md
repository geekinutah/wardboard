# T-011: Release and dugout

**Milestone:** 2 — Board domain
**Depends on:** T-009 (operation conventions)
**Spec refs:** SPEC.md §3 (multiple callings: release only the selected calling; **Add to dugout** keeps all callings, is separate from release, and shows no warning), §5 (releasing leaves the slot vacant; releasing one of several callings does not put the person in the dugout; dragging a card from a calling to the dugout releases that calling and records explicit inclusion; automatic no-calling membership is modelled separately from explicit inclusion; assigning another calling clears explicit inclusion), §7 (DugoutInclusion), §8 (removed members), §12 scenarios on releases and the dugout

## Goal
`packages/core/src/ops/dugout.ts` adds three operations: release one specific calling, move a member from a calling to the dugout (release plus explicit inclusion), and Add to dugout (explicit inclusion without releasing anything).

## Design decisions (binding for this task)
- Follow the T-009 conventions in `src/ops/types.ts` unchanged (signature, one error, `checkEditable`, `dropStaleApprovals`, `finalizeBoard`, no change to `id`/`kind`/`version`, inputs never mutated). Do not edit `types.ts` or `move.ts`.
- **`releaseCalling(board, ctx, { memberId, positionId })`**:
  - The member must hold `positionId` → otherwise `not_placed`.
  - Effect: the position becomes vacant (it is not deleted; list size unchanged). Every other calling is kept. `dugoutInclusions` is **not** changed: a member left with no callings appears in the dugout through derived membership (T-008), not through an explicit inclusion; an existing explicit inclusion stays. Stale approvals are dropped.
  - Allowed for positions of disabled assignments (moving out is always allowed).
- **`moveToDugout(board, ctx, { memberId, from })`** (dragging a card from a calling to the dugout):
  - `from: PositionId`, held by the member → otherwise `not_placed`.
  - Effect: `from` becomes vacant, the member is appended to `dugoutInclusions` if not already there (never duplicated), every other calling is kept, stale approvals dropped.
- **`addToDugout(board, ctx, { memberId })`** (Add to dugout from search or a person card):
  - Effect: appends the member to `dugoutInclusions`; no placement changes.
  - Already explicitly included → `already_in_dugout` (so the server never broadcasts a no-op).
  - A member with no callings who is not explicitly included may be added (the inclusion is recorded; harmless and consistent).
  - Removed members (non-null `removedDate`) may be added: per T-008 this is the only way they enter the dugout.
- Operation-specific error codes, exported as `DUGOUT_ERROR_CODES`: `not_placed`, `already_in_dugout`. Shared codes also apply.
- There is no "remove from dugout" operation (SPEC is silent; explicit inclusion is cleared by assigning a calling, which T-009/T-010 already do).
- The presidency release rule is **not** applied here; T-013 adds it to `releaseCalling` and `moveToDugout`.

## Scope
May change:
- `packages/core/src/ops/dugout.ts` (new)
- `packages/core/src/ops/index.ts` (one export line)
- `packages/core/test/ops/dugout.test.ts` (new). You may add helpers to `test/ops/helpers.ts`, but must not change existing helpers.

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/types.ts`, `src/ops/move.ts`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Dugout tests | `pnpm --filter core exec vitest run test/ops/dugout.test.ts` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `fixtureSetup()`, `smallWard()` / `smallBoard()` and the helpers in `test/ops/helpers.ts`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `releasing a calling leaves its position vacant` | clerk released → position still exists, no placement | position deleted |
| `releasing one of several callings keeps the others` | fixture two-calling member (Jo Testwell) releases one → keeps the other | releases all |
| `releasing does not add an explicit dugout inclusion` | releasing a member's only calling → `dugoutInclusions` unchanged | release recorded as a dugout action |
| `releasing keeps an existing explicit inclusion` | — | inclusion cleared |
| `releasing a list position keeps the list size` | list of 4 → still 4 positions, 1 more vacancy | position removed |
| `moving to the dugout releases only that calling and records inclusion` | two-calling member → one released, other kept, member in `dugoutInclusions` once | other callings released; no inclusion |
| `moving to the dugout never duplicates an inclusion` | already included member moved again → listed once | duplicate entry (createBoard would reject) |
| `add to dugout keeps every calling` | three-calling member → all three kept, included | releases |
| `add to dugout of an included member is refused` | → `already_in_dugout`, board unchanged | silent duplicate |
| `add to dugout accepts members with no calling and removed members` | both ok | over-restriction |
| `the member must hold the position` | vacant or someone else's position → `not_placed` for `releaseCalling` and `moveToDugout` | releases another person |
| `releasing from a disabled assignment is allowed` | — | over-restriction |
| `stale approvals are dropped and others kept` | approved placement released → approval gone; unrelated approval kept | dangling approval |
| `operations refuse non-proposal boards` | Current, baseline → `board_not_editable` for all three | Current editable |
| `unknown ids are refused` | unknown member or position → `not_found` | crash |
| `version, id and kind are unchanged` | — | — |
| `results are frozen and inputs untouched` | — | mutation |

## Edge cases (each needs a test)
- Member with three callings moving the middle one to the dugout.
- Board with an empty `dugoutInclusions` and one already holding other members (order preserved, new member appended).

Avoid presidents with occupied counselor positions in these tests (or assert nothing about the counselors): T-013 adds the presidency release rule to these operations later and must not have to rewrite your tests.

## Human checks
none

## Out of scope
- The presidency release rule (T-013), positions and groups (T-012), swap / release occupant (T-010), the derived dugout view (T-008), the dugout panel UI (T-036).
