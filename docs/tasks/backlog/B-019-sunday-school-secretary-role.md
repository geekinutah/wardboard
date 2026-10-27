# B-019: Sunday School secretary has no leadership role

**Priority:** P2
**Area:** core fixtures
**State:** candidate
**Found:** 2026-10-26, T-013 independent verification
**Promoted to:** —

## Finding

The Sunday School secretary assignment is not built by `presidency()`, so it stays `leadershipRole: null`. The presidency release rule only cascades to `counselor` and `secretary` roles in the president's calling group. That seat is vacant in the fixture. A member later placed there would not be released when the Sunday School president is released.

## Risk

SPEC §5 (v0.21) says the secretary of that presidency is released with the president. The gap is invisible while the seat is vacant and appears as soon as it is filled.

## Direction

Set `leadershipRole: 'secretary'` on that Sunday School assignment, and cover a filled seat in the presidency-release tests. Ward Clerk and Executive Secretary stay unmarked.

## Evidence

- `packages/core/src/fixtures/ward.ts` Sunday School secretary, `single('Secretary', null)`, on `t-013-presidency-release` (`6129c7c`)
- T-013 contract allowed the role only on assignments built by `presidency()`
- T-013 verifier report, round 1
