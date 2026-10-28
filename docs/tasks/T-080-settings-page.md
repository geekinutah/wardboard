# T-080: Settings page in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-046, T-075, T-028, T-072.

**Spec refs:** SPEC.md §2 (invitations, admins, last-admin protection), §10 (Show Needs approval, admin only; backup and restore). Artboard 18. Server routes: `GET /api/admin/backup` (download), `POST /api/admin/restore?mode=dry-run|apply` (200 `{summary}` / 200 `{restored, summary}`, 422 `{error: RestoreErrorCode}`, 413 `too_large`, 403 `forbidden`), in `apps/server/src/backup/http.ts`.

### Integration conventions (all shell-integration tasks T-076 to T-083)
- `apps/web/src/shell/BoardShell.tsx` is shared by every integration task. Keep its edits small: put new wiring in a new file under `apps/web/src/shell/` (named in Scope) and change `BoardShell.tsx` only to render it and pass props. Tasks may be implemented in parallel and are merged one at a time as they pass verification. Each rebases onto `origin/main` before its verification, and a merge conflict means a new round for the later task.
- Existing tests (`BoardShell.test.tsx`, `board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`, and all feature tests) must keep passing unchanged. Keep existing accessible names. For example, the header search field stays `Search people, callings, tags`.
- New unit tests go in a new file `apps/web/src/shell/<name>.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `BoardShell.test.tsx`. New e2e specs run against the real checkout server (`apps/web/e2e/checkout-server.ts`, fictional ward) at all four projects, using real mouse and keyboard input.
- GUI verification is required (`docs/gui-verification.md`): capture the integrated app at `/`, not the previews, at desktop, phone (Chromium and WebKit) and TV, and compare with the named artboards. Integration must not change the phone layout. At 390px the desktop shell renders as it does today until the phone-layout task.

### Shared client accessor (amendment, 2026-10-28)
`useSync()` doesn't expose the T-075 request methods, and `SyncContext` in `apps/web/src/sync/react.tsx` isn't exported. This task may add exactly the function below to `apps/web/src/sync/react.tsx`, immediately after the closing brace of `useSync()`, and change nothing else in that file. T-078, T-079 and T-080 carry this identical amendment, so whichever merges first adds it and the others' identical hunk applies cleanly. If it's already on `main` when you start or rebase, use it and don't add it again.

```ts

export function useSyncClient(): SyncClient {
  const client = useContext(SyncContext);
  if (client === null) throw new Error('useSyncClient must be used within SyncProvider');
  return client;
}
```

Extra unit test in this task's new test file: `useSyncClient returns the provider's client and throws outside SyncProvider` (fails if the hook returns a different client or doesn't throw).

## Goal
The account area in the header has a **Settings** link that opens `SettingsPage` at `/settings`, wired to the real server: access management through the T-075 methods, the Show Needs approval switch, backup download, and two-step restore. **Back to board** returns to `/` without a full reload.

## Design decisions (binding)
- **Routing:** `App.tsx` renders `<SettingsRoute>` (new `apps/web/src/shell/SettingsRoute.tsx`) inside the existing `SyncProvider` when `location.pathname === '/settings'`, and `BoardShell` otherwise. Navigation uses `history.pushState` plus a `popstate` listener; the sync connection survives the switch. `/__gallery` and the preview route are unchanged.
- **Header:** a `Settings` link (anchor to `/settings`, intercepted for `pushState`) in the account area, shown to every signed-in user.
- **Wiring in `SettingsRoute`:**
  - `me` comes from `useMe()`, and `showNeedsApproval` from `useSettings()`.
  - `access` comes from `useAccess()`. It calls `client.listAccess()` on mount for admins only.
  - The access actions call the T-075 methods and map `{ ok: false, code }` to the page's `ActionResult`. Unknown codes map to `forbidden`.
  - `backupUrl` is `/api/admin/backup`.
  - `validateRestore` and `applyRestore` `fetch` the restore route with `method: 'POST'`, the file as the body, and `credentials: 'same-origin'`. Responses map to `RestoreResult` (200 → summary, 422 → `error`, 413 → `too_large`, 403 → `forbidden`), and a network error → `offline`.
  - `onRestored` calls `window.location.assign('/')`.
- Until `me` loads, show `Loading…`.

## Scope
May change: `apps/web/src/App.tsx`, `apps/web/src/shell/BoardShell.tsx` (the header link only), `apps/web/src/shell/SettingsRoute.tsx` (new), `apps/web/src/shell/settings-route.test.tsx` (new), `apps/web/e2e/settings-route.spec.ts`, `apps/web/e2e/gui/settings-route.capture.ts` (new), `apps/web/src/sync/react.tsx` (only the `useSyncClient` addition above), `apps/web/src/shell/settings-route.css` (new; styles for the header Settings link and route chrome).
Must not change: `features/settings/**`, sync (except the `useSyncClient` addition), server, packages, existing tests (including `App.test.tsx`).

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/settings-route.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `settings-route.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/settings-route/` admin page at `/settings` on all four projects, compared with artboard 18 |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Settings link opens /settings without reloading; Back returns` | `pushState` path; sync client not restarted | full reload drops the socket |
| `admin sees the access list from listAccess and its pushes` | | list never loads |
| `invite sends invite and shows the mapped error on refusal` | `already_invited` → page text | raw code shown |
| `editor never calls listAccess` | no `listAccess` frame | editors probe admin API |
| `restore dry-run maps 200, 422, 413, 403 and network errors` | stubbed `fetch` per case → the page's texts | wrong mapping |
| `apply success navigates to /` | `location.assign('/')` | no reload after restore |
| `browser back from /settings shows the board` | `popstate` | stuck on settings |
`e2e/settings-route.spec.ts` (real server, fictional admin): `open Settings, invite a login, see it listed as Invited, revoke it`; `backup download returns an archive` (assert response status 200 and a non-empty body via `page.waitForEvent('download')`).

## Edge cases (each needs a test)
Covered above: editor, refusal, every restore status, network error, back navigation.

## Human checks
On the Mac Studio after deploy: download a backup from Settings and restore it into a fresh volume (part of the T-063 drill).

## Out of scope
Changing the settings page itself (T-046); server changes.
