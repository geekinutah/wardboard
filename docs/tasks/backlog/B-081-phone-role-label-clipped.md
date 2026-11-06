# B-081: Phone account role label is clipped

**Priority:** P3
**Area:** web phone shell
**State:** candidate
**Found:** 2026-11-05, T-120 GUI verification
**Promoted to:** —

## Finding

On the phone screenshots for Settings, the signed-in role reads as a fragment (`Adn`) while the desktop screenshot reads `Admin`. The label is `.shell-account-role` in `apps/web/src/shell/BoardShell.tsx`, styled in `apps/web/src/app.css`.

## Risk

The role is how an Admin tells their session from an Editor. On a phone it is not readable.

## Direction

Let the role use its full word at the phone width. Do not shrink it below the text.

## Evidence

- `apps/web/gui-artifacts/photo-bundle/collect-phone-chromium.png` and `collect-phone-webkit.png` from the T-120 capture
- `apps/web/src/shell/BoardShell.tsx` renders `roleLabel(me.role)` in `.shell-account-role`
- `apps/web/src/app.css` `.shell-account-role`
