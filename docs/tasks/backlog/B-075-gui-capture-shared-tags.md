# B-075: Shared gui:capture leaves tags from earlier scenarios on later phone shots

**Priority:** P3
**Area:** web gui capture
**State:** accepted
**Found:** 2026-10-31, T-095 verification
**Promoted to:** T-118

## Finding

`pnpm --filter web run gui:capture` runs every scenario against one seeded server. A scenario that creates a ward-wide tag leaves it on members for later scenarios. T-095's dugout screenshots showed `Cap Tag desktop-chromium r0 t0` on Jay Storybook, and the WebKit shot also showed `Cap Tag phone-chromium r0 t0` on Ivy Notreal.

## Risk

A later phone screenshot can show tag text that the scenario under review did not create. That makes visual review noisy and can hide or imitate a real tag-rendering bug.

## Direction

Mike, 2026-11-01: clear data between scenarios. A multi-step scenario stays on one server and sets up its own data. Do not treat the stray tag text on the T-095 dugout shots as a Search or Dugout defect.

## Evidence

- `apps/web/gui-artifacts/phone-search-live/dugout-list-phone-chromium.png` and `dugout-list-phone-webkit.png` from candidate `56fbd7e`.
- T-095 implementer and independent verifier, round 1. Place and the dugout sentence stayed visible, so the finding did not fail T-095.
