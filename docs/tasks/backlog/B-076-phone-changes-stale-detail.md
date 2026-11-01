# B-076: A late phone Changes detail can leave the open proposal on "net only"

**Priority:** P3
**Area:** web phone changes
**State:** candidate
**Found:** 2026-11-01, T-096 independent verification
**Promoted to:** —

## Finding

`PhoneApp` requests one `getProposal` per proposal id while Changes stays open. The reply writes `changeDetail` when the Changes visit has not changed. Leaving Changes bumps that visit. Switching to another proposal without leaving Changes does not. A slower reply for the previous proposal can replace `changeDetail` after the open proposal's detail arrived. The subtitle uses the detail only when its id is the open proposal, so the other date is not shown. The open proposal then stays on "net only", and that id is already recorded as requested, so it is not fetched again.

## Risk

Low. The date line is missing until the user leaves Changes and opens it again. The wrong date is not shown. The path is untested.

## Direction

Apply a detail only when that proposal id is still open. Add a test that answers the first `getProposal` after a second proposal is open and Changes has stayed selected.

## Evidence

- `apps/web/src/shell/PhoneApp.tsx` detail effect and the subtitle's open-id check, candidate `b26a1b1`.
- T-096 independent verifier, round 1. This did not fail T-096.
