# B-055: A custom marker on a report row is stored as a standard assignment

**Priority:** P3
**Area:** import
**State:** candidate
**Found:** 2026-10-28, T-058 round 1 verifier
**Promoted to:** —

## Finding

New assignments created by import are stored with `origin: 'standard'`, including report rows whose parser sets `custom: true`. Temple Prep Instructor is one such row. T-058’s contract requires that origin for every new assignment, so the current behavior matches the contract.

## Risk

A custom calling can look like a standard handbook calling after import. Later edits and the catalog may treat it as standard.

## Direction

If custom report rows must stay custom, a follow-up contract can set `origin` from the report’s custom marker. Do not change it inside T-058.

## Evidence

- `docs/tasks/evidence/T-058.md`, verifier Notes / blockers, round 1
- `apps/server/src/import/apply.ts` (new assignments use `origin: 'standard'`)
