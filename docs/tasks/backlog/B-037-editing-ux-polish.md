# B-037: Desktop editing UX polish from T-077

**Priority:** P3  
**Area:** web shell / search  
**State:** candidate  
**Found:** 2026-10-28, T-077 implementer and verifier  
**Promoted to:** —

## Finding

(1) Narrow desktop windows (<1024px) have drag turned off with no visible hint (`EditingLayer.tsx` `NO_DRAG_MEDIA`). (2) Search offers Add to dugout for someone already in the dugout (`SearchBox.tsx` `canAdd` checks only explicit inclusion; artboard 11 hides it). (3) A stale or rejected op may show two alerts: the sync banner and `Couldn't apply the change: …` (not independently reproduced).

## Risk

Minor confusion; no data loss.

## Direction

Show a hint when drag is off on a Draft, or keep drag for fine-pointer windows down to a phone breakpoint; hide Add to dugout for members already in the dugout; let the sync banner be the only message for stale/rejected.

## Evidence

- `docs/tasks/evidence/T-077.md`
