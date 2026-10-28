# B-053: No test pins the e2e slot pool's default lock directory

**Priority:** P3  
**Area:** tooling / quality gate  
**State:** candidate  
**Found:** 2026-10-28, T-091 round-1 and round-2 verifiers  
**Promoted to:** —

## Finding

`scripts/e2e-slot.pl` defaults the lock directory to the literal `/tmp/wardboard-e2e-slots` (line 49), as T-091 requires. Every test overrides it with `WARDBOARD_E2E_SLOT_DIR`, so a mutation that derives the default from `$TMPDIR` survived the suite.

## Risk

Agent harnesses give each session its own `$TMPDIR`. A regression to `$TMPDIR` would silently split the pool per session and bring back the B-045 contention, with every test still green.

## Direction

Add a structural test asserting the wrapper's default directory is the literal `/tmp/wardboard-e2e-slots` and does not read `TMPDIR`, or run the wrapper with `TMPDIR` set to a temp dir and no override and check which directory holds the lock.

## Evidence

- docs/tasks/evidence/T-091.md (round-1 verifier mutation M6, round-2 verifier notes)
