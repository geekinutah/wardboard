# B-058: The seeded fixture proposal has no edits

**Priority:** P3  
**Area:** core fixtures / e2e  
**State:** candidate  
**Found:** 2026-10-28, T-092 implementer and verifier  
**Promoted to:** —

## Finding

`buildFixtureProposal` (`packages/core/src/fixtures/ward.ts:560-561`) copies Current into both the baseline and the board, so the seeded proposal `Spring adjustments` has an empty diff. The desktop and phone both show `+0 callings · −0 releases`, and the phone shows `Changes · 0`.

## Risk

Browser e2e tests and GUI captures that open the fixture proposal read-only never exercise the non-zero diff UI. Only unit tests (through `buildPreviewData`) cover it.

## Direction

Seed the dev and e2e proposal with a few deterministic operations, as `buildPreviewData` does. Check which existing specs depend on the empty diff before changing it.

## Evidence

- T-092 round 2 implementer probe: `DESKTOP: + 0 suggested callings | − 0 suggested releases | 16 vacant positions`; `PHONE: +0 callings · −0 releases · 16 vacant`. docs/tasks/evidence/T-092.md
- `apps/server/dev/seed-fixture.ts`
