# B-023: SQLite oversight rows are not unique per target

**Priority:** P2  
**Area:** server schema  
**State:** candidate  
**Found:** 2026-10-27, T-018 implementer and verifier  
**Promoted to:** —

## Finding

`apps/server/src/db/migrations/001-initial.ts` defines `oversight` without a uniqueness constraint on a target. T-018's `createBoard` now rejects two overseers of one target, and a non-fixed priests-quorum entry. The table can still store those rows if a writer inserts them directly.

## Risk

A later load through `createBoard` would fail on a database that already holds a duplicate. T-023 persists oversight but its contract does not add a target uniqueness constraint.

## Direction

When a task owns the oversight schema, add a constraint so one board cannot store two rows for the same target. Keep the priests quorum limited to the fixed bishop entry in the model, which T-018 already does. Do not weaken `createBoard`.

## Evidence

- `apps/server/src/db/migrations/001-initial.ts` oversight table (around lines 159-173)
- `docs/tasks/evidence/T-018.md`
- `docs/tasks/T-023-board-persistence.md` rebuilds `oversight` without a target uniqueness constraint
