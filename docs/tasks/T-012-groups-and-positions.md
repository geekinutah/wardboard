# T-012: Groups and positions

**Milestone:** 2 — Board domain
**Depends on:** T-009 (operation conventions)
**Spec refs:** SPEC.md §4 (the + control on each group adds a position with any title, single or list type, and a position count, only to the board being edited; custom definitions are local planning constructs; groups can be renamed, reordered, added or hidden), §5 (lists have a desired number of positions; reducing staffing need is a separate, explicit action), §7 (independent roster structures: a proposal may add or trim positions without touching other boards; removing an occupied position releases its occupant and explicitly places them in that proposal's dugout, even if they keep other callings; edits to slot definitions stay distinct from releases), §12 scenarios on adding and trimming positions

## Goal
`packages/core/src/ops/positions.ts` adds the structural edits of a proposal board: add a calling group, rename, reorder and hide groups, add an assignment with its positions, add a list position, remove a list position (reducing staffing need, or trimming an occupied one), and remove a whole assignment.

## Design decisions (binding for this task)
- Follow the T-009 conventions in `src/ops/types.ts` unchanged (signature, one error, `checkEditable`, `dropStaleApprovals`, `finalizeBoard`, no change to `id`/`kind`/`version`, inputs never mutated). Do not edit `types.ts` or `move.ts`.
- New ids come from `ctx.ids()` in the order documented per operation, so a caller that supplies the generator knows what was created (`OperationResult` carries only the board).
- Names and titles are trimmed; empty after trimming → `invalid_name`.
- **`addCallingGroup(board, ctx, { parent, name, kind })`** — `parent` is a `CallingGroupParent` (board group or calling group, must exist → else `not_found`); `kind` one of `CALLING_GROUP_KINDS` (else `invalid_operation`). Ids: group id. `order` = max order among siblings with the same parent + 1 (0 if none); `key: null`.
- **`renameGroup(board, ctx, { target, name })`** — `target` is `{ kind: 'boardGroup' | 'callingGroup'; id }`. Only the name changes; keys are untouched.
- **`setBoardGroupVisible(board, ctx, { boardGroupId, visible })`** — sets `visible`; nothing else changes (hiding never releases anyone or removes positions). Calling groups have no visibility in the model and are out of scope.
- **`moveGroup(board, ctx, { target, toIndex })`** — siblings are all board groups (for a board group) or the calling groups with the same parent (for a calling group), sorted by `order` then id. The target moves to 0-based `toIndex` (integer within `0..siblings-1`, else `invalid_operation`), and the siblings' `order`s are renumbered `0..n-1`. Nothing outside that sibling set changes.
- **`addAssignment(board, ctx, { groupId, title, type, positionCount })`** — calling group must exist. `type: 'single'` requires `positionCount === 1`; `type: 'list'` allows an integer `0..50`; anything else → `invalid_operation`. Ids: assignment id, then for each position (in order) its position id and then its lineage id. The assignment is `origin: 'custom'`, `enabled: true`, `prominent: false`, `leadershipRole: null`, no tags or preferences, `order` = max assignment order in that group + 1 (0 if none). Positions are vacant with `order` `0..n-1`. Duplicate titles are allowed.
- **`addListPosition(board, ctx, { assignmentId })`** — one more vacant position (the explicit "+1"): `wrong_assignment_type` for a single, `assignment_disabled` for a disabled list. Ids: position id, then lineage id. `order` = max + 1 (0 if none).
- **`removePosition(board, ctx, { positionId })`** — list positions only (a single's position → `wrong_assignment_type`; use `removeAssignment`). Deletes the position. If it was occupied, the occupant loses that placement and is appended to `dugoutInclusions` (never duplicated) even if they keep other callings; their other callings are untouched. Vacant: reducing staffing need, nothing else changes. Other positions' `order`s are unchanged. Allowed on disabled assignments. Leaving a list with zero positions is allowed.
- **`removeAssignment(board, ctx, { assignmentId })`** — deletes the assignment and all its positions; every occupant is released from those positions and explicitly included in the dugout (once each, in position order), keeping other callings. Approvals for deleted positions are dropped.
- Operation-specific error codes, exported as `POSITION_ERROR_CODES`: `invalid_name`, `wrong_assignment_type`, `assignment_disabled`. Shared codes also apply.
- The presidency release rule is **not** applied here; T-013 decides it for removals.
- Oversight entries are never touched by these operations.

## Scope
May change:
- `packages/core/src/ops/positions.ts` (new)
- `packages/core/src/ops/index.ts` (one export line)
- `packages/core/test/ops/positions.test.ts` (new). You may add helpers to `test/ops/helpers.ts`, but must not change existing helpers.

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/types.ts`, `src/ops/move.ts`, anything else. If the model needs a change, report BLOCKED.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Position tests | `pnpm --filter core exec vitest run test/ops/positions.test.ts` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `fixtureSetup()`, `smallWard()` / `smallBoard()`, `contextFor()` and the helpers in `test/ops/helpers.ts`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `addCallingGroup appends a group under its parent` | under a board group and under a calling group; id from `ctx.ids`, order = max + 1, key null | order 0 collides; wrong parent |
| `addAssignment creates a custom list with vacant positions` | list of 3 → 3 vacant positions with ids/lineages in the documented order, orders 0..2, custom, enabled | standard origin; shared lineage |
| `addAssignment creates a single with one position` | — | zero positions (createBoard would reject) |
| `addAssignment rejects bad counts and titles` | single with 2, list with -1, 51 or 1.5 → `invalid_operation`; `'  '` → `invalid_name` | accepts anything |
| `addListPosition adds one vacant position at the end` | fixture RS Teacher list 4 → 5, new position vacant | fills it; reuses lineage |
| `addListPosition refuses singles and disabled lists` | → `wrong_assignment_type`, `assignment_disabled` | — |
| `removing a vacant list position reduces staffing need` | 4 → 3 positions, occupants unchanged, dugout unchanged | releases someone |
| `removing an occupied list position releases and includes the occupant` | occupant no longer placed, appended to `dugoutInclusions`, other callings kept | no inclusion; all callings released |
| `removing an occupied position includes the member even with other callings` | fixture two-calling member (Jo Testwell) → included, keeps the other calling | inclusion only for members with no callings |
| `removing a single's position is refused` | → `wrong_assignment_type` | single left with zero positions |
| `removeAssignment deletes positions and includes every occupant once` | list with 2 occupants → assignment and positions gone, both included once in position order; removing a single assignment includes its occupant | occupants dropped without inclusion; duplicate inclusion |
| `structural edits do not touch other boards` | edit the proposal; Current and baseline deep-equal before/after; a second proposal from the same Current unchanged | shared references |
| `renameGroup trims and keeps keys` | board group and calling group renamed; `key` unchanged | key renamed |
| `setBoardGroupVisible hides without releasing` | hidden group's placements unchanged | hiding vacates |
| `moveGroup renumbers only siblings` | move calling group to index 0 → siblings 0..n-1; groups under other parents unchanged; out-of-range index → `invalid_operation` | renumbers all groups |
| `stale approvals are dropped and others kept` | approval on a removed position gone; unrelated approval kept | dangling approval |
| `operations refuse non-proposal boards` | Current, baseline → `board_not_editable` for every operation | Current editable |
| `unknown ids are refused` | → `not_found` | crash |
| `version, id, kind and oversight are unchanged` | — | — |
| `results are frozen and inputs untouched` | — | mutation |

## Edge cases (each needs a test)
- `addAssignment` list with `positionCount: 0`.
- Removing the last position of a list (list remains with zero positions).
- `moveGroup` to its current index (orders normalized, nothing else changes).
- Removing a position whose occupant is already explicitly included (not duplicated).

Avoid removing president assignments in these tests (or assert nothing about the counselors): T-013 adds the presidency release rule to these operations later and must not have to rewrite your tests.

## Human checks
none

## Out of scope
- The presidency rule on removals (T-013), net diff reporting of added/removed positions (T-016), the + control UI (T-034), enabling/disabling assignments, removing groups, adding board groups.
