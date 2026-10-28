# T-081: Presentation mode in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-045, T-071 (settings push).

**Spec refs:** SPEC.md §10 Presentation mode (large text, leadership photos, tags, labels and vacancy markers; editing chrome hidden; the only setting is Show Needs approval, default off; notes never shown; the laptop operator navigates; edits from phones appear live). Artboard 6 (`Presentation.dc.html`).

### Integration conventions (all shell-integration tasks T-076 to T-083)
- `apps/web/src/shell/BoardShell.tsx` is shared by every integration task. Keep its edits small: put new wiring in a new file under `apps/web/src/shell/` (named in Scope) and change `BoardShell.tsx` only to render it and pass props. Tasks may be implemented in parallel and are merged one at a time as they pass verification. Each rebases onto `origin/main` before its verification, and a merge conflict means a new round for the later task.
- Existing tests (`BoardShell.test.tsx`, `board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`, and all feature tests) must keep passing unchanged. Keep existing accessible names. For example, the header search field stays `Search people, callings, tags`.
- New unit tests go in a new file `apps/web/src/shell/<name>.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `BoardShell.test.tsx`. New e2e specs run against the real checkout server (`apps/web/e2e/checkout-server.ts`, fictional ward) at all four projects, using real mouse and keyboard input.
- GUI verification is required (`docs/gui-verification.md`): capture the integrated app at `/`, not the previews, at desktop, phone (Chromium and WebKit) and TV, and compare with the named artboards. Integration must not change the phone layout. At 390px the desktop shell renders as it does today until the phone-layout task.

## Goal
A **Present** button in the header switches this browser to `Presentation` for the active board, using live sync data and the server's Show Needs approval setting. **Exit** or Escape returns to the board with the same tab and camera.

## Design decisions (binding)
- New `apps/web/src/shell/PresentMode.tsx`. `BoardShell` keeps a local `presenting` flag and renders `<Presentation>` instead of the shell body and header when it is set. Props:
  - `board`, `ward`, `baseline` from sync.
  - `title`: Current or the proposal name.
  - `status`: `current` / `draft` / `accepted`.
  - `baselineCapturedAt`: the baseline board's capture time if available, else `null`.
  - `showNeedsApproval`: `useSettings()?.showNeedsApproval ?? false`.
  - `onExit`: clears the flag.
- The `Present` button (≥44px) sits in the header next to the account area. When presenting, the page requests fullscreen only if the browser allows it without a prompt; if the request fails, keep going windowed.
- The camera and selected tab are preserved across entering and exiting.
- Live updates keep flowing while presenting (no new subscription).

## Scope
May change: `apps/web/src/shell/BoardShell.tsx`, `apps/web/src/shell/PresentMode.tsx` (new), `apps/web/src/shell/present-mode.test.tsx` (new), `apps/web/e2e/present-mode.spec.ts`, `apps/web/e2e/gui/present-mode.capture.ts` (new).
Must not change: `features/presentation/**`, sync, server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/present-mode.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `present-mode.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/present-mode/` TV (primary) and desktop captures of presenting a proposal, compared with artboard 6; no editing chrome, no notes |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Present hides the header and shows the presentation of the active board` | | chrome still visible |
| `Exit and Escape return with the same tab and camera` | | camera reset |
| `Show Needs approval follows the server setting live` | a `settings` push toggles the label in presentation | value read once |
| `a committed op from another client appears while presenting` | `committed` frame updates the presentation | stale view |
| `no note text renders while presenting` | Jay Storybook's note absent | note leaked |
`e2e/present-mode.spec.ts` (real server): `present the fixture proposal and exit with Escape`.

## Edge cases (each needs a test)
Covered above: Escape, live setting change, live op, notes; fullscreen refused (stub `requestFullscreen` to reject; add a test).

## Human checks
Office TV: present from the laptop; readable from the meeting table; Exit works with the keyboard (carried from T-045).

## Out of scope
Changes to the presentation layout (T-045).
