# B-064: The dugout filter's "All" chip renders without its label

**Priority:** P3  
**Area:** web dugout  
**State:** candidate  
**Found:** 2026-10-29, T-100 implementer (GUI capture); confirmed by the T-100 verifier in the dugout, organization and group-detail captures  
**Promoted to:** —

## Finding

In the T-100 dugout capture, the first category filter pill ("All") appears as an empty outlined circle with no visible label, probably in its pressed state.

## Risk

The active filter would be unreadable, and its state shown by shape alone.

## Direction

Confirm on a fresh capture of the desktop dugout. If it reproduces, fix the pressed-pill styles in `dugout.css`.

## Evidence

- `apps/web/gui-artifacts/portraits/dugout-desktop-chromium.png` (T-100 capture)
- `apps/web/src/features/dugout/dugout.css`
