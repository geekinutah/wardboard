# B-068: WardBoard doesn't store gender, but some callings are limited by it

**Priority:** P1  
**Area:** data model / import / rules  
**State:** candidate  
**Found:** 2026-10-29, Mike, first-import walkthrough  
**Promoted to:** —

## Finding

Mike: "It looks like we don't store gender. This is important for callings. There are some callings that are locked to a gender." The member model (SPEC §7) and the import allow-list (SPEC §15) have no gender field, so the board can't warn when someone is placed in a calling limited to men or to women. The fixture README says the LCR reports list gender.

## Risk

Planners can propose placements that can't be extended. Today nothing in the app catches that.

## Direction

This needs Mike's decisions before a contract:
1. Add gender to the allow-list and the member model.
2. Choose the source report(s).
3. Decide how a calling is marked as limited: a per-assignment field, Handbook defaults by title, or both.
4. Decide what the board does on a mismatch: a confirmation like second calling, a hard refusal, or a flag like needs approval.
5. Decide whether presentation mode shows it.

Then a SPEC update. Core rules, importer, server and web tasks follow from those decisions.

## Evidence

- SPEC.md §7 Member fields, §15 allow-list; `apps/web/src/features/import/ImportReview.tsx` KEPT/DISCARDED lists
- `fixtures/lcr-reports/README.md`
