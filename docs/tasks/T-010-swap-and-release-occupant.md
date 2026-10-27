# T-010: Swap and release occupant

**Milestone:** 2 — Board domain
**Depends on:** T-009
**Spec refs:** SPEC.md §5 (dropping onto an occupied single offers Swap, Release occupant or Cancel; swap exchanges the two placements; release occupant places the incoming person and releases the displaced person from that calling; the displaced person enters the dugout automatically only if left with no callings; the source becomes vacant unless filled by a swap; from the dugout there is no swap; for a list source, swap moves the displaced occupant into that list and must not duplicate a list member; each operation is atomic), §3 (dragging from a calling releases only that calling; Current is read-only), §6 (approvals are tied to member and position), §12 scenarios on occupied drops

## Goal
`packages/core/src/ops/occupied.ts` adds the two operations offered when a member is dropped onto an occupied single calling (swap, and release occupant), plus a function that tells the UI which of them is available for a given drop. Cancel is a UI action and needs no operation.

## Design decisions (binding for this task)
- Follow the T-009 conventions in `src/ops/types.ts` unchanged: `(board, ctx, request) => OperationResult`, fail fast with one error, `checkEditable`, `dropStaleApprovals`, `finalizeBoard`, never change `id`, `kind` or `version`, never mutate the input. Do not edit `types.ts` or `move.ts`; if you need a helper that is private in `move.ts`, write a local one in `occupied.ts`.
- **`swap(board, ctx, { memberId, from, to })`**, with `from: PositionId` (never null) and `to: PositionId`:
  - `from` must be held by `memberId` → otherwise `not_placed`.
  - `to` must be a position of a `single` assignment → a list position is `invalid_operation` (dropping onto a list never displaces anyone; use `addToList`).
  - `to` must be occupied → a vacant `to` is `position_vacant` (use `placeInPosition`).
  - The occupant of `to` must not be `memberId` → `invalid_operation`. `from === to` → `invalid_operation`.
  - **Both** assignments become destinations, so both must be enabled → `assignment_disabled` (T-009 ruling: only destinations must be enabled; in a swap, `from` is the displaced occupant's destination).
  - If `from` is a list position and the displaced occupant already holds another position in that list → `already_in_list`.
  - Effect: `memberId` occupies `to` and the displaced occupant occupies `from` (the same position id; a list source keeps its position, so the list's size is unchanged). Both members' explicit dugout inclusions are cleared (each is assigned a calling; SPEC §5). Stale approvals are dropped. Nothing else changes; neither member's other callings are touched.
- **`releaseOccupant(board, ctx, { memberId, from, to })`**, with `from: PositionId | null` (null = from the dugout or search):
  - Same checks as `swap` for `to` (single, occupied, not by `memberId`, enabled) and for `from` when non-null (held by `memberId` → else `not_placed`; `from === to` → `invalid_operation`). `from`'s assignment may be disabled (moving out of it is allowed).
  - Effect: the displaced occupant loses `to` and nothing else; `memberId` occupies `to`; `from` (if any) becomes vacant; `memberId`'s explicit dugout inclusion is cleared. The displaced occupant gets **no** explicit dugout inclusion: they appear in the dugout only through derived no-calling membership (T-008), so a member with remaining callings stays out of it. An existing explicit inclusion of the displaced occupant is left as it was. Stale approvals are dropped.
  - The presidency release rule is **not** applied here; T-013 adds it to this operation.
- **`occupiedDropOptions(board, ctx, { memberId, from, to }): readonly ('swap' | 'release_occupant')[]`** — the operations that would succeed for this drop, in that order, computed by running them (so the answer can never disagree with the operations). An empty array means only Cancel. Examples: from the dugout → `['release_occupant']`; from a list the displaced occupant is already in → `['release_occupant']`; onto Current → `[]`.
- Operation-specific error codes, exported as `OCCUPIED_ERROR_CODES`: `position_vacant`, `not_placed`, `assignment_disabled`, `already_in_list`. The shared codes also apply (`board_not_editable`, `not_found`, `invalid_operation`).
- Removed members (non-null `removedDate`) may be swapped or placed, as in T-009.
- Second-calling detection (T-014) and approval requirements (T-015) are not enforced here.

## Scope
May change:
- `packages/core/src/ops/occupied.ts` (new)
- `packages/core/src/ops/index.ts` (one export line)
- `packages/core/test/ops/occupied.test.ts` (new). You may add helpers to `test/ops/helpers.ts`, but must not change existing helpers.

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/types.ts`, `src/ops/move.ts`, anything else. If the model needs a change, report BLOCKED.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Occupied-drop tests | `pnpm --filter core exec vitest run test/ops/occupied.test.ts` | all pass |
| 2 | Existing move tests still pass | `pnpm --filter core exec vitest run test/ops/move.test.ts` | all pass |
| 3 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `fixtureSetup()`, `smallWard()` / `smallBoard()` and the other helpers in `test/ops/helpers.ts`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `swap exchanges two single placements` | A in X, B in Y; swap(A, X→Y) → A in Y, B in X | B released instead of moved |
| `swap from a list puts the displaced occupant in the same list position` | A in list position P, B in single Y → B in P, A in Y, list size unchanged | new list position created; P vacated |
| `swap refuses to duplicate a list member` | B already in A's source list → `already_in_list`, board unchanged | list holds B twice (createBoard would throw) |
| `swap keeps every other calling` | two-calling members on both sides keep their other callings | other callings released |
| `swap clears both explicit dugout inclusions` | both members explicitly included beforehand → neither is afterwards | only the mover's inclusion cleared |
| `swap requires both assignments to be enabled` | disabled source or destination → `assignment_disabled` | displaced occupant put in a disabled calling |
| `release occupant places the member and vacates the source` | A from X onto B's Y → A in Y, X vacant, B no longer in Y | source left filled |
| `release occupant from the dugout` | `from: null` → A in Y, B released | refuses dugout source |
| `displaced member with no remaining calling gets no explicit inclusion` | B held only Y → B holds nothing; `dugoutInclusions` does not gain B | explicit inclusion recorded (would make a later placement look like a dugout action) |
| `displaced member keeps their other callings` | B held Y and Z → B still holds Z | all of B's callings released |
| `release occupant leaves the displaced member's existing inclusion alone` | B explicitly included and holding Y → still included | inclusion cleared or duplicated |
| `release occupant may move out of a disabled assignment` | `from` in a disabled assignment → ok | over-restriction |
| `vacant destination is refused` | → `position_vacant` for both operations | silent fill |
| `list destination is refused` | → `invalid_operation` for both | displaces a list member |
| `dropping onto yourself is refused` | `to` already held by `memberId`, or `from === to` → `invalid_operation` | no-op success |
| `from must be held by the member` | → `not_placed` | releases someone else |
| `operations refuse non-proposal boards` | Current, baseline → `board_not_editable` | Current editable |
| `unknown ids are refused` | unknown member, `from` or `to` → `not_found` | crash |
| `stale approvals are dropped and others kept` | approvals for the moved pairs gone; an unrelated approval kept | dangling approval |
| `occupiedDropOptions lists the operations that would succeed` | single source → both; dugout source → release only; list source with duplicate → release only; Current → none | options disagree with the operations |
| `version, id and kind are unchanged` | — | op bumps version |
| `results are frozen and inputs untouched` | input deep-equal before/after; result deeply frozen | mutation of input |

## Edge cases (each needs a test)
- Swap between two positions of the same member's callings is impossible (`to` occupied by the member) → `invalid_operation`.
- Swap where the displaced occupant's only other calling is in the source list (already in it) → `already_in_list`.
- Release occupant where the incoming member is a removed member → ok.

Avoid presidents with occupied counselor positions in these tests (or assert nothing about the counselors): T-013 adds the presidency release rule to these operations later and must not have to rewrite your tests.

## Human checks
none

## Out of scope
- The presidency release rule (T-013), second-calling and approval rules (T-014, T-015), release and drag-to-dugout (T-011), the drop dialog UI (T-035).
