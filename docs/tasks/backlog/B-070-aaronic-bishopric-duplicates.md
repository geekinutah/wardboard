# B-070: The import creates duplicate bishopric seats under the Aaronic Priesthood

**Priority:** P1  
**Area:** import  
**State:** resolved  
**Found:** 2026-10-29, T-107 implementer and verifier  
**Promoted to:** T-109 (Mike, 2026-10-29: "linking is the correct approach")

## Finding

The organizations report lists "Presidency of the Aaronic Priesthood" (Bishop, Bishopric First Counselor, Bishopric Second Counselor) and "Priests Quorum President" (held by the bishop). `plan.ts` creates independent seats for all of them. Since T-107 they are prominent and carry leadership roles. The Aaronic tile repeats the bishopric, and releasing the duplicate "Bishop" vacates the duplicate counselors, separately from the real Bishopric.

## Risk

Every real LCR import breaks CONFIRMED SPEC §4: leadership references to the bishopric must not create duplicate independent seats, and the bishop's priests quorum presidency is a fixed linked reference card. It also breaks the §12 acceptance scenario. Planners could move or release a duplicate seat.

## Direction

In `apps/server/src/import/plan.ts`, map these rows onto the existing Bishopric positions and the fixed priests-quorum reference, without creating seats. Consider this together with B-054 (title aliasing).

## Evidence

- `docs/tasks/evidence/T-107.md` (verifier probe of the fixture import; Aaronic tile 10 leaders)
- SPEC.md §4 (lines ~121–123), §12
- Resolved by T-109, verified round 1 PASS (`docs/tasks/evidence/T-109.md`). The import no longer creates those seats.
