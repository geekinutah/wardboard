# B-047: Canvas pointerdown focus closes transient pickers inside the canvas

**Priority:** P2  
**Area:** web canvas  
**State:** candidate  
**Found:** 2026-10-28, T-088 round 1 implementer  
**Promoted to:** —

## Finding

`apps/web/src/features/canvas/Canvas.tsx:287-300` focuses the canvas on any `pointerdown` whose target is not a button, a, input, textarea or select. `li[role=option]` rows in a combobox listbox do not count as controls. A picker that closes on blur (the T-039 `CallingTagsEditor` `+ Tag` / `+ Preference` lists) therefore closes before a click selects the option, so no op is sent. Keyboard selection works.

## Risk

Any listbox or picker rendered inside the canvas silently ignores mouse selection. T-088 works around it by stopping pointerdown propagation on its panel. Future panels will hit the same problem.

## Direction

Treat `[role=option]`, `[role=listbox]`, `[role=combobox]` (and probably `[role=switch]`, `[role=dialog]` descendants) as controls in `isControlTarget`. Add a canvas test where clicking an option inside the canvas keeps focus.

## Evidence

- `apps/web/src/features/canvas/Canvas.tsx:287-300`
- docs/tasks/evidence/T-088.md, round 1 notes
- When fixed, remove the T-088 workaround: `onPointerDown` stopPropagation on the Calling tags panel in `apps/web/src/shell/TagsWiring.tsx`.
