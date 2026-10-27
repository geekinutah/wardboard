# T-018: Oversight and accepted summary

**Milestone:** 2 — Board domain
**Depends on:** T-016 (done)
**Spec refs:**
- SPEC.md §3: the accepted summary is split by overseeing bishopric member, as plain text, with a copy action per group. The PROPOSED grouping applies: Relief Society under the Bishop by default; Elders Quorum presidency in a separate group for the stake presidency; other Elders Quorum callings in an "Elders Quorum president" group; anything without oversight under the Bishop.
- SPEC.md §4: bishop → priests quorum is fixed and not editable. Other oversight is editable, and is an assignment, not a calling. "Overseen by" appears on each affected organization or quorum.
- SPEC.md §7 (Oversight entity).
- SPEC.md §12: reassigning counselor oversight produces no suggested callings or releases; the summary is grouped by overseeing bishopric member, and each group is copyable on its own.
- Backlog B-010. Mike's decision (2026-10-27): **no duplicate overseers.**

## Goal
Each oversight target has at most one overseer, and the model enforces this. Pure core functions let a proposal's counselor oversight be edited and resolve who oversees any group. They also build the accepted callings-and-releases summary, grouped per SPEC §3 and rendered as plain text.

## Design decisions (binding for this task)

### Model rule (B-010)
- `validateOversight` in `src/model/board.ts` gains these rules. Use the new validation code `'duplicate_oversight'`, added to `VALIDATION_ERROR_CODES` in `src/model/result.ts`.
  - A **non-fixed** entry whose target is the priests quorum (calling group with key `priests_quorum`) is a `fixed_oversight` error at that entry's path. Message: the priests quorum is overseen only by the fixed bishop entry. This holds whatever the entry order.
  - Any other target with more than one entry is a `duplicate_oversight` error at the path of each entry after the first. Targets are compared by kind and id; the overseer is ignored, so two different overseers of one target is also a duplicate.
  - The existing fixed-entry errors are unchanged. That includes "may appear only once" for a second fixed bishop entry, which must not also get a `duplicate_oversight` error. The existing `createBoard enforces the fixed bishop oversight` test must keep passing unmodified.

### Oversight operations (`src/ops/oversight.ts`)
- `setOversight(board, ctx, { target, overseer })`: sets the single overseer of `target`. It replaces any existing entry for that target, or appends a new one with `fixed: false`.
- `clearOversight(board, ctx, { target })`: removes the entry. Resolution then falls back as described below.
- Errors, using the shared codes:
  - `board_not_editable` (via `checkEditable`).
  - `not_found` when the target group doesn't exist.
  - The operation-specific code `'fixed_oversight'` when the target is the priests quorum, for either operation.
  - `invalid_operation` when `overseer` is not one of `OVERSEERS`.
- Both follow the existing op conventions (`finalizeBoard`, `operationOk`/`operationError`, non-mutating). An op that changes nothing still returns ok with an equal board.
- They change only `oversight`. Placements, positions, dugout and approvals are untouched, so `diffBoards(before, after)` is empty.

### Resolution (`src/summary/oversight.ts`)
- `overseerOf(board, target): Overseer` returns the overseer of the target's own entry if it has one. Otherwise it walks the nearest ancestor with an entry: calling-group parent chain, then the root board group. With no entry anywhere, it returns `'bishop'`.
- It throws `TypeError` for a target that doesn't exist (a programming error).

### Summary (`src/summary/summary.ts`)
- `SUMMARY_GROUP_KEYS = ['bishop', 'first_counselor', 'second_counselor', 'eq_presidency_stake', 'eq_president'] as const`.
- Headings, exact text:
  - `Bishop`
  - `First Counselor`
  - `Second Counselor`
  - `Elders Quorum presidency — for the stake presidency` (the dash is an em dash)
  - `Elders Quorum president`
- `acceptedSummary(proposal, ward): readonly SummaryGroup[]`, where:
  - `SummaryGroup = { key; heading; callings: readonly SummaryLine[]; releases: readonly SummaryLine[] }`
  - `SummaryLine = { memberId; name; positionId; text }`
  - Groups appear in `SUMMARY_GROUP_KEYS` order. Groups with no lines are omitted.
  - Lines keep `proposalDiff` order within callings and within releases.
  - Built from `proposalDiff(proposal)`. Position changes (`addedPositions`/`removedPositions`) are not part of this summary.
- **Classifying a line.** Locate the line's position:
  - Callings: on `proposal.board`.
  - Releases: on `proposal.board` if a position with the same lineage exists there. Otherwise on `proposal.baseline`, using the baseline's structure and oversight.

  On that board, take the assignment's calling group and the root board group:
  - Root board group key `elders_quorum` and calling group kind `presidency` → `eq_presidency_stake`.
  - Any other root `elders_quorum` → `eq_president`.
  - Otherwise → the `overseerOf` that calling group on that board.
  - The default seed has no Relief Society entry, so Relief Society resolves to `bishop`.
- **Line text:** `${name} — ${boardGroup.name} · ${callingGroup.name} · ${assignment.title}`.
  - `name` is the shared member name from `ward`.
  - Omit the calling-group segment when its name equals the board group's name.
  - Use names from the board the position was located on.
- `summaryText(group): string` produces, joined with `\n`:
  - the heading line;
  - then `Callings:` with one `- ${text}` line each, omitted when empty;
  - then `Releases:` the same way, omitted when empty.
  - No trailing newline.
- `summaryAllText(groups)` joins each `summaryText` with a blank line (`\n\n`). For an empty array it returns exactly `No suggested callings or releases.`
- Pure, deterministic, non-mutating; outputs are deep-frozen. These functions do not look at `proposal.status`. Freezing the summary while Accepted is the server's job (T-025).

## Scope
May change:
- `packages/core/src/model/board.ts`: `validateOversight` only.
- `packages/core/src/model/result.ts`: add `'duplicate_oversight'`.
- `packages/core/src/ops/oversight.ts` (new), `packages/core/src/ops/index.ts` (export line).
- `packages/core/src/summary/oversight.ts`, `summary.ts`, `types.ts`, `index.ts` (new).
- `packages/core/src/index.ts` (one export line).
- `packages/core/test/model/board.test.ts`: add new tests only; do not modify existing ones.
- `packages/core/test/ops/oversight.test.ts`, `packages/core/test/summary/summary.test.ts` (new).

Must not change: `src/diff/**`, `src/derive/**`, `src/fixtures/**`, `src/rules/**`, `src/search/**`, other `src/ops/*` files, `apps/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Model rule tests | `pnpm --filter core exec vitest run test/model/board.test.ts` | all pass, including the 4 new oversight tests named below and the unmodified existing tests |
| 2 | Oversight op tests | `pnpm --filter core exec vitest run test/ops/oversight.test.ts` | all pass (at least the 8 named below) |
| 3 | Summary tests | `pnpm --filter core exec vitest run test/summary/summary.test.ts` | all pass (at least the 14 named below) |
| 4 | Export | `pnpm --filter core exec vitest run test/summary/summary.test.ts -t "is exported from the package root"` | 1 test passes. It proves that `setOversight`, `clearOversight`, `overseerOf`, `acceptedSummary`, `summaryText`, `summaryAllText` and `SUMMARY_GROUP_KEYS` from `../../src/index.ts` are defined. |
| 5 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `buildFixtureWard()` and `buildFixtureProposal()`. Its seed has:
- bishop fixed over the priests quorum;
- first counselor over the teachers quorum and Sunday School;
- second counselor over the deacons quorum and Primary.

Drive changes with real ops (`placeInPosition`, `addToList`, `releaseCalling`, `swap`, `applyPresidencyRelease`, `removePosition`, `setOversight`). Build invalid boards with `createBoard`.

**Model (`board.test.ts`, new tests)**

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `createBoard rejects a second overseer of the same target` | two entries (different overseers) for Primary → `duplicate_oversight` at `oversight[1]` | no duplicate check |
| `createBoard rejects an identical duplicate oversight entry` | the same entry twice → `duplicate_oversight` at the later path | the check compares overseers as well |
| `createBoard rejects a counselor over the priests quorum in either order` | non-fixed counselor → priests quorum, before or after the fixed bishop entry → `fixed_oversight` at the counselor's path only | the result depends on order; flags the bishop |
| `createBoard accepts one overseer per target` | the fixture seed and a board with distinct targets are valid | false positives on different targets |

**Ops (`oversight.test.ts`)**

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `setOversight replaces the existing overseer of a target` | Primary moves from second to first counselor, with exactly one entry | appends a duplicate |
| `setOversight adds an entry for an unassigned target` | Relief Society → first counselor; `fixed: false` | — |
| `clearOversight removes the entry` | — | — |
| `the priests quorum cannot be reassigned or cleared` | both ops → `fixed_oversight`; board unchanged | fixed entry editable |
| `oversight ops refuse Current and baseline boards` | `board_not_editable` | missing `checkEditable` |
| `oversight ops refuse a missing target` | `not_found` | — |
| `setOversight refuses an unknown overseer` | `invalid_operation` | — |
| `reassigning oversight produces no diff and leaves placements untouched` | `diffBoards` empty; placements, dugout and approvals deep-equal (§12) | op edits placements |

**Summary (`summary.test.ts`)**

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `overseerOf resolves the target, its ancestors, then the bishop` | a Primary class → second counselor (via Primary); the teachers quorum → first counselor; Relief Society → bishop; the priests quorum → bishop | no ancestor walk; wrong default |
| `overseerOf throws for a missing target` | — | silent bishop |
| `a fresh proposal has an empty summary` | `[]`, and `summaryAllText` gives the exact empty message | prints empty headings |
| `Primary and Sunday School changes group under their counselors` | — | everything under the bishop |
| `Relief Society and unassigned areas group under the bishop` | — | — |
| `Elders Quorum presidency changes go to the stake presidency group` | heading text exact | merged with `eq_president` |
| `other Elders Quorum callings go to the Elders Quorum president group` | — | — |
| `reassigned oversight regroups the summary` | after `setOversight` of Primary to the first counselor, Primary lines are under First Counselor | uses baseline oversight for callings |
| `a release of a trimmed position classifies by the baseline` | `removePosition` on an occupied position; the release groups via the baseline's structure | crash or wrong group when the position is gone |
| `a move between areas puts the release and calling in different groups` | — | groups by member, not by position |
| `groups appear in fixed order and empty groups are omitted` | — | object key order |
| `summary line text and block text are exact` | exact `summaryText` string for one group with callings and releases; the calling-group segment is omitted when its name equals the board group's | formatting drift |
| `summaryAllText joins groups with a blank line` | exact string | — |
| `summary does not mutate inputs and is frozen; is exported from the package root` | split into two tests if clearer; the export test name must match criterion 4 | mutation; missing export |

## Edge cases (each needs a test)
- A summary for a proposal whose only changes are position additions (an empty list position) → `[]`.
- A presidency release cascade lists every released member under the right group.
- A member whose name changes in `ward` after the moves shows the new shared name (§7: profiles are shared).

## Human checks
none. The wording of the headings may be revisited when the accepted view is built (T-043); that would be a new task.

## Out of scope
- Persisting or freezing the summary at acceptance (T-025); the accepted view, Copy buttons and CSV (T-042, T-043); the "Overseen by" UI (T-044).
- A SQLite constraint enforcing one overseer per target in `apps/server` migrations (report it as a finding if relevant; do not change the schema).
- Changing the fixture oversight seed or adding Messengers of Hope, Builders of Faith or Gatherers of Light groups.
