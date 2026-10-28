# T-079: Read-only Current bar and Start proposal in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-041, T-075 (`createProposal`).

**Spec refs:** SPEC.md §3 Current ("read-only ... Display the import date prominently. A **Start proposal** button — never a drag action — creates a proposal from Current or duplicates an existing proposal, with a name and optional rationale"), §10 (tabs are shared proposals; tab selection is local). Artboard 15 (`StartProposal.dc.html`).

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
On Current, the app shows `CurrentReadOnlyBar` with its import date and **Start proposal**. Start proposal is also offered from the header tab strip on every board. `StartProposalDialog` creates the proposal on the server and switches this user's view to the new tab.

## Design decisions (binding)
- New `apps/web/src/shell/StartProposal.tsx`. It renders `<CurrentReadOnlyBar importedAt onStartProposal>` above the canvas when the active board is Current, plus a `+ Start proposal` button (≥44px) at the end of the header tab strip on every board. The tab strip's existing tabs and roles are unchanged.
- The dialog gets:
  - `importedAt`: Current's `importedAt`.
  - `proposals`: `boards.proposals` mapped to `{ id, name, status, tabOrder }`.
  - `initialSource`: `{ kind: 'proposal', proposalId }` when opened from a proposal tab, else Current.
  - `onCreate`: calls `client.createProposal(...)`; maps failure to `{ ok: false, message }`. On success, selects `boardId` (`open(boardId)`) once it appears in `boards`, then closes.
- Opening the dialog never changes other users' views (selection is local).

## Scope
May change: `apps/web/src/shell/BoardShell.tsx`, `apps/web/src/shell/StartProposal.tsx` (new), `apps/web/src/shell/start-proposal.test.tsx` (new), `apps/web/e2e/start-proposal.spec.ts`, `apps/web/e2e/gui/start-proposal.capture.ts` (new), `apps/web/src/sync/react.tsx` (only the `useSyncClient` addition above).
Must not change: features, sync (except the `useSyncClient` addition), server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/start-proposal.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `start-proposal.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/start-proposal/`: Current with the bar, dialog open, new tab selected; compared with artboard 15 |
| 4 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Current shows the read-only bar with its import date; proposals don't` | | bar on proposals |
| `Start proposal from Current sends createProposal with source current` | exact frame | wrong source |
| `opening from a proposal tab preselects duplicating that proposal` | `initialSource` | always Current |
| `success switches to the new tab once it appears` | `subscribe` for the new `boardId` after the `boards` push | switches before the tab exists; never switches |
| `failure shows the server message and keeps the dialog` | | dialog closes on error |
`e2e/start-proposal.spec.ts` (real server): `start a proposal from Current and land on its tab`.

## Edge cases (each needs a test)
Covered above: success, failure, from Current, duplicate, new tab arriving late (add a test where `proposalCreated` precedes the `boards` push).

## Human checks
none

## Out of scope
Renaming, reordering or deleting proposals; Accept (T-043/T-051).
