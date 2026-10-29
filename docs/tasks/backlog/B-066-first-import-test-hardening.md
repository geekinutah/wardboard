# B-066: Harden the first-import server tests

**Priority:** P3  
**Area:** server import tests  
**State:** candidate  
**Found:** 2026-10-29, T-102 verifier  
**Promoted to:** —

## Finding

- `preview without a Current returns a plan` still passes if the fixture's in-report namesake conflict disappears.
- No committed test proves that an unresolved in-report conflict blocks the first replace with 409 `unresolved`. The verifier's probe showed the behavior is correct today.
- The early `expectedVersion !== 0` check in `http.ts` is redundant with `applyImport`'s stale check.

## Risk

A later change to the planner or the fixtures could quietly stop exercising the namesake path on a first import.

## Direction

Assert `conflicts > 0` in the preview test, and add an `unresolved` first-replace test. Drop the redundant check only with a test that pins the response.

## Evidence

- `docs/tasks/evidence/T-102.md` (verifier notes)
- `apps/server/test/import/first-import.test.ts:324-334`, `apps/server/src/import/http.ts:357-361`
