# B-054: LCR calling titles do not match the seeded handbook labels

**Priority:** P2
**Area:** import
**State:** candidate
**Found:** 2026-10-28, T-058 round 1 verifier
**Promoted to:** —

## Finding

Handbook titles and group names often differ from the LCR organizations report. Examples: `President` versus `Elders Quorum President`, and `Deacons Quorum` versus `Deacons Quorum Presidency`. T-058 matches positions by the canonical organization, calling group, and title. Those seeded slots stay vacant, and the import adds parallel rows, on the first import onto the seeded current board.

## Risk

The first import onto the seeded current board can duplicate offices: the handbook seat stays empty and a second seat appears with the printed LCR title.

## Direction

A later contract only if SPEC §8 is meant to alias those handbook labels. Do not change T-058’s match key for this.

## Evidence

- `docs/tasks/evidence/T-058.md`, verifier Notes / blockers, round 1
- `packages/core/src/fixtures/ward.ts`
- `fixtures/lcr-reports/organizations-and-callings.pdf`
