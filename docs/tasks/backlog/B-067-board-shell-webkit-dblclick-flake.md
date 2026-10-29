# B-067: board-shell e2e can miss the group double-click on phone-webkit under load

**Priority:** P2  
**Area:** e2e / web canvas  
**State:** candidate  
**Found:** 2026-10-29, controller integrated gate for T-104  
**Promoted to:** —

## Finding

In the integrated `./scripts/verify.sh` run for T-104 (a server dev-tooling change with no web scope), `[phone-webkit] e2e/board-shell.spec.ts:72` failed. After the double-click on the `Relief Society Teachers` group target, the level label stayed `Organization` instead of `Group` (board-shell.spec.ts:22). Running that spec alone on phone-webkit with `--repeat-each=8` passed 8/8.

## More occurrences (2026-10-29)

Other unrelated e2e/capture specs also failed once while several worktrees ran their gates at once, then passed on re-run:
- desktop-chromium `accepted.spec.ts:69` and `phone-changes.spec.ts:40` ("Switch board" not found, 30s), from the T-105 implementer
- desktop-chromium `gui/search.capture.ts:35` (heading not found), from the T-105 verifier

- `scripts/e2e-slot.test.mjs:180` "runs the command with --workers appended" (empty stderr), from the T-107 verifier

This may be a broader load-sensitivity problem rather than one WebKit double-click.

## Risk

An intermittent gate failure blocks unrelated merges and invites reruns. It may also hide a real WebKit timing problem with double-click zoom while the canvas is still settling.

## Direction

Find out whether the double-click lands before the organization zoom transition finishes, or whether WebKit splits it into two clicks under load. Fix the cause: wait for a settled-state signal in the app or the spec. Do not add retries or loosen the assertion.

## Evidence

- `scratchpad/integrated-t104.log` lines 558 and 686–712 (controller session, 2026-10-29)
- `apps/web/e2e/board-shell.spec.ts:18-23`
