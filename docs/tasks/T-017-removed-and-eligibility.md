# T-017: Removed state and acceptance eligibility

**Milestone:** 2 — Board domain
**Depends on:** T-007
**Spec refs:** SPEC.md §3 (a proposal cannot be accepted while it places a removed member or contains a removed position), §8 (removed members and positions in proposals: removal is derived, not stored; proposal data is never rewritten; positions unique to a proposal remain valid), §12 scenarios on removed members/positions

## Goal
Pure functions in `packages/core/src/rules/removed.ts` derive which placements and positions of a proposal are affected by removal from Current, and whether the proposal is eligible for acceptance.

## Design decisions (binding for this task)
- `removedState(proposal, current, ward): RemovedState` where
  `RemovedState = { members: readonly { memberId; positionIds: readonly PositionId[] }[]; positions: readonly PositionId[] }`.
  - **Removed member placement:** a placement on `proposal.board` whose member has a non-null `removedDate`. Grouped per member, position ids in board order.
  - **Removed position:** a position on `proposal.board` whose `lineageId` exists in `proposal.baseline` **and** does not exist in `current`. Positions whose lineage is absent from the baseline were added in the proposal (e.g. an extra list position) and are **never** flagged — "a position intentionally unique to a proposal remains valid" (§8).
  - A removed position that is also occupied by a removed member appears in both lists.
- `acceptanceEligibility(proposal, current, ward): { eligible: boolean; reasons: readonly EligibilityReason[] }`, `EligibilityReason = { kind: 'removed_member'; memberId; positionIds } | { kind: 'removed_position'; positionId }`. Eligible iff no reasons. (Other acceptance conditions, if any, are added by later tasks; this function covers removal only.)
- Pure and non-mutating; the proposal's placements, vacancies and derived changes are untouched (§8: removal changes nothing but flags).
- `current` must be `kind: 'current'`; otherwise throw a `TypeError` (programming error).
- Ordering: members by name (`localeCompare` `'en'`, base sensitivity) then id; positions in board structural order (board group → calling group → assignment → position `order`, then id).

## Scope
May change:
- `packages/core/src/rules/removed.ts`, `packages/core/src/rules/index.ts` (new)
- `packages/core/src/index.ts` (one export line)
- `packages/core/test/rules/removed.test.ts` (new)

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Removed-state tests | `pnpm --filter core exec vitest run test/rules/removed.test.ts` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Build scenarios from `buildFixtureWard()` / `buildFixtureProposal()` by constructing modified wards/Currents with `createWard`/`createBoard` (e.g. set a member's `removedDate`; build a Current without one position).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `a fresh proposal has no removed state and is eligible` | fixture proposal vs fixture Current → empty, eligible | false positives |
| `a placed removed member is flagged with every position they hold` | member with 2 placements and a `removedDate` → one entry, 2 positions | only first position |
| `an unplaced removed member is not flagged` | removed member in the dugout only → no flag | flags ward members, not placements |
| `a position whose lineage left Current is flagged` | Current rebuilt without a lineage present in baseline → flagged | — |
| `a position added in the proposal is never flagged` | proposal gains an extra position with a new lineage (not in baseline or Current) → not flagged | compares against Current only |
| `a vacant removed position is still flagged` | — | only occupied positions checked |
| `removed member on removed position appears in both lists` | — | dedup across kinds |
| `eligibility lists every reason` | 2 removed members + 1 removed position → 3 reasons, not eligible | stops at first |
| `ordinary edits restore eligibility` | after the removed member's placement is cleared and the removed position dropped from the proposal board (rebuilt with `createBoard`) → eligible | stale cache |
| `removed state does not alter the proposal` | inputs deep-equal before/after; frozen inputs don't throw | mutation |
| `current must be a current board` | passing a baseline as `current` → `TypeError` | silent wrong comparison |
| `members are ordered by name` | deterministic ordering | object key order |

## Edge cases (each needs a test)
- Empty proposal board.
- Baseline and Current identical except for one position.
- Member removed from the ward data but restored (`removedDate` null again) → not flagged.

## Human checks
none

## Out of scope
- Rendering markers (T-040), divergence notices for positions *added* to Current (later diff/summary work), the import that sets `removedDate` (T-058).
