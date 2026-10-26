# B-010: Model accepts extra overseers of the priests quorum and duplicate oversight entries

**Priority:** P1  
**Area:** core model  
**State:** candidate  
**Found:** 2026-10-26, T-007 verifier  
**Promoted to:** —

## Finding

`createBoard` accepts a non-fixed counselor → priests-quorum oversight entry alongside the fixed bishop entry, and accepts the same oversight entry twice (`packages/core/src/model/board.ts:322-359`).

## Risk

SPEC §4 makes bishop → priests quorum fixed by office and not editable. Multiple overseers for one target would yield an ambiguous "Overseen by" label and wrong accepted-summary grouping (T-018, T-044).

## Direction

Decide that each target has at most one overseer and that the priests quorum is bishop-only; enforce in the model (or in T-018's contract) before oversight editing ships.

## Evidence

- `docs/tasks/evidence/T-007.md` (verifier Note 1)
