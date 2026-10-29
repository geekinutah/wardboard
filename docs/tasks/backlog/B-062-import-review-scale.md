# B-062: The import review lists every identity row one at a time

**Priority:** P3  
**Area:** web import  
**State:** candidate  
**Found:** 2026-10-29, T-097 implementer and verifier reports  
**Promoted to:** —

## Finding

Against the seeded ward, the fixture reports produce 257 identity rows. The review lists all of them, about 30,000 CSS px tall on a phone, and each needs its own click. There is no bulk "treat remaining as new" and no grouping or pagination.

## Risk

A real first import (or one against a very different ward) is tedious and error-prone to resolve by hand.

## Direction

Group rows by kind, paginate or collapse them, and consider an explicit bulk action for unambiguous new people. Namesakes must still be resolved one by one (SPEC §8).

## Evidence

- `docs/tasks/evidence/T-097.md` (implementer and verifier notes)
- `apps/web/src/features/import/ImportReview.tsx`
