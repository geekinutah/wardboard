# T-082: Proposal summary page in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** **T-042 (in progress)**. Starts only after T-042 is verified `done`. Uses T-042's `<Summary proposal current ward importedAt onExit />` (`features/summary/Summary.tsx`).

**Spec refs:** SPEC.md §3 (net suggested callings and releases versus the baseline), §8 (divergence section), and the T-042 contract. Artboard 7 (`Summary.dc.html`).

### Integration conventions (all shell-integration tasks T-076 to T-083)
- `apps/web/src/shell/BoardShell.tsx` is shared by every integration task. Keep its edits small: put new wiring in a new file under `apps/web/src/shell/` (named in Scope) and change `BoardShell.tsx` only to render it and pass props. Tasks may be implemented in parallel and are merged one at a time as they pass verification. Each rebases onto `origin/main` before its verification, and a merge conflict means a new round for the later task.
- Existing tests (`BoardShell.test.tsx`, `board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`, and all feature tests) must keep passing unchanged. Keep existing accessible names. For example, the header search field stays `Search people, callings, tags`.
- New unit tests go in a new file `apps/web/src/shell/<name>.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `BoardShell.test.tsx`. New e2e specs run against the real checkout server (`apps/web/e2e/checkout-server.ts`, fictional ward) at all four projects, using real mouse and keyboard input.
- GUI verification is required (`docs/gui-verification.md`): capture the integrated app at `/`, not the previews, at desktop, phone (Chromium and WebKit) and TV, and compare with the named artboards. Integration must not change the phone layout. At 390px the desktop shell renders as it does today until the phone-layout task.

## Goal
On a proposal, a **Summary** button in the status strip opens T-042's summary page for that proposal with live data. Exit returns to the board.

## Design decisions (binding)
- New `apps/web/src/shell/SummaryMode.tsx`. `BoardShell` keeps a local `summaryOpen` flag (proposal boards only) and renders `<Summary>` in place of the canvas area. The header stays visible, so search and tabs remain on every desktop screen (SPEC §10). Switching tabs closes the summary.
- `proposal` is the core `Proposal` built from the proposal view, `baseline` and `board`. `current` is the Current board, fetched once per Current id (reuse T-076's fetch if it has merged; otherwise `fetchBoard`). `importedAt` comes from `boards.current.importedAt`. `onExit` clears the flag.
- While Current is loading, show `Loading summary…`.

## Scope
May change: `apps/web/src/shell/BoardShell.tsx`, `apps/web/src/shell/SummaryMode.tsx` (new), `apps/web/src/shell/summary-mode.test.tsx` (new), `apps/web/e2e/summary-mode.spec.ts`, `apps/web/e2e/gui/summary-mode.capture.ts` (new).
Must not change: `features/summary/**`, sync, server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/summary-mode.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `summary-mode.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/summary-mode/` on all four projects, compared with artboard 7 |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Summary button appears on proposals only` | not on Current | summary for Current |
| `opens with the proposal's net changes and Exit returns` | a known suggested calling is listed | wrong baseline |
| `updates live when an op commits` | `committed` frame → the summary changes | stale data |
| `switching tabs closes the summary` | | summary of the wrong proposal |
| `shows Loading summary… until Current arrives` | | crash on null Current |
`e2e/summary-mode.spec.ts` (real server): `open the fixture proposal's summary and download the CSV` (assert a download with a `.csv` name).

## Edge cases (each needs a test)
Covered above: Current, live updates, tab switch, loading.

## Human checks
none

## Out of scope
Accepted-proposal view (T-043).
