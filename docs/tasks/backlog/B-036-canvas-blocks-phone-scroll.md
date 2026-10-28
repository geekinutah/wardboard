# B-036: The canvas viewport blocks page scrolling on phones

**Priority:** P2  
**Area:** web canvas / phone layout  
**State:** candidate  
**Found:** 2026-10-28, T-077 implementer and verifier  
**Promoted to:** —

## Finding

`.wb-canvas-viewport { touch-action: none }` (`apps/web/src/features/canvas/canvas.css:48`) predates T-077. At 390px, a touch swipe that starts on the board doesn't scroll the page (probe: `324 → 324`), while a swipe on the dugout below does.

## Risk

On a phone, a finger that lands on the board can't scroll past it to the dugout or search.

## Direction

The phone-layout task should replace the canvas with tap-through screens (SPEC §10) or relax `touch-action` at phone widths.

## Evidence

- `docs/tasks/evidence/T-077.md` (round 2 verifier notes)
