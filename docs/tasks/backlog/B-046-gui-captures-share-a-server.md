# B-046: GUI captures share one checkout server

**Priority:** P3  
**Area:** web e2e gui  
**State:** candidate  
**Found:** 2026-10-28, T-081 verifier (round 2)  
**Promoted to:** —

## Finding

`pnpm --filter web run gui:capture` runs every scenario against one seeded checkout server. A scenario that creates a proposal leaves that tab for the scenarios that run after it.

## Risk

After-exit screenshots are not a picture of the fixture ward alone. `apps/web/gui-artifacts/present-mode/after-exit-tv-chromium.png` and the phone after-exit shots also show tabs named `Primary desktop-chromium`, `Primary phone-chromium`, and `Primary phone-webkit`, created by `apps/web/e2e/gui/start-proposal.capture.ts`. A later capture can fail or look wrong because of an earlier scenario.

## Direction

Give each capture scenario its own server, or reset the fixture between scenarios. Do not change presentation behavior to hide the extra tabs.

## Evidence

- T-081 verifier, `docs/tasks/evidence/T-081.md`: the extra tabs are present in the after-exit captures. `present-mode.capture.ts` does not create proposals.
- `apps/web/e2e/gui/start-proposal.capture.ts` creates `Primary <project>`.
- Seen again in T-083 round 2 (out-of-unit-board captures: piled-up "Outside capture … r0 t0" tabs); docs/tasks/evidence/T-083.md
- Seen again in T-092 (2026-10-28): leftover proposals ("Accept capture desktop-chromium r0 t0" …) make the new phone board switcher long, pushing Start proposal below the fold in `switcher-phone-webkit.png`, and wrap the desktop tab strip. docs/tasks/evidence/T-092.md
