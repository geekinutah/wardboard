# B-022: Diff list correspondence untested when a list's first lineage is new

**Priority:** P2  
**Area:** core diff  
**State:** candidate  
**Found:** 2026-10-27, T-016 independent verification round 2  
**Promoted to:** —

## Finding

A mutant survives all 30 T-016 tests. In that mutant, a `to` list is matched to a `from` list only through its first position's lineage. No test builds a list whose first position has a lineage absent from `from` while its later positions share lineages.

## Risk

Low today. `addListPosition` appends, so current ops cannot produce that state. A future op could, for example one that inserts list positions or a reconcile/import that relineages one position. The diff would then report spurious callings and releases for every holder of that list.

## Direction

When such an op exists, or alongside B-021, add a test that relineages only position 0 of an occupied list. It should assert that the other holders are neither called nor released.

## Evidence

- `packages/core/src/diff/diff.ts` `callingKeys` (around line 140); mutant `lineages.slice(0, 1).flatMap(...)`
- `docs/tasks/evidence/T-016.md`: round 2 mutation `to_list_first`
