# B-021: Fixture proposals share every id with their baseline

**Priority:** P2  
**Area:** core tests  
**State:** candidate  
**Found:** 2026-10-27, T-016 independent verification (rounds 1 and 2)  
**Promoted to:** —

## Finding

`buildFixtureProposal` makes the baseline and the working board by spreading the same Current. Every position id and assignment id is therefore identical on both boards. In a test built on this fixture, matching by lineage cannot be told apart from matching by id.

## Risk

Cross-board comparison code can match by id instead of lineage and still pass its tests. This covers divergence notices, removed-position flags, and summaries. It happened in T-016 round 1: three id-matching mutants survived all 24 tests.

## Direction

Provide a shared test helper, or a fixture option, that rebuilds a board with renamed position and assignment ids while keeping lineages. T-016's local `renameIds` helper in `packages/core/test/diff/diff.test.ts` is a starting point. Point future cross-board contracts at it.

## Evidence

- `packages/core/src/fixtures/ward.ts:552-567`
- `docs/tasks/evidence/T-016.md`: round 1 mutants M1, M4 and M5 survived
