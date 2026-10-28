# B-026: Phone WebKit e2e smoke can crash in browser teardown

**Priority:** P2  
**Area:** web e2e harness  
**State:** candidate  
**Found:** 2026-10-27, T-027 round-2 implementer  
**Promoted to:** —

## Finding

One `./scripts/verify.sh` run failed only at phone-webkit `e2e/smoke.spec.ts` with `NSInternalInconsistencyException` while WebKit removed a `WKScreenTimeConfigurationObserver` (`configuration.enforcesChildRestrictions`): 31 passed, then exit 1. The candidate did not touch `apps/web`, and an immediate rerun passed.

## Risk

An intermittent gate failure unrelated to the change under test wastes rounds and trains agents to rerun until green, which could hide a real failure.

## Direction

Track recurrence first. If it repeats, check whether it is a Playwright WebKit build or macOS issue (upgrade, or a known upstream bug) rather than a test defect. Do not add retries that would mask real failures without a decision.

## Evidence

- `docs/tasks/evidence/T-027.md`, implementer report round 2, Notes / blockers
