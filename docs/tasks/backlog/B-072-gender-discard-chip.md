# B-072: The import review's discarded-fields list doesn't mention gender

**Priority:** P2  
**Area:** web import review  
**State:** candidate  
**Found:** 2026-10-30, T-112 round 2 implementer report  
**Promoted to:** —

## Finding

The review's "Discarded before saving" chips (`apps/web/src/features/import/ImportReview.tsx`) list Phone, Email, Address, Birth date, Age and others, but not Gender. The required Member List (T-112) prints a Gender column, and the importer discards it.

## Risk

Low. Nothing is stored; the list is only incomplete, so an admin can't see from the screen that gender was dropped. If B-068 later decides to keep gender, this list must change anyway.

## Direction

Add a `Gender` chip, unless B-068 decides to keep gender first.

## Evidence

- `docs/tasks/evidence/T-112.md`, round 2 implementer report, Notes item 3.
