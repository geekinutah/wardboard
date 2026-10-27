# T-031: Canvas and zoom levels

**Milestone:** 4 — Desktop board
**Depends on:** T-004 (done).
- PLAN lists T-030 as a dependency. This contract removes it on purpose: the canvas is a standalone component, shown in the component gallery, and T-030 and the level views (T-032 to T-034) mount it later.
- No shared files with T-029 or T-068, so it runs alongside them.

**Spec refs:**
- SPEC.md §4 (zoom levels):
  - A spatial board with double-click zoom into an area, mouse-wheel zoom, pinch zoom, pan, zoom-out and Fit ward.
  - Zoom levels are explicitly defined: 1 Ward, 2 Organization, 3 Group (the deepest; further zoom only enlarges).
  - Double-click on an area or group goes one level deeper. Double-click on a member card opens notes instead.
  - Zoom-out or Esc goes up one level. Wheel and pinch move continuously and switch levels at thresholds. Fit ward returns to level 1.
  - A single click selects and never zooms.
  - PROPOSED: explicit zoom controls for keyboard/accessibility.
- SPEC.md §10: camera state is local to each client. Another user's zoom never changes yours, and a synced edit must not reset it.
- `docs/design/ui-canvas/Zoom.dc.html` (artboard 17). Tokens: ground `#F3F4F1` with a `#D3D7D1` 1 px dot grid every 22 px.

## Goal
`apps/web/src/features/canvas/` provides:
- A pure camera reducer that defines exactly when the level changes.
- A `<Canvas>` component that turns wheel, pinch, drag-pan, click, double-click, Esc and button input into reducer actions, and renders caller-supplied content for the current level and focus.

The gallery shows it with fictional placeholder content so the real browser pipeline can verify it.

## Design decisions (binding)

### Camera model (`camera.ts`, pure, no DOM)
```ts
export type Level = 1 | 2 | 3;
export type ZoomTarget = { kind: 'org'; id: string } | { kind: 'group'; id: string };
export type Camera = { level: Level; orgId: string | null; groupId: string | null; scale: number; x: number; y: number };
export const INITIAL_CAMERA: Camera = { level: 1, orgId: null, groupId: null, scale: 1, x: 0, y: 0 };
export const MIN_SCALE = 0.6;          // below this, go up one level (level 1 clamps)
export const ENTER_SCALE = 1.8;        // above this on level 1 or 2, go deeper if a target is under the pointer, else clamp
export const MAX_SCALE_DEEPEST = 3;    // level 3 clamps here
export const WHEEL_FACTOR = 0.002;     // scale *= Math.exp(-deltaY * WHEEL_FACTOR)
export type CameraAction =
  | { type: 'wheel'; deltaY: number; anchor: { x: number; y: number }; target: ZoomTarget | null }
  | { type: 'pinch'; ratio: number; anchor: { x: number; y: number }; target: ZoomTarget | null }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'enter'; target: ZoomTarget }      // double-click on a tile/group
  | { type: 'zoomIn'; anchor: { x: number; y: number }; target: ZoomTarget | null } // button; anchor = viewport centre, target = current selection
  | { type: 'up' }                              // zoom-out button or Esc
  | { type: 'fit' };
export function cameraReducer(camera: Camera, action: CameraAction): Camera;
```
**Rules:**
- **Anchored zoom.** A wheel or pinch zoom keeps the content point under `anchor` fixed: `x' = ax − (ax − x)·k`, same for y, where `k = newScale / scale`.
- **Going deeper** (applies to `enter`, to a wheel or pinch past `ENTER_SCALE`, and to a `zoomIn` that crosses `ENTER_SCALE`):
  - Valid moves are level 1 to 2 with an `org` target, and level 2 to 3 with a `group` target.
  - Level 2 sets `orgId`. Level 3 sets `groupId` and keeps `orgId`.
  - The camera resets to `scale 1, x 0, y 0`.
  - A target of the wrong kind for the level, or no target, means no level change: scale clamps to `ENTER_SCALE` (or for `enter`, the state is returned unchanged).
- **Going up** (`up`, or a wheel or pinch below `MIN_SCALE`):
  - Level 3 → 2 (clear `groupId`). Level 2 → 1 (clear `orgId`).
  - The camera resets to `scale 1, x 0, y 0`.
  - At level 1, scale clamps to `MIN_SCALE`, and `up` returns the same state.
- **Level 3**: scale clamps to `[MIN_SCALE, MAX_SCALE_DEEPEST]` when zooming in (no deeper level). Going below `MIN_SCALE` still goes up.
- **`zoomIn`**: multiplies scale by 1.25 around `anchor` (the component passes the viewport centre). Crossing `ENTER_SCALE` goes deeper into `target` if valid, and otherwise clamps.
- **`fit`** → `INITIAL_CAMERA`. **`pan`** adds `dx`/`dy`. Neither changes the level.
- **Purity**: the reducer is pure, returns the same object when nothing changes, and never produces `NaN` (non-finite input → unchanged state).

### Component (`Canvas.tsx`)
```tsx
<Canvas
  camera={camera} onCameraChange={(next) => …}        // controlled: the caller owns camera (local state)
  renderLevel={(camera) => ReactNode}
  onSelect={(el: SelectTarget) => …}                   // SelectTarget = ZoomTarget | { kind: 'member'; id }
  onOpenNotes={(memberId) => …}
  selection={ZoomTarget | null}                         // used by the Zoom in button
/>
```
- **Targets.** Content marks its targets as follows:
  - `data-zoom-target="org:<id>"` or `"group:<id>"`.
  - `data-member-id="<id>"` for member cards.
  - The component resolves the target under the pointer with `closest()`.
- **Single click**: calls `onSelect` for the nearest target and never changes the camera.
- **Double-click**:
  - Member card → `onOpenNotes(id)`. A member card takes precedence over an enclosing zoom target, and the camera does not change.
  - Zoom target → `enter`.
  - Background → nothing.
- **Wheel**: `preventDefault`, then a `wheel` action with the pointer position relative to the canvas, and the target under the pointer.
- **Pinch**: two active touch or pen pointers, using pointer events. The distance ratio between moves produces `pinch`, anchored at the midpoint.
- **Pan**: a primary-button drag (or one-finger drag) that **starts on the background**, not on a target or member, gives `pan`. A drag that starts on a member card does nothing here (T-035 owns card drag). Moving less than 4 px before release is a click, not a pan.
- **Esc**: when the canvas or a descendant has focus, and the event target is not an `input`, `textarea`, `select` or contenteditable element, and the event is not already `defaultPrevented` → `up`.
- **Controls**: three real `<button>`s labelled "Zoom in", "Zoom out" and "Fit ward", at least 44×44 px, in a toolbar with `aria-label="Zoom"`.
  - Zoom in → `zoomIn` with `selection`.
  - Zoom out → `up`.
  - Fit ward → `fit`.
- **Level label**: a live region (`aria-live="polite"`) shows `Ward`, `Organization` or `Group`. It is visible text, not color.
- **Rendering**:
  - Content is wrapped in a layer with `transform: translate(x px, y px) scale(s)` and `transform-origin: 0 0`.
  - The background is the token dot grid.
  - Transform transitions use 150 ms, and none under `prefers-reduced-motion: reduce`.
  - The canvas fills its parent and never causes page-level horizontal scroll.
- **`useCamera()`** hook: `useReducer(cameraReducer, INITIAL_CAMERA)`, returning `[camera, dispatch-as-onCameraChange-compatible]`. This is a convenience for callers.

### Gallery demo
- Add a "Canvas" section to `Gallery.tsx`: a 900×560 canvas, 100% width under 900 px, using `useCamera`.
- Fictional content:
  - Level 1: four org tiles, "Relief Society", "Primary", "Sunday School" and "Elders Quorum", each with a vacancy count text.
  - Level 2 for any org: three group rows.
  - Level 3: six placeholder `PersonCard`/`VacancySlot` items, using `data-member-id` on the persons.
- Selection and the last opened note are shown as text ("Selected: Primary", "Notes: Ada Fictional") so the GUI capture proves the callbacks fired.

## Scope
May change:
- `apps/web/src/features/canvas/**` (new)
- `apps/web/src/design/Gallery.tsx` and `gallery.css` (the new section only)
- `apps/web/src/design/gallery.test.tsx`: new tests only
- `apps/web/e2e/canvas.spec.ts`, `apps/web/e2e/gui/canvas.capture.ts` (new)

Must not change:
- `apps/web/src/App.tsx`, `apps/web/src/sync/**`, other `apps/web/src/design/**` components, `apps/server/**`, `packages/**`, existing e2e files, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Camera reducer | `pnpm --filter @wardboard/web exec vitest run src/features/canvas/camera.test.ts` | all pass |
| 2 | Canvas interactions | `pnpm --filter @wardboard/web exec vitest run src/features/canvas/Canvas.test.tsx src/design/gallery.test.tsx` | all pass |
| 3 | Real-browser interactions | `pnpm --filter web run test:e2e` | all projects pass, including `canvas.spec.ts` |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | `gui-artifacts/canvas/` has level-1, level-2, level-3 and after-Esc screenshots for `desktop-chromium` and `tv-chromium`, plus level-1 for both phone projects; inspected per `docs/gui-verification.md` against artboard 17 |
| 5 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
`camera.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `wheel zoom keeps the anchor point fixed` | content point under the anchor is identical before/after (to 1e-9) | zooming around origin |
| `wheel in past ENTER_SCALE over an org goes to level 2 focused on it` | level 2, `orgId` set, scale 1, x/y 0 | threshold off-by-one or focus lost |
| `wheel in past ENTER_SCALE with no target clamps at ENTER_SCALE` | level 1, scale exactly 1.8 | enters with null focus |
| `wrong target kind does not change level` | level 1 + group target → clamps; level 2 + org target → clamps | kind not checked |
| `level 2 to 3 keeps orgId and sets groupId` | — | org focus lost |
| `level 3 clamps at MAX_SCALE_DEEPEST` | — | a phantom level 4 |
| `wheel out below MIN_SCALE goes up one level and clears the deeper focus` | 3→2 clears `groupId`; 2→1 clears `orgId` | clears both / skips levels |
| `level 1 clamps at MIN_SCALE and up is a no-op returning the same object` | — | negative level |
| `enter goes exactly one level deeper` | from level 1 with a group target → unchanged | multi-level jumps |
| `fit returns INITIAL_CAMERA from any state` | — | — |
| `pan never changes level or scale` | — | — |
| `pinch uses ratio and midpoint anchor like wheel` | — | — |
| `zoomIn crosses into the selection only when valid` | — | — |
| `non-finite input leaves state unchanged` | `deltaY: NaN`, `ratio: Infinity` | NaN camera |

`Canvas.test.tsx` (Testing Library and user-event)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `single click selects and never zooms` | `onSelect` with the org target; `onCameraChange` not called | click zooms |
| `double-click on a tile enters it` | camera level 2 with that org | — |
| `double-click on a member card opens notes, not zoom` | member nested inside a group target → `onOpenNotes`, no camera change | precedence wrong |
| `Esc goes up a level but not from inside an input` | — | Esc steals typing |
| `buttons are labelled and dispatch zoomIn/up/fit` | accessible names exact | icon-only unlabeled buttons |
| `level label text matches level` | Ward/Organization/Group | color-only |
| `drag on background pans; drag starting on a member card does not` | — | pan steals card drag |
| `a movement under 4 px is a click` | — | jittery clicks pan |
| `rerendering with new content keeps the camera` | parent re-renders `renderLevel` output; camera unchanged | camera reset on data update (SPEC §10) |

`gallery.test.tsx` (new test)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `gallery canvas demo shows four org tiles and zoom controls` | — | demo missing |

`apps/web/e2e/canvas.spec.ts` (desktop-chromium; also runs elsewhere and must not fail)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `double-click tile, then group, then Esc twice` | the level label goes Ward → Organization → Group → Organization → Ward | real-browser event wiring |
| `mouse wheel zooms in over a tile until level 2` | `page.mouse.wheel` repeatedly over Primary → label "Organization" | wheel not prevented or no target |
| `Fit ward from level 3` | — | — |
| `no horizontal page scroll at any viewport` | scrollWidth ≤ clientWidth | canvas overflows |

## Edge cases (each needs a test)
All are listed above: level bounds at both ends, a missing or wrong-kind target, non-finite input, Esc inside inputs, member versus zoom-target precedence, the click/pan threshold, and a content rerender.

## GUI verification
Required. Capture:
- Levels 1, 2 and 3, and after Esc, at desktop and TV.
- Level 1 at the phone projects: no horizontal scroll and controls at least 44 px. The phone uses tap-through screens later (T-047+). Here the phone only must not break.

Compare against artboard 17:
- The dot grid is visible.
- The level label and the three buttons are visible and do not overlap content.
- The selected tile shows a visible non-color cue beyond the border, such as the "Selected: …" text.

## Human checks
- In Chrome on a laptop (`/__gallery`, Canvas section):
  - Trackpad pinch and mouse-wheel zoom feel smooth.
  - The level switch at the threshold isn't jarring.
  - Panning by dragging the background feels natural.
- If the thresholds feel wrong, give the numbers you'd prefer (`ENTER_SCALE`, `MIN_SCALE`).
- On the office TV at 1920×1080, the level label and controls are readable from the table.

## Out of scope
- Real ward data and the level views (T-032 to T-034).
- Card drag and drop (T-035).
- Mounting in the app shell (T-030).
- Phone tap-through screens (T-047+).
- Persisting the camera.
