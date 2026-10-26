# B-007: removed_date accepts impossible calendar dates

**Priority:** P2  
**Area:** server  
**State:** candidate  
**Found:** 2026-10-25, T-005 verifier round 1  
**Promoted to:** —

## Finding

`members.removed_date` accepts any `YYYY-MM-DD` shape, including `2026-02-31` and `2026-13-01`. Values that are not that shape are rejected.

## Risk

Low. Nothing reads `removed_date` until import (T-058). An impossible date would still count as removed.

## Direction

Reject dates that are not real calendar days, in the check or in the later writer, and cover `2026-02-31`.

## Evidence

- `apps/server/src/db/migrations/001-initial.ts` (on T-005 candidate `b43c7c0`)
- `docs/tasks/evidence/T-005.md` (verifier Notes, round 1)
