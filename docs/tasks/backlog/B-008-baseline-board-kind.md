# B-008: baseline_board_id does not require kind baseline

**Priority:** P2  
**Area:** server  
**State:** candidate  
**Found:** 2026-10-25, T-005 verifier round 2  
**Promoted to:** —

## Finding

`boards.baseline_board_id` must be non-null for a proposal and null otherwise. The foreign key does not require the target row's `kind` to be `baseline`, so a proposal can point at a current board or another proposal.

## Risk

Low until proposals are created (T-023). A writer that trusts the foreign key alone can store a baseline pointer that is not a baseline snapshot.

## Direction

When creating a proposal, require the target to be a `baseline` board. A composite foreign key is possible only if `(id, kind)` is unique.

## Evidence

- `apps/server/src/db/migrations/001-initial.ts` (`baseline_board_id` and its CHECK)
- `docs/tasks/evidence/T-005.md` (verifier Notes, round 2)
