# T-078: Person inspector and notes in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-037, T-075, T-077 (T-077 for the dugout panel layout and `send` wiring; T-075 for `updateMember`).

**Spec refs:** SPEC.md §6 (notes never displayed by default; double-clicking a member card opens notes), §7 (notes are shared ward-wide), §12 ("Double-clicking a member card opens notes; notes are otherwise never displayed, including on the TV"), §3 (Add to dugout). Artboard 2 (the inspector).

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
Single-clicking a member card on the real board opens `PersonInspector` for that member. Double-clicking a member card, or **Open notes** in the inspector, opens `NotesDialog`, which saves through `updateMember`. Add to dugout in the inspector sends `addToDugout`.

## Design decisions (binding)
- New `apps/web/src/shell/PersonPanel.tsx`. When the canvas selection (`onSelect`) or a click inside the dugout panel identifies an element with `data-member-id`, show `<PersonInspector board ward memberId readOnly …>` in a right-side panel. It sits above the dugout panel at ≥1024px and below the canvas under that width. Selecting empty canvas, pressing Escape, or a `Close` button (≥44px) clears it.
- `Canvas`'s existing `onOpenNotes` prop (today `() => undefined` in `BoardShell`), the inspector's `onOpenNotes`, and a double-click on a dugout row all open `<NotesDialog member …>`. `onSave` calls `client.updateMember(id, { note })` and maps `{ ok: false, code, message }` to `{ ok: false, message }`. A successful save resolves after the server reply; the shared ward update arrives through the existing `ward` push.
- Inspector `onAddToDugout` → `send('addToDugout', { memberId })`.
- Notes never render outside the dialog. The panel must not read `member.note`.

## Scope
May change: `apps/web/src/shell/BoardShell.tsx`, `apps/web/src/shell/PersonPanel.tsx` (new), `apps/web/src/shell/person-panel.test.tsx` (new), `apps/web/e2e/person-panel.spec.ts`, `apps/web/e2e/gui/person-panel.capture.ts` (new), `apps/web/src/sync/react.tsx` (only the `useSyncClient` addition above).
Must not change: features (including `canvas` and `person`), sync (except the `useSyncClient` addition), server, packages, existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/web exec vitest run src/shell/person-panel.test.tsx` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0 incl. `person-panel.spec.ts` |
| 3 | GUI | `pnpm --filter web run gui:capture` | exits 0; `gui-artifacts/person-panel/` has inspector open and notes dialog open (desktop, phone ×2, TV), compared with artboard 2; no note text visible outside the dialog |
| 4 | No note reads in the shell | `grep -n "\.note\b" apps/web/src/shell/PersonPanel.tsx apps/web/src/shell/BoardShell.tsx` | no output |
| 5 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `clicking a member card opens the inspector for that member` | selection → `Person: {name}` aside | selection ignored |
| `double-click opens notes; save sends updateMember with the trimmed note` | one `updateMember` frame with `{ note: 'Prefers mornings' }`; the dialog closes after `memberUpdated` | wrong patch; closes before reply |
| `a refused save shows the server message and keeps the dialog` | `error` reply → `Could not save the note: …` | error swallowed |
| `inspector Add to dugout sends addToDugout; hidden on Current` | | edit offered on Current |
| `Escape and Close clear the inspector` | | panel stuck |
| `the note body never appears in the shell outside the dialog` | Jay Storybook's note not in `document.body.innerHTML` after selecting him | note leaked via the panel |
`e2e/person-panel.spec.ts` (real server): `save a note, reload, and see it only in the notes dialog`.

## Edge cases (each needs a test)
Covered above: refused save, Current, Escape, note never shown, member removed from the ward while selected (the panel shows the inspector's not-in-ward message; add a test).

## Human checks
none

## Out of scope
Tags and Needs approval editing (T-039); photos (T-060).
