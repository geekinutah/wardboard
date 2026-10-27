# T-016: Net diff

**Milestone:** 2 — Board domain
**Depends on:** T-008 (done)
**Spec refs:** SPEC.md §3 (snapshot-and-difference model: experimental moves reduce to the net change; returning everyone produces no changes), §5 (list extra positions are reported as an added position and a new calling), §7 (derived net suggested callings/releases; diff distinguishes added/removed positions from callings/releases; trimming an occupied position is a position change plus a release), §8 (removed members/positions do not change derived suggested callings/releases), §12 scenarios ("Multiple experimental moves reduce to the final net changes; moving back cancels…", "reassigning counselor oversight produces no suggested callings or releases", trimming/removing positions)

## Goal
A pure function in `packages/core/src/diff/` compares a board with the board it started from (a proposal's board against its saved baseline) and returns the net suggested callings, suggested releases, added positions, and removed positions.

## Design decisions (binding for this task)
- API:
  - `diffBoards(from: Board, to: Board): NetDiff`, where `from` is the earlier board (baseline) and `to` the later one (proposal board). It does not check board kinds, so later divergence work can compare a baseline with Current.
  - `proposalDiff(proposal: Proposal): NetDiff` is `diffBoards(proposal.baseline, proposal.board)`.
  - ```ts
    interface DiffPlacement { memberId: MemberId; positionId: PositionId; lineageId: LineageId; assignmentId: AssignmentId; title: string }
    interface DiffPosition  { positionId: PositionId; lineageId: LineageId; assignmentId: AssignmentId; title: string }
    interface NetDiff {
      callings: readonly DiffPlacement[];        // positions on `to`
      releases: readonly DiffPlacement[];        // positions on `from`
      addedPositions: readonly DiffPosition[];   // positions on `to`
      removedPositions: readonly DiffPosition[]; // positions on `from`
    }
    ```
    `title` is the assignment title on the board the position belongs to.
- **Position identity across boards is `lineageId`.** A lineage present on `to` but not on `from` is an added position. A lineage present on `from` but not on `to` is a removed position. Position ids and assignment ids are never used to match across boards.
- **Calling identity** (what counts as "the same calling" for a member):
  - Position of a `single` assignment: its lineage.
  - Position of a `list` assignment: the list as a whole. A list assignment on `to` corresponds to the list assignment on `from` that holds at least one of the same position lineages. A list with no lineage in common with any `from` list (for example a list added in the proposal) corresponds to nothing.
  - So a member who moves between positions of the same list, for instance re-added into a lower vacancy, is **not** a change.
- **Suggested calling:** a placement `(member, position)` on `to` whose calling identity the member did not hold on `from`.
  **Suggested release:** a placement on `from` whose calling identity the member does not hold on `to`. This includes a member whose position was trimmed away.
  When a member holds k positions in one list on one board and j on the other, the difference |k−j| is reported against the highest-`order` positions of the larger side. This case is defensive: ops prevent duplicates in a list.
- Changes to anything other than positions and placements produce no entries: oversight, dugout inclusions, approvals, tags or preferences, group names, visibility, assignment `enabled`, and ordering. Ward data (including `removedDate`) is not an input, so removal never changes the diff (§8).
- Ordering: `callings` and `addedPositions` in `to`'s structural order; `releases` and `removedPositions` in `from`'s structural order. Structural order is the order derived views use (`callingsOf`/`vacancies` in `src/derive/views.ts`: board group, then the calling-group chain, then assignment, then position). Tests use fixture data with unique sibling orders, so tie-break details (B-014) are out of scope. You may reimplement the comparator locally in `src/diff/`; do not edit `src/derive/`.
- Pure, deterministic, non-mutating. The result is deep-frozen (use `deepFreeze` from `src/model/freeze.ts`), as other core outputs are.

## Scope
May change:
- `packages/core/src/diff/diff.ts`, `packages/core/src/diff/types.ts`, `packages/core/src/diff/index.ts` (new)
- `packages/core/src/index.ts` (one export line)
- `packages/core/test/diff/diff.test.ts` (new), `packages/core/test/diff/helpers.ts` (new, optional)

Must not change: `packages/core/src/model/**`, `src/derive/**`, `src/ops/**`, `src/rules/**`, `src/fixtures/**`, `src/search/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Diff tests | `pnpm --filter core exec vitest run test/diff/diff.test.ts` | all tests pass, at least the 18 named below |
| 2 | Export | `pnpm --filter core exec vitest run test/diff/diff.test.ts -t "is exported from the package root"` | 1 test passes, proving that `diffBoards` and `proposalDiff` imported from `../../src/index.ts` are functions |
| 3 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Build scenarios from `buildFixtureWard()` and `buildFixtureProposal()`, then drive the proposal board with the real core operations from `src/ops`: `placeInPosition`, `addToList`, `swap`, `releaseOccupant`, `releaseCalling`, `moveToDugout`, `addToDugout`, `applyPresidencyRelease`, `addAssignment`, `addListPosition`, `removePosition`, and `removeAssignment`. Do not hand-edit placements, except in the defensive duplicate-list test. Core has no oversight operation, so the oversight test rebuilds the board with `createBoard` and a changed `oversight` array.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `a fresh proposal has an empty diff` | baseline equals board, so all four lists are empty | reports every placement |
| `moving a member to a vacancy is one calling and one release` | release on the baseline source position, calling on the destination | reports only the calling |
| `several experimental moves reduce to the net change` | A→v1→v2→v3 gives one release (source) and one calling (v3) | accumulates intermediate moves |
| `moving back cancels the change` | A→v1 then back to the source gives an empty diff | compares position ids rather than lineage or calling identity |
| `a swap is two callings and two releases` | — | treats a swap as a no-op or double-counts |
| `releasing one of several callings is only that release` | other callings are absent from the diff | releases all callings |
| `presidency release lists each released counselor and secretary` | the president release cascade shows every release | only the president |
| `moving within the same list is not a change` | a member released from a list and re-added into a different position of the same list gives an empty diff | matches list positions by lineage |
| `adding beyond a list's positions is an added position and a calling` | §5 extra position | the calling is reported without the position change |
| `adding a vacant list position is only an added position` | — | phantom calling |
| `trimming an occupied position is a removed position and a release` | §7 | the release is lost because the position is gone |
| `removing an assignment lists each of its positions and releases` | — | only the first position |
| `an added assignment's placements are callings` | a new custom assignment in the proposal, filled | crashes on a missing `from` assignment |
| `oversight and dugout changes produce no diff` | reassigning counselor oversight or adding to the dugout gives an empty diff (§12) | diffs every board field |
| `a removed member's placements still diff normally` | ward with `removedDate` set: same diff as before (§8) | filters removed members |
| `entries are in structural order with titles` | callings/added in `to` order, releases/removed in `from` order; `title` from the right board | object key order; title from the wrong board |
| `the diff does not mutate its inputs and is frozen` | deep-frozen inputs don't throw; the result is frozen | mutation |
| `is exported from the package root` | public API | missing export line |

## Edge cases (each needs a test)
- Both boards have no positions: empty diff.
- A member placed on `to` who is absent from `from` entirely (never placed): calling only.
- Defensive duplicate: a member on two positions of one list on `to` and one on `from` gives exactly one calling, against the higher-`order` position. Hand-build the board with `createBoard`.
- `proposalDiff(p)` deep-equals `diffBoards(p.baseline, p.board)`.

## Human checks
none

## Out of scope
- Oversight grouping and the accepted summary text (T-018); the summary page and CSV (T-042); the phone changes screen (T-051).
- Divergence notices between Current and a baseline (later tasks may call `diffBoards`; this task doesn't build notices).
- Changing structural order tie-breaks (B-014) or editing `src/derive/`.
