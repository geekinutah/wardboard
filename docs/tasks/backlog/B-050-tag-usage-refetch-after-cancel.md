# B-050: Tag library keeps refetching usage for a cancelled dialog's tag

**Priority:** P3  
**Area:** web shell  
**State:** candidate  
**Found:** 2026-10-28, T-089 round 2 verifier  
**Promoted to:** —

## Finding

`apps/web/src/shell/TagLibrarySection.tsx` never clears `activeTag` when the delete dialog closes, because `TagLibrary` has no close callback. After a user opens and cancels a delete dialog, every later ward push sends one `getTagUsage` for that tag while Settings stays open.

## Risk

There is one small extra request per ward push. It is bounded (one in flight per tag) and has no correctness impact.

## Direction

Add an `onDialogClosed` callback to `TagLibrary` and clear `activeTag` on close, or refetch only while a dialog is open.

## Evidence

- docs/tasks/evidence/T-089.md, round 2 implementer note 5 and verifier notes
