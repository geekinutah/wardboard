# B-029: Artboard 9 removed-card date and hint line absent from shipped RemovedCard

**Priority:** P2  
**Area:** design tokens  
**State:** candidate  
**Found:** 2026-10-27, T-040 round-1 verifier  
**Promoted to:** —

## Finding

Artboard 9 (`docs/design/ui-canvas/Removed.dc.html`) draws the removed member card status as `Removed Oct 24` (with a date) and shows a hint line under the summary panel. The shipped T-004 `RemovedCard` in `apps/web/src/design/` renders `Removed from Current` with no date and no hint line. T-040's contract required keeping the pre-existing `RemovedCard` treatment unchanged, so the gap shipped as-is.

## Risk

If the removed date (from the member's `removedDate`, which core and the divergence summary already surface) is wanted on the card, or the artboard's hint line is wanted back, the design and the code disagree and someone will re-litigate it per feature.

## Direction

A design-doc decision: confirm whether the card should show `Removed {date}` and whether the hint line belongs at all (the design rules currently say "no explanatory filler text"). If yes, update artboard 9 and the `RemovedCard` contract/tests together; if no, correct artboard 9 to match.

## Evidence

- `docs/design/ui-canvas/Removed.dc.html` (date + hint line)
- `apps/web/src/design/RemovedCard.tsx` and `docs/design/README.md` ("removed" rules)
- `docs/tasks/evidence/T-040.md`, round 1 verifier report, Notes / blockers
