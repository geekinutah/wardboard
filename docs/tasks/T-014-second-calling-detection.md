# T-014: Second-calling detection

**Milestone:** 2 — Board domain
**Depends on:** T-009
**Spec refs:** SPEC.md §3 (any placement that would leave a member with more than one calling in that proposal requires confirmation; the confirmation names the member's existing calling(s) and notes General Handbook 30.1.1; deliberate friction, not a block; moves and swaps that do not increase a member's number of callings do not prompt), §12 scenario "placing someone so they would hold more than one calling requires confirmation citing Handbook 30.1.1"

## Goal
A pure preflight in `packages/core/src/rules/second-calling.ts` compares a board before and after an operation and reports every member who would end up with more callings than before and more than one in total, naming the callings they already held.

## Design decisions (binding for this task)
- **`secondCallingNotices(before: Board, after: Board): readonly SecondCallingNotice[]`** with
  `SecondCallingNotice = { memberId; countBefore: number; countAfter: number; existing: readonly ExistingCalling[] }` and
  `ExistingCalling = { positionId; assignmentId; title }`.
  - A member's calling count is the number of positions they occupy on the board (every placement counts, including disabled assignments).
  - A notice is produced iff `countAfter > countBefore` **and** `countAfter > 1`.
  - `existing` = the positions the member held both before and after the operation (the callings they keep), not the new ones.
- How it is used (for the record, not built here): the client runs the operation locally on its copy of the board (operations are pure), calls this function, shows the confirmation if there are notices, and only then sends the operation. This works for every operation without coupling to any of them.
- The function never blocks anything and has no notion of "allowed"; it only reports.
- Export `ONE_CALLING_GUIDANCE = { source: 'General Handbook 30.1.1', text: 'A member generally serves in only one calling at a time.' }` for the UI.
- Ordering: notices by member id; `existing` in board structural order (board group `order` → calling-group chain `order`s → assignment `order` → position `order` → id). A small local helper is fine; do not depend on `src/derive/` (T-008 runs in parallel).
- `before` and `after` are expected to be two versions of the same board (same `id`); otherwise throw a `TypeError` (programming error).
- Do not depend on `src/ops/` at runtime; tests may use T-009's operations to produce `after` boards.

## Scope
May change:
- `packages/core/src/rules/second-calling.ts` (new)
- `packages/core/src/rules/index.ts` (create it if missing, or add one export line if T-017 already created it)
- `packages/core/src/index.ts` (one export line for `rules`, only if not already present)
- `packages/core/test/rules/second-calling.test.ts` (new)

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Second-calling tests | `pnpm --filter core exec vitest run test/rules/second-calling.test.ts` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Produce `after` boards with `placeInPosition` / `addToList` from `src/ops/` where possible, and with `createBoard` (the `rebuild` helper in `test/ops/helpers.ts`) for swaps and releases, which T-010 and T-011 may not have merged yet.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `placing a member with a calling into a second one is reported` | fixture member with one calling placed from the dugout (`from: null`) → notice, 1 → 2, `existing` names the kept calling | no notice |
| `a member with no calling placed once is not reported` | 0 → 1 | reports every placement |
| `moving a member between callings is not reported` | `from` set: 1 → 1 | counts the destination only |
| `moving a two-calling member is not reported` | fixture Jo Testwell moves one calling: 2 → 2 | reports anyone with > 1 |
| `a third calling is reported with both existing callings` | 2 → 3, `existing` has the two kept callings in structural order | lists only one; includes the new calling |
| `swaps are not reported` | two members exchanging positions | — |
| `releases are not reported` | 2 → 1 | reports changes, not increases |
| `release occupant reports only the incoming member` | incoming member with a calling from the dugout → notice; displaced member → none | reports the displaced member |
| `several members can be reported at once` | hand-built after board with two increases → two notices ordered by member id | stops at first |
| `existing excludes callings released by the same operation` | member released from A and placed in B and C (hand-built) → 1 → 2, existing is empty | lists released callings |
| `disabled assignment positions count` | — | filters disabled |
| `different boards are refused` | `before` and `after` with different ids → `TypeError` | silent wrong comparison |
| `inputs are not mutated` | frozen inputs, equal results across calls | in-place sort |

## Edge cases (each needs a test)
- Identical boards → `[]`.
- Empty boards → `[]`.
- A removed member placed into a second calling is still reported.

## Human checks
none

## Out of scope
- The confirmation dialog (T-035), approval requirements (T-015).
