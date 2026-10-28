# B-048: No test covers AcceptedMode's stale getProposal reply guard

**Priority:** P3  
**Area:** web shell tests  
**State:** candidate  
**Found:** 2026-10-28, T-090 verifier mutation check  
**Promoted to:** —

## Finding

`apps/web/src/shell/AcceptedMode.tsx` ignores a `getProposal` reply when its effect has been cleaned up (`if (cancelled) return;`). Removing that guard left all 12 `accepted-mode.test.tsx` tests passing.

## Risk

A future refactor could drop the guard unnoticed. A slow reply for a previous selection would then briefly overwrite the newer one. Results are also tagged by id, which limits the visible damage.

## Direction

Add a test that opens A, selects B, resolves B's reply, and then resolves A's. The view must keep showing B.

## Evidence

- docs/tasks/evidence/T-090.md, verifier mutation 4
