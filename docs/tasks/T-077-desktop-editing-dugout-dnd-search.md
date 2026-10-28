# T-077: Desktop editing: dugout panel, drag and drop, and search in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-035, T-036, T-038, T-073 (all `done`). Fixes backlog **B-031** (approval id after a list drop).

**Spec refs:** SPEC.md §3 (moves, Add to dugout, second calling), §5 (dugout), §6 (needs approval), §10 Global search (on every desktop screen; navigate/zoom to a result). Artboards 1, 2, 3, 4, 11, 12.

### Integration conventions (all shell-integration tasks T-076 to T-083)
- `apps/web/src/shell/BoardShell.tsx` is shared by every integration task. Keep its edits small: put new wiring in a new file under `apps/web/src/shell/` (named in Scope) and change `BoardShell.tsx` only to render it and pass props. Tasks may be implemented in parallel and are merged one at a time as they pass verification. Each rebases onto `origin/main` before its verification, and a merge conflict means a new round for the later task.
- Existing tests (`BoardShell.test.tsx`, `board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`, and all feature tests) must keep passing unchanged. Keep existing accessible names. For example, the header search field stays `Search people, callings, tags`.
- New unit tests go in a new file `apps/web/src/shell/<name>.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `BoardShell.test.tsx`. New e2e specs run against the real checkout server (`apps/web/e2e/checkout-server.ts`, fictional ward) at all four projects, using real mouse and keyboard input.
- GUI verification is required (`docs/gui-verification.md`): capture the integrated app at `/`, not the previews, at desktop, phone (Chromium and WebKit) and TV, and compare with the named artboards. Integration must not change the phone layout. At 390px the desktop shell renders as it does today until the phone-layout task.

## Goal
On the real desktop board, the dugout panel sits beside the canvas, member cards can be dragged between positions and onto the dugout with T-035's dialogs, every resulting operation is sent to the server, and the header search is the real `SearchBox` with navigate, highlight and Add to dugout.

## Design decisions (binding)
- New `apps/web/src/shell/EditingLayer.tsx`. It wraps the canvas and the dugout panel in one `<DndSurface board ward proposal me readOnly onCommit onHoverOpen>`. `proposal` is the core `Proposal` built from `proposal` (view) + `baseline` + `board`, or `null` on Current.
- **Layout:** the `DugoutPanel` sits to the right of the canvas at desktop and TV widths (≥ 1024px). Below that it stacks under the canvas, and nothing breaks at 390px.
- **Sending ops:** `onCommit(ops)` sends ops **sequentially** with `send(kind, request)`, awaiting each `OpOutcome`, and stops at the first failure. A failure shows `role="alert"` `Couldn't apply the change: {message}`. Offline failures are already shown by the sync banner; don't add a second message for `code === 'offline'`.
- **B-031:** for an `approvePlacement` that follows an `addToList`, don't trust the client-computed `positionId`. After the `addToList` commit, wait for the committed board from the sync state. Then find the dragged member's position in that list assignment that has no approval, and send `approvePlacement { memberId, positionId }` with that id. If no such position is found, show the alert and send nothing.
- **Hover-open:** `onHoverOpen('org:x' | 'group:x')` dispatches the same camera zoom as double-clicking that tile or row (`cameraReducer`).
- **Search:** replace the header's placeholder `<input>` with `<SearchBox>`. Its input keeps the accessible name `Search people, callings, tags`. Props:
  - `boards`: the active board plus the other loaded boards.
  - `onNavigate`: for a calling, select the board (when different) and zoom to its group; for a person, zoom to their first calling's group on the active board, or open the dugout when they have none.
  - `onHighlight`: passes ids to the canvas views via a context or prop. If no canvas view accepts highlight ids yet, keep them in shell state only and say so in the report (highlight rendering is not required here).
  - `onAddToDugout`: `send('addToDugout', request)`.
- **Never** mount `DndSurface` in a phone layout (backlog B-032). This task renders the desktop shell only.

## Scope
May change: `apps/web/src/shell/BoardShell.tsx`, `apps/web/src/shell/EditingLayer.tsx` (new), `apps/web/src/shell/editing.css` (new), `apps/web/src/features/dnd/resolve.ts` and its test **only** if the B-031 fix needs a helper there, `apps/web/src/shell/editing.test.tsx` (new), `apps/web/e2e/editing.spec.ts`, `apps/web/e2e/gui/editing.capture.ts` (new).
Must not change: other features, sync, server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/editing.test.tsx src/features/dnd` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `editing.spec.ts` (desktop and TV with real mouse drags; phone projects assert only that the page renders without horizontal scroll) |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/editing/`: board with dugout panel, mid-drag, drop dialog, search dropdown open; compared with artboards 1, 2, 3, 11 |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `dugout panel renders beside the canvas with the active board's dugout` | panel present; names from `dugout(board, ward)` | panel unmounted |
| `a committed drop sends its ops in order and waits for each` | two-op commit → second `op` frame sent only after the first outcome | parallel sends |
| `a refused op stops the sequence and shows the alert` | first outcome `rejected` → no second frame; alert text | approval sent after a failed placement |
| `approval after addToList uses the server-committed position id (B-031)` | the server's committed board places the member at a different id than the client predicted → `approvePlacement` carries the server's id | client id used |
| `no drag on Current or Accepted` | pointer drag does nothing | read-only ignored |
| `hover-open zooms the camera like a double-click` | `onHoverOpen('group:…')` → level 3 for that group | hover ignored |
| `search navigates to a calling on another board` | selects that board and zooms to the group | stays on the active board |
| `search Add to dugout sends addToDugout` | one `op` frame | not wired |
`e2e/editing.spec.ts` (real server): `drag a dugout member into a vacancy and see it after reload`; `drop on an occupied calling and Swap`; `search for a person and jump to their calling`.

## Edge cases (each needs a test)
Covered above: refused op, offline, B-031 id mismatch, read-only boards, other-board search result, person with no calling.

## Human checks
- Desktop Chrome: drag several cards between groups and onto the dugout; the ghost tracks smoothly and the drop target is obvious (carried from T-035).

## Out of scope
Out-of-Unit tile and drags (T-083); person inspector (T-078); the phone layout.
