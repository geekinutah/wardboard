# T-076: Board views: Aaronic Priesthood view and removed markers in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-030, T-040, T-044 (all `done`).

**Spec refs:** SPEC.md §4 (bishop as a fixed linked card in the priests quorum; editable "Overseen by"), §8 "Removed members and positions in proposals" (markers on affected cards and a diff-style summary at the top of the proposal). Artboards 9 (`Removed.dc.html`) and 16 (`Aaronic.dc.html`).

### Integration conventions (all shell-integration tasks T-076 to T-083)
- `apps/web/src/shell/BoardShell.tsx` is shared by every integration task. Keep its edits small: put new wiring in a new file under `apps/web/src/shell/` (named in Scope) and change `BoardShell.tsx` only to render it and pass props. Tasks may be implemented in parallel and are merged one at a time as they pass verification. Each rebases onto `origin/main` before its verification, and a merge conflict means a new round for the later task.
- Existing tests (`BoardShell.test.tsx`, `board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`, and all feature tests) must keep passing unchanged. Keep existing accessible names. For example, the header search field stays `Search people, callings, tags`.
- New unit tests go in a new file `apps/web/src/shell/<name>.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `BoardShell.test.tsx`. New e2e specs run against the real checkout server (`apps/web/e2e/checkout-server.ts`, fictional ward) at all four projects, using real mouse and keyboard input.
- GUI verification is required (`docs/gui-verification.md`): capture the integrated app at `/`, not the previews, at desktop, phone (Chromium and WebKit) and TV, and compare with the named artboards. Integration must not change the phone layout. At 390px the desktop shell renders as it does today until the phone-layout task.

## Goal
On the real board, level 2 for the Aaronic Priesthood board group renders `AaronicView` (oversight edits sent as `setOversight`), and on a proposal the removed markers and `RemovedSummary` appear wherever T-040 supports them.

## Design decisions (binding)
- New `apps/web/src/shell/board-levels.tsx` exports `renderBoardLevel(levelCamera, ctx)`, which holds the per-level logic now inline in `BoardShell`'s `renderLevel`. `BoardShell` calls it. Same output as today, except for the following:
- **Level 2:** when the board group's `key === 'aaronic_priesthood'`, render `<AaronicView … readOnly onSetOversight={(r) => void send('setOversight', r)} />` instead of `OrganizationView`. `onOpenBishopric` zooms the camera to the Bishopric board group (`key === 'bishopric'`), if it exists.
- **Removed state:** when the active board is a proposal and `boards.current` is known, the shell fetches the Current board once per Current board id (`fetchBoard`) and computes `removedState({ id, baseline, board, … }, currentBoard, ward)`. Pass it as `removed` to `GroupDetail` and `OrganizationView`. Above the canvas, on proposals only, render `<RemovedSummary rows={removedRows(…)} />`; it renders nothing when there are no rows. On Current, or while the Current board is loading, pass nothing.
- Read-only rules are unchanged (`readOnly` for Current and Accepted).

## Scope
May change: `apps/web/src/sync/react.tsx` (expose `fetchBoard: client.fetchBoard` on `useSync()`), `apps/web/src/shell/BoardShell.tsx` (render the helper, fetch Current), `apps/web/src/shell/board-levels.tsx` (new), `apps/web/src/shell/board-levels.test.tsx` (new), `apps/web/e2e/board-views.spec.ts`, `apps/web/e2e/gui/board-views.capture.ts` (new). For the removed scenario the e2e may seed through the existing seed seam in `apps/web/e2e/checkout-server.ts` **only if** that file already supports it. Otherwise cover removed markers in unit tests only and say so.
Must not change: features, other sync files, server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/board-levels.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `board-views.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/board-views/` has the Aaronic level 2 and a proposal with a removed summary (or the unit-test-only note), compared with artboards 9 and 16 |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Aaronic board group renders AaronicView at level 2; others render OrganizationView` | the Aaronic group shows the bishop's fixed linked card; Relief Society shows the org view | key check missing |
| `changing Overseen by sends setOversight once with the view's request` | one `op` frame of kind `setOversight` | handler not wired |
| `Accepted and Current render the Aaronic view read-only` | no "Change" control | read-only ignored |
| `a proposal with a removed member shows the summary and the marked card` | ward with `removedDate` on a placed member → `RemovedSummary` lists them and the group card shows the REMOVED treatment | removed state not computed or not passed |
| `Current shows no removed summary` | same ward on Current | summary on Current |
| `Current board is fetched once per Current id` | switching tabs back and forth sends one `getBoard` | refetch loop |
`e2e/board-views.spec.ts`: `zoom into Aaronic Priesthood and change a counselor's oversight` on the real server; the change persists after reload.

## Edge cases (each needs a test)
Covered above: no Aaronic group present (renders like any org; add a test), Current, Accepted, removed member, refetch.

## Human checks
none

## Out of scope
Removed-state changes in core; new seed data in the server.
