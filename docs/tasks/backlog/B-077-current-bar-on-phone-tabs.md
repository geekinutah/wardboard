# B-077: The Current read-only bar stays above every phone tab

**Priority:** P3
**Area:** web phone shell
**State:** candidate
**Found:** 2026-11-01, T-096 independent verification
**Promoted to:** —

## Finding

`StartProposal` renders `CurrentReadOnlyBar` whenever the open board is Current, and `PhoneApp` mounts `StartProposal` above the tab body. On Current, Changes, Search, and Dugout all show the lock, import date, and Start proposal control. T-096's Current Changes screenshots show that bar above the baseline sentence. The sentence is fully visible and does not overlap the bar.

## Risk

Low. The bar is the right chrome on the Board tab. On the other tabs it uses vertical space beside content that already says this is the baseline. T-096 treated the bar as existing shell behavior.

## Direction

Hide the bar on the non-board phone tabs in a separate shell task. Do not fold that into a Changes-only change.

## Evidence

- `apps/web/src/shell/StartProposal.tsx` renders `CurrentReadOnlyBar` when `onCurrent` is set.
- `apps/web/src/shell/PhoneApp.tsx` renders `StartProposal` above `tabBody`.
- `apps/web/gui-artifacts/phone-app/changes-current-phone-chromium.png` and `changes-current-phone-webkit.png` from candidate `b26a1b1`.
- T-096 independent verifier, round 1. This did not fail T-096.
