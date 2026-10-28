# B-032: Drag-and-drop polish items from T-035 verification

**Priority:** P2  
**Area:** web dnd  
**State:** candidate  
**Found:** 2026-10-28, T-035 verifier (round 1)  
**Promoted to:** —

## Finding

- `DndSurface.tsx` `updateTarget` shows "Drop here" for any target whose plan isn't `none`, including drops core will refuse (e.g. a duplicate list member); the refusal only appears after the drop.
- `dnd.css` sets `touch-action: none` on every `[data-member-id]` inside an enabled surface, so a swipe that starts on a card can't scroll the page if the surface is ever mounted in the phone layout.
- In the second-calling step, a `null` `destinationLabel` would leave the drop flow set with no dialog, locking out further drags. This can't happen today.
- Blocked-drop alerts show core's technical messages (e.g. member and list ids) rather than friendly text.

## Risk

Mostly polish. The `touch-action` item matters if the integration task mounts `DndSurface` on phones; the phone design uses tap-to-move (T-049).

## Direction

Show a distinct "can't drop" hover state; don't mount `DndSurface` in the phone layout; make the null-label case fall back to a generic label; map core error codes to plain-language text.

## Evidence

- `docs/tasks/evidence/T-035.md` (verifier notes)
