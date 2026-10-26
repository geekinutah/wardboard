# B-006: e2e server teardown is not tested

**Priority:** P2  
**Area:** web e2e harness  
**State:** candidate  
**Found:** 2026-10-25, T-003 round 1 verifier  
**Promoted to:** —

## Finding

Replacing the e2e global teardown with a no-op still passes every check, while leaving a `$TMPDIR/wardboard-e2e-*` data dir behind. Nothing asserts the checkout-scoped server closes and its data dir is removed.

## Risk

Once the fictional fixture ward is seeded, leaked SQLite files accumulate in `$TMPDIR` across runs, and a regression would go unnoticed.

## Direction

A test of the checkout server helper's stop/teardown asserting the data dir is gone and the port is closed.

## Evidence

- `apps/web/e2e/global-setup.ts:128-130` (candidate `9f81bc8`)
- `docs/tasks/evidence/T-003.md` (round 1 verifier Mutation check)
