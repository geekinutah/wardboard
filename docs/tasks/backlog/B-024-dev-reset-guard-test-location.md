# B-024: dev reset-guard test is checkout-location sensitive

**Priority:** P2  
**Area:** server dev tooling  
**State:** candidate  
**Found:** 2026-10-27, T-068 round-1 verifier (OpenCode)  
**Promoted to:** —

## Finding

`apps/server/test/dev/dev-server.test.ts:136` derives `repoRoot` from the test file's own location and asserts `isSafeResetPath(repoRoot) === false`. If a checkout ever lives inside the OS temp dir, the guard (correctly, per the T-068 contract) accepts that path, and the assertion fails (`expected true to be false`). The verifier reproduced exactly this with a scratch copy under `$TMPDIR`. The guard itself behaves as contracted; only the test's fixed sentinel is location-dependent.

## Risk

The suite would fail spuriously for checkouts under the OS temp dir (unusual but possible: CI scratch spaces, some agent sandboxes). No product-behavior impact — `isSafeResetPath` is correct.

## Direction

Make the unsafe-path sentinel location-proof: keep the temp-dir cases for the safe branch, but take the "unsafe" cases from a path guaranteed to be outside the temp dir (for example a nonexistent path under `os.homedir()`, or the checkout root with a temp-dir checkout excluded/skipped) instead of the checkout's own root. One-line-class test change; no source change.

## Evidence

- `docs/tasks/evidence/T-068.md` (round-1 verifier report, Findings)
- `apps/server/test/dev/dev-server.test.ts:136` (`expect(isSafeResetPath(repoRoot)).toBe(false)`)
