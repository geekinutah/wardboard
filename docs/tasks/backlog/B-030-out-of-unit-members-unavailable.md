# B-030: Members with out-of-unit callings are unavailable, but nothing shows it

**Priority:** P1  
**Area:** core rules / import / UI  
**State:** candidate  
**Found:** 2026-10-28, Mike's answer while amending T-055  
**Promoted to:** —

## Finding

Mike confirmed that every member listed in any section of the Out-of-Unit Callings report (Stake Callings, Serving outside of assigned unit, Living outside of Unit) holds a calling outside the ward and is **not available for ward callings** (SPEC §14, CONFIRMED 2026-10-28). Today the model treats external callings as information only: the person inspector lists them under "Outside the ward" (T-037), but they don't affect dugout membership, placement preflight, or search filters.

## Risk

Without a visible signal, the bishopric may plan a move for someone who isn't available. Members with only an outside calling have no ward calling, so they show up in the dugout as if they were free.

## Direction

Needs a decision from Mike before a contract (SPEC §14 OPEN): warn on placement, like second-calling detection; block placement; show an "Outside calling" marker in the dugout and search; or exclude them from the dugout. Logic belongs in `packages/core` (a rule like `rules/second-calling.*`), with import (T-058) setting `externalCallings` from T-055 records.

## Evidence

- SPEC.md §14 "Supplied PDF sample inspection", last paragraph (CONFIRMED 2026-10-28 decisions)
- docs/tasks/T-055-out-of-unit-parser.md (amended 2026-10-28)
