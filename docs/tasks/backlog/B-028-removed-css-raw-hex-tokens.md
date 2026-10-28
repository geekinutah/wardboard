# B-028: Removed summary CSS uses raw artboard hex colors without tokens

**Priority:** P2  
**Area:** design tokens  
**State:** candidate  
**Found:** 2026-10-27, T-040 round-1 verifier  
**Promoted to:** —

## Finding

`apps/web/src/features/removed/removed.css` (added by T-040) uses the literal artboard colors `#b9bec4` (summary panel border) and `#f1f2f0` (diff-line fill). `tokens.css` has no tokens for those exact values. The same precedent already exists in `group-view.css` (form border).

## Risk

Token drift: if the design system later adds tokens for those values (or the tokens doc is regenerated from the artboards), the hard-coded hex values will silently diverge from the rest of the design system.

## Direction

A design-doc task: add/confirm the tokens in `docs/design/README.md` + `tokens.css` for the removed-panel border and diff-line fill, then switch the feature CSS to the tokens. Out of scope for T-040 (whose must-not-change list covered `design/**`).

## Evidence

- `apps/web/src/features/removed/removed.css`, `#b9bec4` and `#f1f2f0`
- `apps/web/src/design/tokens.css` (no matching tokens)
- `docs/design/ui-canvas/Removed.dc.html` (artboard 9 source values)
- `docs/tasks/evidence/T-040.md`, round 1 verifier report, Notes / blockers
