# B-002: assertNever fallback test does not detect removal of the fallback

**Priority:** P2  
**Area:** core tests  
**State:** candidate  
**Found:** 2026-10-25, T-001 verifier mutation check  
**Promoted to:** —

## Finding

`assertNever names values JSON cannot represent, such as undefined` (`packages/core/test/util/assert-never.test.ts:51-56`) still passes when the `json ?? String(value)` fallback (`packages/core/src/util/assert-never.ts:5`) is removed, because a template literal renders `undefined` either way. The test was added after the red run.

## Risk

A partly hollow test; the function/symbol fallback is untested.

## Direction

Test a function or symbol value (expect its string form in the message), or drop the test.

## Evidence

- `docs/tasks/evidence/T-001.md` (verifier Notes)
