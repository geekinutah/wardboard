# B-071: A report-conflict seat stays vacant even after the conflict is resolved

**Priority:** P2  
**Area:** import  
**State:** declined  
**Found:** 2026-10-29, T-107 verifier  
**Promoted to:** — (Mike, 2026-10-29: the scenario is impossible in real reports; if it happens, keep the current vacant-seat approach. The fixture overlap is fixed through the refreshed fixtures in HUMAN_BACKLOG.md.)

## Finding

A person who appears both in Callings by Organization and in Members without Callings is a `report_conflict` (`packages/importer/src/reconcile/reconcile.ts:127-132`). `apply.ts` leaves that person's seat vacant even after the Admin resolves the row (`apply.ts:97-101`, `:267`). This is the T-058 design. In the fixture, Teachers Quorum President (a fictional youth) imports vacant.

## Risk

A real calling holder's seat silently imports vacant, and the review doesn't say so.

## Direction

At minimum, the review should tell the Admin that the seat will import vacant. Better: let the Admin assign the conflicted seat explicitly to the confirmed member. Never guess (SPEC §8).

## Evidence

- `docs/tasks/evidence/T-107.md`; `docs/tasks/T-058-import-replace.md:106`
