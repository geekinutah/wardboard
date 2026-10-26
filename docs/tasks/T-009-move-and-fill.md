# T-009: Move and fill (and the operation conventions)

**Milestone:** 2 — Board domain
**Depends on:** T-007
**Spec refs:** SPEC.md §3 (multiple callings: dragging from a calling releases only that calling; Current is read-only), §5 (slot persists and becomes vacant; single vs list; list drops add without displacing; no duplicate in a list; adding to a vacancy fills it first; **v0.19: adding beyond a list's size automatically creates an extra position**; assigning a calling clears explicit dugout inclusion), §6 (approvals are specific to member, position and proposal), §7, §10 (each edit is a single operation); §12 scenarios on moves, list drops and vacancies

## Goal
`packages/core/src/ops/` defines the shared conventions every board operation follows, and implements the two basic placement operations: placing a member into a vacant single position, and adding a member to a list assignment — each optionally moving them out of exactly one source position.

## Design decisions (binding for this task)
- **Conventions (`src/ops/types.ts`)** — later operation tasks import these unchanged:
  - `OperationContext = { readonly ward: Ward; readonly ids: IdGenerator }`.
  - `OperationError<C extends string = string> = { readonly code: C; readonly message: string }`.
  - `OperationResult<C extends string = string> = { ok: true; board: Board } | { ok: false; error: OperationError<C> }` — exactly one error; operations fail fast.
  - Shared codes exported as constants: `board_not_editable` (board `kind` is not `proposal`), `not_found` (member, position or assignment absent), `invalid_operation` (the request is self-contradictory).
  - `finalizeBoard(next: BoardInput, ward): Board` — runs `createBoard` and **throws** if it fails (an operation producing an invalid board is a programming error, not a user error). Every operation returns its board through this, so invariants are always rechecked and the result is deeply frozen.
  - Approval cleanup helper: after any change, approvals whose `(memberId, positionId)` is no longer a placement are dropped (approvals are tied to member and position; SPEC §6).
  - Operations never change `board.version` (the server owns versioning, T-024) or `board.id`/`kind`.
- **`placeInPosition(board, ctx, { memberId, from, to })`** (`src/ops/move.ts`):
  - `from: PositionId | null` — `null` means from the dugout / not from a calling. If non-null it must be a position currently occupied by `memberId`.
  - `to: PositionId` must belong to an **enabled `single`** assignment and be **vacant**. Occupied → error `position_occupied` (swap / release-occupant is T-010). List position as `to` → `invalid_operation` (use `addToList`).
  - Effect: `from` (if any) becomes vacant; `to` gets the member; the member is removed from `dugoutInclusions` (assigning a calling clears explicit inclusion); stale approvals dropped. All other placements unchanged (never release other callings).
  - `from === to` → `invalid_operation`.
- **`addToList(board, ctx, { memberId, from, assignmentId })`** (`src/ops/move.ts`):
  - Assignment must exist, be enabled and `type: 'list'`.
  - If the member already occupies a position in this list → `already_in_list` (moving within the same list is not a move). `from` inside the same list therefore errors as well.
  - Fills the vacant position with the lowest `order` (then id). If none is vacant, **creates a new position** with `id` and `lineageId` from `ctx.ids()` (two separate calls, position id first) and `order` = max existing order + 1, and places the member there.
  - `from` handling, dugout-inclusion clearing and approval cleanup as for `placeInPosition`.
- Operation-specific error codes: `position_occupied`, `already_in_list`, `not_placed` (`from` not held by the member), `assignment_disabled`, `wrong_assignment_type`. Export them as a const list.
- Removed members (non-null `removedDate`) may be placed — brainstorming with them is allowed (SPEC §8).
- Second-calling detection (T-014) and approval requirement (T-015) are **not** enforced here.

## Scope
May change:
- `packages/core/src/ops/` (new: `types.ts`, `move.ts`, `index.ts`)
- `packages/core/src/index.ts` (one export line)
- `packages/core/test/ops/` (new: `move.test.ts`, optional shared helpers file `test/ops/helpers.ts`)

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, anything else. If the model needs a change, report BLOCKED.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Move tests | `pnpm --filter core exec vitest run test/ops/move.test.ts` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `buildFixtureWard()` + `buildFixtureProposal()` and small hand-built boards.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `move from a calling to a vacant single leaves the source vacant` | RS teacher → vacant Primary single: destination filled, source position still exists and is vacant | source position deleted; source left filled |
| `moving releases only the source calling` | two-calling member moved from one calling keeps the other | releases all callings |
| `place from the dugout fills a vacancy` | `from: null` → filled; no other change | — |
| `placing clears explicit dugout inclusion` | explicitly included member placed → removed from `dugoutInclusions` | inclusion kept |
| `placing into an occupied single is refused` | → `position_occupied`, board unchanged | overwrites occupant |
| `placing into a list position via placeInPosition is refused` | → `invalid_operation` | — |
| `from must be held by the member` | `from` occupied by someone else or vacant → `not_placed` | releases another person |
| `same source and destination is refused` | → `invalid_operation` | no-op success that clears inclusion |
| `addToList fills the lowest vacant position first` | list with vacancies at order 2 and 4 → order 2 filled | fills last / creates extra |
| `addToList creates an extra position when the list is full` | full list of 4 → 5 positions, new id and lineage from `ctx.ids`, order 5, member placed | displaces someone; reuses lineage |
| `addToList refuses a member already in the list` | → `already_in_list`, also when `from` is in the same list | duplicate placement |
| `addToList moves from another calling` | source vacant afterwards | — |
| `disabled or wrong-type assignments are refused` | disabled → `assignment_disabled`; `addToList` on single → `wrong_assignment_type` | — |
| `operations refuse non-proposal boards` | Current and baseline → `board_not_editable` | Current editable |
| `unknown ids are refused` | unknown member/position/assignment → `not_found` | crash |
| `stale approvals are dropped` | approved member moved out → approval for the old pair gone; approvals of others kept | dangling approval (createBoard would throw) |
| `version, id and kind are unchanged` | — | op bumps version |
| `results are frozen and inputs untouched` | input board deep-equal before/after; result frozen | mutation of input |
| `removed members can be placed` | removed member placed successfully | over-restriction |
| `finalizeBoard throws on an invalid board` | direct test with a dangling placement | swallowed invalid state |

## Edge cases (each needs a test)
- List with zero positions (addToList creates the first one).
- Member with three callings moving out of the middle one.
- Placing into a list position with `from` in a different list.

## Human checks
none

## Out of scope
- Swap / release occupant (T-010), release and drag-to-dugout (T-011), positions and groups (T-012), presidency rule (T-013), second-calling and approval rules (T-014/T-015).
