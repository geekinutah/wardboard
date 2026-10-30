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

- (T-113 verifier) `packages/importer/test/member-list-fixture.test.ts` doesn't pin Member List gender against the other fixtures, and doesn't prove that rows outside the fixtures are under-11 children. Consider both when T-111/T-112 start relying on the file.

## Risk

A later change to the planner or the fixtures could quietly stop exercising the namesake path on a first import.

## Note (2026-10-29)

The fixture's in-report conflict (one person in both Callings by Organization and Members without Callings) is an artifact Mike says can't happen in real reports. Refreshed fixtures will remove it. Once they land, the conflict path has to be tested with built inputs, not the fixture.

## Direction

Assert `conflicts > 0` in the preview test, and add an `unresolved` first-replace test. Drop the redundant check only with a test that pins the response.

## Evidence

- `docs/tasks/evidence/T-102.md` (verifier notes)
- `apps/server/test/import/first-import.test.ts:324-334`, `apps/server/src/import/http.ts:357-361`
