# T-015: Needs-approval placements

**Milestone:** 2 — Board domain
**Depends on:** T-009
**Spec refs:** SPEC.md §6 (a `needs_approval` member requires explicit approval each time they are proposed for a calling; any Editor or Admin may approve; approval is specific to member, position and proposal; store approver and time; fresh approval when member or position changes; **v0.19:** setting the flag makes existing proposed placements — suggested callings relative to the baseline — in Draft proposals require approval; Accepted proposals are unaffected until returned to Draft; clearing the flag removes the requirement; duplicating a proposal never copies approvals; the flag is not a tag), §7 (Approval), §12 scenario "Proposing a calling for a member with `needs_approval` set requires explicit approval…"

## Goal
`packages/core/src/rules/approval.ts` derives which placements of a proposal need approval and whether each has one, and provides the operation that records an approval plus the helpers the server needs when the flag is set or a proposal is duplicated.

## Design decisions (binding for this task)
- **A placement requires approval** iff, on the proposal board, member M occupies position P, `M.needsApproval` is true, and the placement is a **suggested calling** relative to the baseline: there is no position in the baseline with P's `lineageId` that is occupied by M. Placements unchanged since the baseline (for example the member's existing calling in Current) never require approval. A position the proposal added (lineage absent from the baseline) is always a suggested calling.
- An approval satisfies a requirement only if `board.approvals` holds an entry with the same `memberId` and `positionId` (the model already guarantees that every stored approval matches a current placement; operations drop stale ones, so moving the member or changing the position requires a fresh approval).
- **`approvalRequirements(proposal: Proposal, ward: Ward): readonly ApprovalRequirement[]`** with `ApprovalRequirement = { memberId; positionId; approval: Approval | null }`.
  - Returns `[]` for an Accepted proposal (unaffected until returned to Draft; once its status is Draft again the same function reports requirements, because they are derived).
  - Ordered by board structural order of the position (board group `order` → calling-group chain `order`s → assignment `order` → position `order` → id). A small local helper is fine; do not depend on `src/derive/`.
- **`unapprovedPlacements(proposal, ward)`** = the requirements whose `approval` is null.
- **`approvePlacement(board, ctx, { baseline, memberId, positionId, approvedBy, approvedAt })`** — an operation following the T-009 conventions (`OperationResult`, `checkEditable`, `finalizeBoard`, no change to `id`/`kind`/`version`):
  - Member and position must exist → `not_found`. M must occupy P → `not_placed`.
  - The placement must require approval (flag set and a suggested calling vs `baseline`) → otherwise `approval_not_required`.
  - Already approved → `already_approved` (no overwrite; a new approval needs the old one to have been dropped by a change).
  - `approvedBy` must be a non-empty string and `approvedAt` an ISO timestamp with `Z` or an offset → otherwise `invalid_operation`. Time is supplied by the caller (no clock in core).
  - `baseline` must have kind `baseline` → otherwise `invalid_operation`.
  - Effect: appends `{ memberId, positionId, approvedBy, approvedAt }` to `approvals`; nothing else changes.
  - Who may approve (Editor or Admin) and whether the proposal is Draft are server checks (T-024/T-025), not core.
- **`dropMemberApprovals(board, ward, memberId): Board`** — removes every approval of that member; used by the server when an Admin **sets** the flag, so existing placements need fresh approval. Works on any board kind; returns an equal board (same content) when there is nothing to drop.
- **`dropAllApprovals(board, ward): Board`** — removes every approval; used by the server when duplicating a proposal (duplicates never copy approvals).
- Clearing the flag needs no helper: the requirement disappears because it is derived; stored approvals stay harmlessly until a change drops them. (If the flag is set again, the server calls `dropMemberApprovals` first, so old approvals never satisfy the new requirement.)
- Operation-specific error codes, exported as `APPROVAL_ERROR_CODES`: `not_placed`, `approval_not_required`, `already_approved`. Shared codes also apply.
- `needsApproval` is never read from or written to tags.

## Scope
May change:
- `packages/core/src/rules/approval.ts` (new)
- `packages/core/src/rules/index.ts` (create it if missing, or add one export line if T-014 or T-017 already created it)
- `packages/core/src/index.ts` (one export line for `rules`, only if not already present)
- `packages/core/test/rules/approval.test.ts` (new)

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Approval tests | `pnpm --filter core exec vitest run test/rules/approval.test.ts` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
The fixture's needs-approval member is Cy Mockup (a Primary Teacher in Current). Build proposals with `buildFixtureProposal()` and `createProposal`, and change placements with T-009's `placeInPosition` / `addToList` or `createBoard`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `an unchanged placement needs no approval` | fresh fixture proposal → `[]` even though Cy Mockup is placed | every placement of a flagged member required |
| `a suggested calling for a flagged member needs approval` | Cy Mockup moved to a vacant single → one requirement, `approval: null` | baseline comparison by position id only, ignoring lineage |
| `an unflagged member never needs approval` | — | flag ignored |
| `a position added in the proposal needs approval` | Cy Mockup added to a full list → the new position requires approval | lineage lookup crashes or skips new positions |
| `approvePlacement records approver and time` | requirement now carries the approval with `approvedBy` and `approvedAt` | approval not stored |
| `approval is tied to member and position` | approved member moved to another position → requirement again with `approval: null` | approval follows the member |
| `approving what needs no approval is refused` | unflagged member, or unchanged placement → `approval_not_required` | blanket approvals stored |
| `approving twice is refused` | → `already_approved`, first approval unchanged | overwrite |
| `approvePlacement validates its inputs` | empty `approvedBy`, timestamp without zone, non-baseline `baseline` → `invalid_operation`; unknown ids → `not_found`; member not in position → `not_placed` | invalid board thrown from `finalizeBoard` |
| `approvePlacement refuses non-proposal boards` | Current, baseline → `board_not_editable` | Current editable |
| `accepted proposals report no requirements` | same proposal with `status: 'accepted'` → `[]`; back to Draft → requirement again | status ignored; requirement cached |
| `clearing the flag removes the requirement` | ward with Cy Mockup's flag cleared → `[]` | — |
| `dropMemberApprovals removes only that member's approvals` | two approved members → one remains | drops all |
| `dropAllApprovals empties approvals and keeps placements` | — | placements dropped |
| `unapprovedPlacements lists only unapproved requirements` | one approved, one not → one | — |
| `results are frozen and inputs untouched` | — | mutation |

## Edge cases (each needs a test)
- Flagged member with two suggested callings: each needs its own approval.
- Flagged member placed back into their baseline position after experimenting: no requirement.
- Proposal whose board has an approval for a member whose flag has since been cleared: no requirement listed, approval left in place.

## Human checks
none

## Out of scope
- Setting or clearing the flag (Admin-only, T-026), who may approve (server), the needs-approval dialog (T-035), whether unapproved placements block acceptance (open question; see the controller report).
