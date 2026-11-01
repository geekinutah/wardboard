# T-095: Phone search and dugout tabs

**Milestone:** 5 — Phone
**Depends on:** T-092 (phone layout at `/`), T-050 (`PhoneSearch` and `PhoneDugout`), T-094 (phone person, move, and fill sheets), T-101 (profile and add position on `PhoneBoardEditing`). All done.
- T-096 also edits the phone shell. Do not start it here. The Changes tab stays the placeholder this task already shows.

**Spec refs:** SPEC.md §3 (Add to dugout keeps callings and shows no warning), §5 (dugout membership and placing from it), §10 (phone bottom navigation and sheets; search finds people, callings, tags, and groups, scoped to the active board unless All is chosen; a tag filters rather than navigating). Artboards `docs/design/ui-canvas/PhoneSearch.dc.html` and `docs/design/ui-canvas/PhoneDugout.dc.html`. The components from T-050 already match those artboards. This task mounts them in the live app.

## Goal
On the live phone app at `/`, Search and Dugout replace their placeholders. A person result and a dugout Place open the existing person sheet over that tab. `+ Dugout` sends `addToDugout`. A calling or group result opens that organization on the Board tab. The Changes tab stays the placeholder.

## Design decisions (binding)

### What is already built
Do not rewrite `PhoneSearch`, `PhoneDugout`, `PhonePersonSheet`, or `PhoneBoard`. Use them as they are.

- `PhoneSearch` (`apps/web/src/features/phone-search/PhoneSearch.tsx`) takes `ward`, `activeBoard`, `allBoards` (active board first), `editable`, optional `initialQuery`, `onSelectResult`, and `onAddToDugout`. The field is `aria-label="Search"`. Empty query and no filters show `Type a name, calling, or tag, or choose a filter.` Scope chips are `This proposal` or `Current`, plus `All`. Person rows call `onSelectResult({ kind: 'person', memberId })`. `+ Dugout` (`aria-label` `Add ${name} to dugout`) calls `onAddToDugout` and does not select the person. Tag rows already toggle the `Tag: {name}` chip and also emit `{ kind: 'tag' }`.
- `PhoneDugout` takes `board`, `ward`, `editable`, and `onPlaceMember`. The subtitle is `No calling in this proposal, or placed here on purpose. Not a measure of availability.` Place is `aria-label` `Place ${name}` when `editable` is true, and is absent when it is false.
- `PhoneBoard` already accepts `initialScreen?: PhoneBoardScreen`, default `{ kind: 'list' }`, stored with `useState(initialScreen)`. An organization screen's `h1` is the board-group name (`Primary`, not `Primary Presidency`).
- `PhoneBoardEditing` in `apps/web/src/shell/PhoneEditing.tsx` already owns the person, move, fill, profile, and add-position sheets. Editable is `proposal !== null && proposal.status === 'draft' && me !== null && baseline !== null`. `onPlaceFromDugout` opens the move sheet with `fromPositionId: null` and shows `Assign calling…` when the member has no calling. Do not copy that stack into `PhoneApp`.

### Search and Dugout replace the placeholder
In `PhoneApp`, when `activeTab` is `search` or `dugout` and `board` and `ward` are both non-null, render the matching component. When either is null, render the existing `Loading board…` paragraph, not the placeholder. The Changes tab still renders `Placeholder` with `This screen isn't on phones yet.` and the link `Use desktop layout` to `/?layout=desktop`.

`editable` for both components is the same expression `PhoneBoardEditing` already uses. Read `send` and `fetchBoard` from `useSync()`. Do not add methods to `useSync()`, and do not edit `apps/web/src/sync/**`.

Keep `PhoneSearch` and `PhoneDugout` mounted while a person sheet is open over them, so closing the sheet returns to the same query, scope, and filters.

### All-scope boards
`allBoards[0]` is the subscribed `board` as soon as Search can render. The other entries are boards that `fetchBoard` has returned.

While the Search tab is selected, call `fetchBoard` once for every id in `boards.current.boardId` and `boards.proposals[].boardId` except the subscribed board id. Do not call it for the subscribed id. Do not start those calls on the Board, Dugout, or Changes tabs. A resolved board is included after the active board, ordered with Current first when it is not active, then proposals in the same tab order `PhoneApp` already uses. A `null` result is omitted. Show no alert and no rejection message. Search still works before those replies, searching only the active board.

Request each other id at most once per visit to Search. Leaving Search may ignore a late reply; that reply must not change the Board tab or open a sheet. Re-entering Search may request again. `fetchBoard` caches baseline boards and does not cache proposal or current boards (`apps/web/src/sync/client.ts`). Do not loop: applying a resolved proposal board must not send another `getBoard` for the same id during that visit. A StrictMode double effect may send two frames in the real app; the unit tests render `PhoneApp` without StrictMode and expect one frame per other id.

### Person sheet over the current tab
Add these optional props to `PhoneBoardEditing`. When they are omitted, the Board tab stays as it is today, including every existing `phone-editing.test.tsx` assertion.

```ts
readonly focusMemberId?: string;
readonly sheetOnly?: boolean;
readonly initialScreen?: PhoneBoardScreen;
readonly onSheetClose?: () => void;
```

- Pass `initialScreen` through to `PhoneBoard`. Omitted means `PhoneBoard`'s default list.
- When `sheetOnly` is true, do not render `PhoneBoard`. Start on the person sheet for `focusMemberId`. If that member has no person model, call `onSheetClose` and render no organization list.
- The existing sheets still work from that person sheet: Move, Release, Add to dugout, Profile when `me !== null`, and `Assign calling…` when editable and the member has no calling. Choosing a destination still goes through the existing confirmations. Do not send a placement when the sheet opens.
- Closing the person sheet (Close, Escape, or the scrim, and not merely closing Profile) calls `onSheetClose` once. Do not call it on the first render.
- `sheetOnly` does not render the organization list after close. `PhoneApp` unmounts this host when the sheet closes.

`PhoneApp` holds the open member id. Search `{ kind: 'person' }` and Dugout `onPlaceMember` set it and render one `sheetOnly` `PhoneBoardEditing` over the current tab, with the same `board`, `baseline`, `ward`, `proposal`, `me`, and `boardName` the Board tab uses. The sheet describes callings in the active board (`Callings in Current` or the proposal name). It does not switch boards. A missing ward member opens nothing and sends nothing.

The shell's own tab callback, and `onSelectBoard`, clear the open member and any pending organization. Search-driven navigation sets the organization itself and does not clear it in that same update.

### Add to dugout
`onAddToDugout` calls `send('addToDugout', { memberId })` only when editable, one operation frame per click, and does not open the person sheet. When not editable, send nothing. This is the same operation desktop search sends from `EditingLayer`. A refusal uses the existing sync notice. Do not add a second alert.

### Calling and group results
`{ kind: 'calling' }` uses `target.boardGroupId`. `{ kind: 'group', groupKind: 'boardGroup' }` uses `target.id`. `{ kind: 'group', groupKind: 'callingGroup' }` walks that board's `callingGroups` parents until `parent.kind === 'boardGroup'`. If the group is missing, the chain cycles, or the board is not the active board and is not in the fetched set, stay on Search and send nothing.

Otherwise remember `{ boardId, boardGroupId }`, clear the person sheet, and select the Board tab. If `boardId` is not the subscribed id, call `open(boardId)` first. `open` clears `board` until the snapshot; the Board tab shows `Loading board…`, then mounts `PhoneBoardEditing` with `initialScreen` `{ kind: 'organization', boardGroupId }`. Include that id in the existing `PhoneBoardEditing` key so the initial state is applied. The shell tab callback and `onSelectBoard` drop this pending organization, so the next visit to Board starts at the list. A tag result stays on Search. `PhoneSearch` already toggles the tag chip; do nothing else with `{ kind: 'tag' }`.

### Allowed edits to existing tests and captures
`apps/web/src/shell/phone-app.test.tsx` may change only the test `placeholder tabs link to the desktop layout`, plus new tests:

- Changes still shows `This screen isn't on phones yet.` and the link `Use desktop layout` to `/?layout=desktop`.
- Search shows the search field `aria-label="Search"` and the helper sentence, and does not show the placeholder sentence or that link.
- Dugout shows `No calling in this proposal, or placed here on purpose. Not a measure of availability.` and does not show the placeholder sentence or that link.

`apps/web/e2e/gui/phone-app.capture.ts` may change only the placeholder shot. Take it on the Changes tab (`Changes`, exact), still expect `Use desktop layout` at least 44px tall, still write `placeholder`, and still check no horizontal overflow. Do not click Search for that shot. Leave the board, switcher, proposal, and desktop shots as they are.

`apps/web/src/shell/phone-editing.test.tsx` may add tests and must not change existing assertions.

Do not edit any other existing test, spec, or capture. If another existing test fails, stop and report BLOCKED. In particular, leave `apps/web/e2e/phone-app.spec.ts` alone, including its wait for `/^Primary,/` before reading the dugout count. Leave `e2e/phone-search-dugout.spec.ts` and the `/__preview/phone-search` and `/__preview/phone-dugout` routes alone.

New e2e proposal names must not contain `current` in any case. `apps/web/e2e/start-proposal.spec.ts` matches the Current radio as a case-insensitive substring (B-074). Do not edit that spec, and do not rename an existing proposal to dodge it.

## Scope
May change:
- `apps/web/src/shell/PhoneApp.tsx`
- `apps/web/src/shell/phone-app.css` (only a rule the live Search or Dugout tab needs to sit in the shell)
- `apps/web/src/shell/phone-app.test.tsx` (the one assertion update above, and new tests)
- `apps/web/src/shell/PhoneEditing.tsx` (the optional props only)
- `apps/web/src/shell/phone-editing.css` (only a sheet-only host rule; the Board tab layout stays as it is)
- `apps/web/src/shell/phone-editing.test.tsx` (new tests only)
- `apps/web/e2e/phone-search-live.spec.ts` (new)
- `apps/web/e2e/gui/phone-search-live.capture.ts` (new)
- `apps/web/e2e/gui/phone-app.capture.ts` (the placeholder shot moves to Changes)

Must not change:
- `apps/web/src/features/phone-search/**`, `apps/web/src/features/phone-dugout/**`, `PhoneBoard.tsx`, `PhonePersonSheet.tsx`, `PhoneProfileSheet.tsx`, `PhoneAddPositionSheet.tsx`, `apps/web/src/sync/**`, `apps/server/**`, `packages/**`, `docs/**`, `playwright.config.ts`, `e2e/phone-app.spec.ts`, `e2e/phone-search-dugout.spec.ts`, `e2e/start-proposal.spec.ts`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/phone-app.test.tsx src/shell/phone-editing.test.tsx src/features/phone-search src/features/phone-dugout src/features/phone-board/PhoneBoard.test.tsx src/features/phone-person` | every new test below passes; existing tests in those paths pass, with only the one `phone-app.test.tsx` assertion update named above |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/phone-search-live.spec.ts` | passes on phone-chromium and phone-webkit; desktop-chromium and tv-chromium skip with the reason `Phone search and dugout apply to the phone projects` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-search-live/` has `search-results`, `search-person`, and `dugout-list` PNGs for both `phone-chromium` and `phone-webkit`; `apps/web/gui-artifacts/phone-app/` still has `placeholder-phone-chromium.png` and `placeholder-phone-webkit.png` |
| 4 | Red before green | run the new Search assertion in `phone-app.test.tsx` before `PhoneApp` renders `PhoneSearch` | it fails because the search field is absent (the placeholder is still there). Record that output. An import error is not the red result |
| 5 | Mutation | in a disposable worktree at the candidate, make `sheetOnly` still render `PhoneBoard`, then run the `phone-editing.test.tsx` file | `sheetOnly opens the person sheet and hides the organization list` fails; remove the worktree |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

The shell starts in the shared checkout. `cd` to this task's worktree first. Run at most one of `./scripts/verify.sh`, `pnpm --filter web run test:e2e`, and `gui:capture` in that worktree at a time. Playwright outside pnpm needs `PATH="$PWD/node_modules/.bin:$PATH"`, or run `./node_modules/.bin/playwright` from `apps/web`.

Open the new phone screenshots and compare them with `PhoneSearch.dc.html` and `PhoneDugout.dc.html`. Overlap, clipping, horizontal scroll at 390px, a pressed chip shown by color alone, or a touch target under 44px fails this task.

## Unit tests to write
`phone-editing.test.tsx` renders `PhoneBoardEditing` the way the signed-out test already does. Use the fixture members named in that file.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `sheetOnly opens the person sheet and hides the organization list` | `sheetOnly` and Bea's id show the dialog `/^Bea Placeholder/` and do not show `/^Primary,/`. Close calls `onSheetClose` once and still does not show the list | rendering `PhoneBoard` underneath the sheet, or never calling `onSheetClose` |
| `initialScreen opens the organization without a list click` | `initialScreen` `{ kind: 'organization', boardGroupId }` for Primary shows the `h1` `Primary` and does not show `/^Primary,/`. The same render without `initialScreen` shows `/^Primary,/` | ignoring `initialScreen`, or opening the list anyway |

`phone-app.test.tsx` uses the existing fake-socket harness. Sign in with `receiveMe` before expecting an edit control. Open the draft with the existing snapshot helpers before expecting `+ Dugout` or Place. Operation frames are `{ type: 'op', op: { kind, request } }`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `search before the snapshot says Loading board` | Search before `snapshot` shows `Loading board…` and not the placeholder sentence. After the Current snapshot, the search field and the helper sentence are visible | leaving the placeholder up, or crashing without a board |
| `a person result opens the person sheet over Search` | on the draft, query `Bea`, click the row whose name starts with `Bea Placeholder` (not `Add Bea Placeholder to dugout`). The dialog is visible, the search field is still in the document, and no `op` frame was sent. Close removes the dialog and leaves the field | switching to the Board tab, or sending an operation for a tap |
| `Current person sheet is read-only` | on Current, Bea's sheet has no Move button. Its heading section reads `Callings in Current` | treating Current as editable |
| `+ Dugout sends addToDugout and does not open the sheet` | on the draft, `Add Bea Placeholder to dugout` sends one `{ kind: 'addToDugout', request: { memberId } }` and no person dialog. A second click sends a second frame. On Current that button is absent | opening the sheet, or dropping the operation |
| `a calling result opens that organization` | query `Primary Teacher`, click the button whose name starts with `Primary Teacher`. The Board tab shows the `h1` `Primary`, and the search field is gone | staying on Search, or opening the person sheet |
| `a calling group result opens its organization` | query `Nursery`, click the button whose name starts with `Nursery` and contains `Group ·`. The `h1` is `Primary` and a Nursery section is visible | using the calling-group id as a board-group id, which shows `Organization not found` |
| `a tag result stays on Search` | query `Musical`, click the tag row. The search field remains, a pressed chip names `Tag: Musical`, and no person dialog is open | navigating to the Board tab |
| `All scope uses a fetched proposal and a rejected board adds no alert` | on Current, with the Spring adjustments proposal and another proposal listed, opening Search sends one `getBoard` for each of those ids and none for the Current id. Reply `board` for the Spring board and `rejected` for the other. No alert contains the rejection message. Before the Spring reply, All has no Vacant `Second Counselor`. After it, clicking the Vacant `Second Counselor` row subscribes to the proposal board; after that snapshot, the `h1` is `Primary`. Delivering the reply does not send another `getBoard` | searching only the active board forever, alerting on `rejected`, or requesting the subscribed id |
| `Place opens the person sheet and sends nothing` | on the draft, Dugout, `Place Jay Storybook` shows `Assign calling…` and no `op` frame. Close returns to that Place button | sending a placement on open |
| `switching tabs closes the sheet` | open Bea's sheet from Search, then press Board. The dialog is gone and `/^Primary,/` is visible | leaving the sheet mounted on the Board tab |
| `an accepted proposal has no Place or Add to dugout` | Place and `Add Bea Placeholder to dugout` are absent | using status other than `draft` as editable |

## Edge cases (each needs a test)
- Search or Dugout before the snapshot shows `Loading board…`.
- Empty Search shows the helper sentence.
- Current and Accepted are read-only: no `+ Dugout`, no Place, and no Move on the person sheet.
- A rejected `getBoard` is omitted and does not alert. The subscribed id is not requested.
- A calling group opens the parent organization, not `Organization not found`.
- Place and a person tap send no operation until an existing sheet action does.
- Changing tabs closes the sheet. Changes keeps the placeholder.

## Human checks
On an iPhone at `/`, open Search and Dugout. Filter with a chip, scroll the list, and tap a person and a Place control with one hand. The sheet should sit over that tab and be readable. Changes should still offer the desktop layout. This check is pending. Do not claim it was performed.

## Out of scope
- The Changes tab, Accept, and `features/phone-changes` (T-096).
- Rewriting search, dugout, the person sheet, or the organization screen.
- Desktop search, the canvas, and `EditingLayer.tsx`.
- New server operations or a second dugout command.
- `docs/**`, including STATUS.md.
