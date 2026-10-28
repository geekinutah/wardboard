# T-083: Out-of-Unit tile, view and drags on the board

**Milestone:** 4 — Desktop board (integration)
**Depends on:** **T-074 (todo)** and T-077. Starts only after both are `done`.

**Spec refs:** SPEC.md §4 item 9 (Out-of-Unit area: read-only, same on every board, drag to dugout with no warning), §3 (placing them prompts the second-calling confirmation). Decision record B-030.

### Integration conventions (all shell-integration tasks T-076 to T-083)
- `apps/web/src/shell/BoardShell.tsx` is shared by every integration task. Keep its edits small: put new wiring in a new file under `apps/web/src/shell/` (named in Scope) and change `BoardShell.tsx` only to render it and pass props. Tasks may be implemented in parallel and are merged one at a time as they pass verification. Each rebases onto `origin/main` before its verification, and a merge conflict means a new round for the later task.
- Existing tests (`BoardShell.test.tsx`, `board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`, and all feature tests) must keep passing unchanged. Keep existing accessible names. For example, the header search field stays `Search people, callings, tags`.
- New unit tests go in a new file `apps/web/src/shell/<name>.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `BoardShell.test.tsx`. New e2e specs run against the real checkout server (`apps/web/e2e/checkout-server.ts`, fictional ward) at all four projects, using real mouse and keyboard input.
- GUI verification is required (`docs/gui-verification.md`): capture the integrated app at `/`, not the previews, at desktop, phone (Chromium and WebKit) and TV, and compare with the named artboards. Integration must not change the phone layout. At 390px the desktop shell renders as it does today until the phone-layout task.

## Goal
The ward overview shows the Out-of-Unit tile after the organizations. Opening it (double-click, `Open Out-of-Unit`, or hover while dragging) shows `OutOfUnitView` in the canvas. Its member cards can be dragged into callings (second-calling dialog) or onto the dugout (no warning), and `Add to dugout` sends `addToDugout`.

## Design decisions (binding)
- **Camera:** extend the shell's level handling, not `features/canvas`: treat the zoom target `org:out-of-unit` as a level-2 area rendered by `OutOfUnitView`. The tile carries `data-zoom-target="org:out-of-unit"` from a wrapper in the shell, so the canvas's existing double-click and keyboard zoom work. If the canvas rejects unknown org ids, report that as a blocker instead of editing `features/canvas`.
- **Level 1:** `board-levels.tsx` (from T-076) renders `WardOverview` followed by `<OutOfUnitTile ward onOpen>` (zoom to `org:out-of-unit`). The tile is shown only when `outOfUnitMembers(ward)` is non-empty.
- **Drags:** the view's `<article data-member-id>` cards already act as `member` drag sources inside T-077's `DndSurface` (no change needed). `Add to dugout` → `send('addToDugout', …)`. Read-only boards: no button, no drag.

## Scope
May change: `apps/web/src/shell/board-levels.tsx`, `apps/web/src/shell/BoardShell.tsx`, `apps/web/src/shell/out-of-unit.test.tsx` (new), `apps/web/e2e/out-of-unit-board.spec.ts`, `apps/web/e2e/gui/out-of-unit-board.capture.ts` (new).
Must not change: `features/**` (including canvas, ward-overview, out-of-unit), sync, server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/out-of-unit.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `out-of-unit-board.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/out-of-unit-board/`: overview with the tile, the opened view, the second-calling dialog after dragging Kai Fictional into a vacancy |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `overview shows the Out-of-Unit tile after the organizations` | tile present; order last | tile missing or first |
| `no tile when no one serves outside the ward` | | empty tile |
| `double-click and Open Out-of-Unit show the view` | | zoom target unknown |
| `dragging Kai into a vacancy asks for a second calling and sends addToList` | | outside callings not counted |
| `dragging Kai to the dugout sends addToDugout with no dialog` | | warning shown |
| `Current: no Add to dugout and no drag` | | read-only ignored |
`e2e/out-of-unit-board.spec.ts` (real server; the dev seed has Hal Testwell and Kai Fictional with outside callings): `open Out-of-Unit and add Kai to the dugout`.

## Edge cases (each needs a test)
Covered above: none serving outside, read-only, both drag targets.

## Human checks
Office TV: the Out-of-Unit tile reads as separate from the ward organizations (carried from T-074).

## Out of scope
Presentation mode's handling of the tile (follow-up if Mike wants it on the TV).
