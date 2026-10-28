# B-041: Returning from Settings resets board view state

**Priority:** P3  
**Area:** web shell  
**State:** candidate  
**Found:** 2026-10-28, T-080 verifier  
**Promoted to:** —

## Finding

"Back to board" remounts `BoardShell`. The health line shows "Checking server…" again, and the open tab, zoom and camera go back to their defaults. The sync connection itself survives.

## Risk

A small annoyance: a user who checks Settings mid-planning loses their place. SPEC §10 protects the camera from synchronized edits, not from navigation, so this isn't a spec violation.

## Direction

Keep the shell mounted but hidden while Settings is open, or move tab and camera state above the route switch.

## Evidence

- `apps/web/gui-artifacts/settings-route/back-to-board-tv-chromium.png`; `docs/tasks/evidence/T-080.md`
