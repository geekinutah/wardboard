# B-014: Structural calling order tie-break

**Priority:** P2
**Area:** core ordering
**State:** candidate
**Found:** 2026-10-26, T-014 independent verification
**Promoted to:** —

## Finding

`callingsOf` and second-calling `existing` both claim board structural order, but they break ties differently when two siblings share an `order`. Derived views tie-break equal orders on that level's entity id before comparing the next order field, and compare ids with `localeCompare(..., 'en')`. Second-calling notices compare the order chain first and use UTF-16 `<` on the final position id only.

## Risk

A confirmation list can name kept callings in a different order from the board's calling list when sibling groups or assignments share an `order`. Sibling orders are normally unique, so this is unlikely on fixture data.

## Direction

Decide whether an intermediate entity-id tie-break is part of structural order, then share one comparator. Do not change either function until that decision is a task contract.

## Evidence

- `packages/core/src/derive/views.ts` `compareChains` and `compareSlots` on `origin/main` after T-008 (`90f84a9`)
- `packages/core/src/rules/second-calling.ts` `compareChains` and `compareSlots` on `t-014-second-calling` (`41d3575`), lines 37-80
- T-014 verifier report, round 1: SPEC.md does not define the tie-break. Not a T-014 acceptance failure.
