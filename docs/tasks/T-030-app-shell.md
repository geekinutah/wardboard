# T-030: App shell

**Milestone:** 4 — Desktop board
**Depends on:** T-004 (design components), T-029 (sync), T-031 (canvas), T-032, T-033 and T-034 (level views), T-071 (`useMe`, `useBaseline`). All `done`.
- Promotes B-027 into this task.
- T-035 (drag and drop) follows this task. T-040 runs alongside it; T-040 edits `GroupDetail.tsx`, `OrganizationView.tsx` and their CSS, and this task only mounts those components.

**Spec refs:**
- SPEC.md §3:
  - Current is read-only and identifiable as the reference board; its import date is displayed prominently.
  - Proposals are compared against their baseline.
- SPEC.md §4: the three zoom levels.
- SPEC.md §7: adding a position changes only this proposal.
- SPEC.md §10:
  - Tabs represent proposals.
  - Active tab, pan, zoom and selection are local to each client.
  - A synchronized edit must not reset local camera state.
  - A persistent search bar appears on every desktop screen.
- Artboard 1 (`docs/design/ui-canvas/Main.dc.html`), for the header and status strip.

## Goal
The app at `/` shows the real board.
- **Header:**
  - the brand;
  - a tab for Current and one per proposal;
  - a persistent search input slot;
  - the signed-in user's name and role;
  - the existing connection indicator.
- **Status strip:**
  - the board's status badge and its date line;
  - the suggested calling, suggested release, and vacancy counts;
  - the existing server-health text.
- **The spatial canvas** (T-031), showing the ward overview, organization, and group detail levels with live synced data. On an editable proposal, "+ Add position" and "+ Add group" send real operations.

## Design decisions (binding)

### Structure (`apps/web/src/shell/`)
`App.tsx` keeps the `/__gallery` route and replaces the body of `AppShell` with `<BoardShell healthClient>` from `shell/`, inside the existing `SyncProvider`.

**Header** (`<header>`, role banner):
- The text `WardBoard`.
- Tabs in a `role="tablist"`:
  - The first tab is `Current`, with the secondary text `imported {Mon D}` taken from `boards.current.importedAt` (en-US, UTC).
  - Then one tab per proposal, in `tabOrder`, labeled by name, with the secondary text `Accepted` for Accepted proposals.
- Each tab is a `role="tab"` button. The selected tab has `aria-selected="true"` **and** a visible non-color indicator, such as an underline bar or bold weight.
- Selecting a tab calls `open(boardId)`. The choice is local and is never sent anywhere else.
- On the first `boards` message with a Current board, the shell opens Current automatically.
- A search slot: `<input type="search" aria-label="Search people, callings, tags" placeholder="Search people, callings, tags">`. It is inert in this task; T-038 adds behavior.
- An account area from `useMe()`, showing `{displayName}` and `Admin` or `Editor` as text. While `me` is `null` it renders nothing.
- `ConnectionIndicator`, unchanged and still inside the banner.

**Status strip** (inside `<main>`, above the canvas):
- A badge as text:
  - `CURRENT` for Current;
  - `PROPOSED` for a Draft proposal;
  - `ACCEPTED` for an Accepted proposal.
- A date line:
  - Current: `Imported {Mon D, YYYY}`.
  - Proposal: `Compared with its baseline`. The baseline capture date is not in the client state and is out of scope.
- Counts, for proposals only once `useBaseline()` has returned a board:
  - `+ {n} suggested callings` and `− {n} suggested releases`, from `diffBoards(baseline, board)`;
  - `{n} vacant positions`, from `vacancies(board).length`, shown for every board.
- The existing health `<p role="status">` (`Checking server…` / `Server: ok` / `Server unreachable`), kept inside `<main>`.
- `SyncBanner`, unchanged.

**Canvas:**
- `useCamera()` and `<Canvas>`, with `renderLevel` mapping:
  - level 1 → `<WardOverview board ward baseline selectedId>`;
  - level 2 → `<OrganizationView board ward baseline boardGroupId={camera.orgId}>`;
  - level 3 → `<GroupDetail board ward baseline callingGroupId={camera.groupId} readOnly onAddPosition onAddGroup>`.
- `readOnly` is true for Current and for Accepted proposals.
- `onAddPosition(req)` → `send('addAssignment', req)`, and `onAddGroup(req)` → `send('addCallingGroup', req)`. A rejected outcome surfaces through the existing `SyncBanner` notice. No other UI is needed.
- Selection is local state. `onOpenNotes` is a no-op until T-037.
- Before `board` and `ward` exist, the canvas area shows `Loading board…` as text.
- **Camera is local.**
  - A `committed` update to the open board must not reset the camera: level, org, group, scale and pan stay the same.
  - Switching tabs resets the camera to level 1.
  - If the open org or group no longer exists after an update, the camera falls back one level.

**B-027 fix** (`apps/web/src/sync/react.tsx`):
- `useBaseline` treats a `null` fetch result as not loaded.
- It retries when the connection next becomes `live` with the same `baselineBoardId`.
- The existing `hooks.test.tsx` cases stay as they are. Add a new test.

**Not in this task:**
- presence avatars;
- the Summary and Present buttons;
- the dugout panel;
- search behavior.
No placeholder text for any of them.

## Scope
May change:
- `apps/web/src/shell/**` (new)
- `apps/web/src/App.tsx` (the `AppShell` body only)
- `apps/web/src/app.css`
- `apps/web/src/sync/react.tsx` (the B-027 fix only)
- `apps/web/src/sync/baseline-retry.test.tsx` (new)
- `apps/web/e2e/board-shell.spec.ts`, `apps/web/e2e/gui/board-shell.capture.ts` (new)

Must not change:
- Existing tests (`App.test.tsx`, `smoke.spec.ts`, `sync.spec.ts`, the `shell`/`sync` captures, and all others).
- `apps/web/src/features/**`, `apps/web/src/design/**`, `apps/web/src/preview/**`, `main.tsx`, `apps/server/**`, `packages/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Shell components (Testing Library, fake `SyncClient`) | `pnpm --filter web exec vitest run src/shell` | every `src/shell` test in the table passes |
| 2 | B-027 | `pnpm --filter web exec vitest run src/sync/baseline-retry.test.tsx` | passes |
| 3 | Existing tests untouched and green | `git diff main --stat -- apps/web/src/App.test.tsx apps/web/src/sync/hooks.test.tsx apps/web/e2e/smoke.spec.ts apps/web/e2e/sync.spec.ts apps/web/e2e/gui/shell.capture.ts apps/web/e2e/gui/sync.capture.ts && pnpm --filter web test` | empty diff; exits 0 |
| 4 | E2E against the seeded fixture server | `pnpm --filter web run test:e2e` | exits 0, including `board-shell.spec.ts` on all four projects |
| 5 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/board-shell/` has desktop, phone and TV PNGs for Current level 1, proposal level 1, and proposal level 3 with the add form open, inspected against artboard 1 |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `shell/BoardShell.test.tsx` › `tabs list Current first then proposals in tabOrder; Accepted shows its text` | tab model | wrong order |
| `shell/BoardShell.test.tsx` › `opens Current automatically on first boards message` | default board | blank canvas |
| `shell/BoardShell.test.tsx` › `selecting a proposal tab calls open with its boardId and marks it aria-selected` | local tab selection | not opening |
| `shell/BoardShell.test.tsx` › `status strip: CURRENT + Imported date + vacant count; no callings/releases` | Current strip | NaN counts |
| `shell/BoardShell.test.tsx` › `status strip: PROPOSED with +callings/−releases from diffBoards once baseline loads` | proposal strip | counting without baseline |
| `shell/BoardShell.test.tsx` › `account shows displayName and role text; nothing while me is null` | account | crash on null |
| `shell/BoardShell.test.tsx` › `search input is present with its label on every level` | persistent search slot | missing at level 3 |
| `shell/BoardShell.test.tsx` › `level 3 on Current and on Accepted is readOnly (no add controls)` | read-only Current | editable Current |
| `shell/BoardShell.test.tsx` › `add position on a Draft proposal sends addAssignment with the emitted request` | wiring | wrong op kind |
| `shell/BoardShell.test.tsx` › `a committed update keeps camera level, org, group and scale` | SPEC local camera | resetting on update |
| `shell/BoardShell.test.tsx` › `switching tabs resets camera to level 1; deleted open group falls back one level` | camera rules | stuck on a missing group |
| `shell/BoardShell.test.tsx` › `Loading board… before snapshot` | loading | crash before data |
| `sync/baseline-retry.test.tsx` › `null baseline fetch retries after reconnect with the same id` | B-027 | stays null |
| `board-shell.spec.ts` › `opens Current, switches to the fixture proposal, zooms to a group, adds a position and sees it committed` | end to end over the real server | not wired to send |

## Edge cases (each needs a test)
- No proposals.
- No Current (`boards.current` null): the tabs show only proposals, and no board opens automatically.
- `me` null.
- An add rejected by the server shows the existing notice.

## Human checks
- In Chrome on desktop, with `pnpm dev`: switch tabs, zoom to a group, add a position from another window on the same proposal, and confirm your zoom and pan did not move.

## Out of scope
- Presence, Summary, Present, the dugout, search behavior, notes, and removed markers (T-040 adds the props; mounting them follows).
- The phone navigation model (Milestone 5).
- Drag and drop (T-035).
