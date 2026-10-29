# T-094: Phone person, move and fill sheets on the live board

**Milestone:** 5 — Phone
**Depends on:** T-092 (phone layout at `/`), T-049 (phone person and move sheets), T-044/T-077 (drop rules and dialogs in the app). All done.
- Runs in parallel with T-097 (import in Settings) and T-100 (portraits on cards). Neither of them edits any file listed under May change here. This task must not edit `apps/web/src/design/**`, `features/group-view/**`, `features/org-view/**`, `features/aaronic/**`, `features/dugout/**`, `features/presentation/**`, `features/ward-overview/**`, `features/import/**`, `features/settings/**` or `shell/SettingsRoute.tsx`.
- T-095 and T-096 also edit `shell/PhoneApp.tsx` and run after this task. T-101 (phone profile sheet and add position) also follows it.

**Spec refs:** SPEC.md §10 (phones: person and move actions use bottom sheets; tap-to-move replaces drag; phone edits appear on the TV and other clients in real time; every edit is one server operation, and a refused one is shown, not dropped). §3 (Current is read-only; accepted proposals are read-only). §5 (moving or releasing leaves a vacancy; sending to the dugout releases the calling; assigning clears explicit dugout inclusion; list vacancies). §6 (second-calling notice counts outside callings; needs-approval placements require the approval confirmation; affinities show `Matches {tag}` and never rank or reject). Artboards `docs/design/ui-canvas/PhonePerson.dc.html`, `Mobile.dc.html`, `PhoneOrg.dc.html` ("tap a person for options · tap a vacancy to fill it"), `Approval.dc.html`, `Confirm.dc.html`.

## Goal
On the phone Board tab at `/`, tapping a person opens the T-049 person sheet for the open board. On a Draft proposal, its Move…, Release, Add to dugout and Assign calling… actions, the move sheet's destinations and Send to dugout, and a new fill sheet opened by tapping a vacancy all send real operations through sync, with the same second-calling and approval confirmations the desktop asks for. Current and Accepted proposals show the sheet read-only. Other clients see each change without reloading.

## Design decisions (binding)

### Where the wiring lives
- New `apps/web/src/shell/PhoneEditing.tsx` exports `PhoneBoardEditing`, which renders `PhoneBoard` plus the sheets and dialogs. Props: `board`, `baseline`, `ward`, `proposal` (the sync `ProposalView | null`), `me`, `boardName` (`'Current'` or the proposal name). It reads `send` from `useSync()`.
- `PhoneApp.tsx` renders `<PhoneBoardEditing key={…same key as today…} …/>` in place of `<PhoneBoard …/>` and deletes `noop`. No other change to `PhoneApp.tsx`.
- **Editable** = `proposal !== null && proposal.status === 'draft' && me !== null && baseline !== null`. Pass it to `PhoneBoard`'s `editable` and to the sheets.
- Build the core `Proposal` that `preflight` needs inside `PhoneEditing.tsx` (same shape as the private `coreProposal` in `EditingLayer.tsx`; do not edit or export from `EditingLayer.tsx`). Reuse, without modifying: `preflight`, `runDropOp`, `dropContext` from `features/dnd/resolve.ts`; `SecondCallingDialog`, `ApprovalDialog` from `features/dnd/dialogs.tsx`; label helpers from `features/dnd/labels.ts`; `committedListPosition` from `shell/EditingLayer.tsx`; `buildPersonSheetModel`, `buildVacantDestinations` from `features/phone-person/model.ts`.

### Sheet flow
State is one of: none, person sheet (memberId), move sheet (memberId, fromPositionId or null), fill sheet (positionId), a confirmation dialog for a pending operation.
- `PhoneBoard` `onOpenPerson(memberId)` → person sheet. Its model is rebuilt from the latest synced `board`/`ward` on every render (so an `addToDugout` broadcast flips the sheet to `In dugout`). If `buildPersonSheetModel` returns null, the sheet closes.
- Person sheet: `Move…` → move sheet with that `fromPositionId`, query reset to `''`. `Assign calling…` (`onPlaceFromDugout`; only passed when editable) → move sheet with `fromPositionId: null`. `Release` → sends `releaseCalling { memberId, positionId }`. `Add to dugout` → sends `addToDugout { memberId }` and keeps the sheet open. `onOpenProfile` is not passed (T-101); see the PhonePersonSheet change below.
- Move sheet: destinations are `buildVacantDestinations(board, ward, memberId, query)`. A `single` destination makes `placeInPosition { memberId, from, to: positionId }`; a `list` destination makes `addToList { memberId, from, assignmentId }`. `Send to dugout` (only when `fromPositionId !== null`) sends `moveToDugout { memberId, from }`. `sourceCalling` is built as in the T-049 preview.
- `PhoneBoard` `onOpenVacancy(positionId)` (only reachable when editable) → fill sheet (below). Choosing a person makes `placeInPosition { memberId, from: null, to: positionId }` for a single assignment, or `addToList { memberId, from: null, assignmentId }` for a list.
- **Confirmations**, for every `placeInPosition`/`addToList` from the move or fill sheet, in the same order and with the same props DndSurface uses: run `runDropOp(board, dropContext(board, ward), op)`; if core refuses, show the failure alert with core's message and send nothing. Otherwise `preflight(coreProposal, board, ward, op)`: a non-null `secondCalling` shows `SecondCallingDialog`; then non-empty `approvals` show `ApprovalDialog` (`recordedAs` = `me.displayName`, `proposalName` = the proposal name). Cancel on either dialog sends nothing and returns to the sheet that made the operation. Confirming the last dialog (or no dialog) sends the operation, then one `approvePlacement` per approval. For an `addToList`, an approval's `positionId` is the one `committedListPosition(before, committed, assignmentId, memberId)` finds once the synced board reaches the version the `addToList` returned (B-031); if none is found, show the failure alert `the new position for this approval wasn't found on the saved board` and send no approval.
- Release, Add to dugout and Send to dugout send directly (no dialog), as on desktop.
- **Sending:** operations go one at a time with `send(kind, request)`. While a send is in flight, every action in the open sheet and dialog is disabled, so a double tap sends once. A successful operation closes the sheet (except Add to dugout) and shows a `role="status"` line above the board: `Moved {name}`, `Placed {name}`, `Released {name}`, `Added {name} to dugout`, `Sent {name} to dugout`. A refused one keeps the sheet open and shows `role="alert"` `Couldn't apply the change: {message}` with a `Dismiss` button; an `offline` refusal shows no alert (the sync banner says it).
- Switching boards closes any sheet or dialog and clears the status/alert.

### Fill sheet (`apps/web/src/features/phone-person/PhoneFillSheet.tsx`, new)
Visually the same bottom sheet as `PhoneMoveSheet` (reuse its CSS classes where they fit).
```ts
export interface PhoneFillCandidateRow {
  readonly memberId: string;
  readonly name: string;
  readonly detail: string;              // 'No calling' or the titles they hold, joined with ', '
  readonly matchedTagNames: readonly string[];
}
export function buildFillCandidates(board: Board, ward: Ward, positionId: string, query?: string): readonly PhoneFillCandidateRow[];
```
`buildFillCandidates` (add it to `features/phone-person/model.ts`) lists `dugout(board, ward)` members in core order, excluding removed members, with `preferenceMatches` for the position's assignment mapped to tag names. A list assignment excludes members already in that list. A non-blank `query` keeps rows whose name or matched tag names contain it, case-insensitively, without reordering. An unknown `positionId` returns `[]`.
- Dialog `role="dialog"` named `Fill {assignment title}`; subtitle the org label (as the move sheet builds it); a search input `aria-label="Find a person"`; section label `Dugout`; one `<button>` per row (≥ 44px) named `{name}, {detail}` plus `, Matches {tags}` when there are matches, with a visible `Matches {tags}` badge; `No one in the dugout.` when the dugout is empty; `No matching people.` when the filter removes every row; `Cancel`; Escape and the scrim cancel.

### Small changes to existing components
- `PhonePersonSheet.tsx`: `onOpenProfile` becomes optional; the `Profile, note & photo` button renders only when it is passed. No other change.
- `PhoneBoard.tsx`: `onAddPosition` becomes optional; the `Add position` control renders only when it is passed (so no dead button until T-101). No other change.
- `features/dnd/dnd.css`: only if the second-calling or approval dialog overflows or clips at 390px, add rules inside a `@media (max-width: 640px)` block. Nothing else in `features/dnd/`.

## Scope
May change:
- `apps/web/src/shell/PhoneApp.tsx` (as above only)
- `apps/web/src/shell/PhoneEditing.tsx`, `apps/web/src/shell/phone-editing.css`, `apps/web/src/shell/phone-editing.test.tsx` (new)
- `apps/web/src/features/phone-person/PhoneFillSheet.tsx` (new), `model.ts` (add `buildFillCandidates` and its row type only), `phone-person.css` (fill sheet styles only), `PhonePersonSheet.tsx` (optional `onOpenProfile` only), `fill-sheet.test.tsx` (new)
- `apps/web/src/features/phone-board/PhoneBoard.tsx` (optional `onAddPosition` only), `apps/web/src/features/phone-board/optional-add.test.tsx` (new)
- `apps/web/src/features/dnd/dnd.css` (narrow-width block only, if needed)
- `apps/web/e2e/phone-editing.spec.ts`, `apps/web/e2e/gui/phone-editing.capture.ts` (new)

Must not change:
- every existing test file (unit, e2e and capture), `App.tsx`, `BoardShell.tsx`, `EditingLayer.tsx`, any other file in `features/dnd/`, `apps/web/src/sync/**`, `apps/web/src/design/**`, `apps/server/**`, `packages/**`, `scripts/**`, `playwright.config.ts`, `package.json`, `docs/gui-verification.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/phone-editing.test.tsx src/shell/phone-app.test.tsx src/features/phone-person src/features/phone-board src/features/dnd` | every new test below passes; every existing test in those paths passes unmodified |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/phone-editing.spec.ts` | passes on phone-chromium and phone-webkit; desktop-chromium and tv-chromium skip with the reason `Phone sheets apply to the phone projects` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-editing/` has `person-sheet`, `move-sheet`, `fill-sheet`, `second-calling`, `read-only-sheet` PNGs for both `phone-chromium` and `phone-webkit` (e.g. `move-sheet-phone-webkit.png`) |
| 4 | Mutation | in a disposable worktree at the candidate, make `PhoneEditing` send the placement without calling `preflight`, then run check 1 | `a move that adds a second calling asks first` and `a needs-approval move sends the approval after the placement` fail; remove the worktree |
| 5 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`phone-editing.test.tsx` mounts `PhoneApp` (or `PhoneBoardEditing` inside `SyncProvider`) with the fake `WebSocketLike` + `SyncClient` pattern in `phone-app.test.tsx` (copy the helpers; do not import from or edit that file), on fixture data from `buildPreviewData()`. Assert on the operation frames the fake socket receives and on what the user sees.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tapping a person opens the person sheet for the open board` | on a Draft, tapping a member row shows dialog `{name}` with `Callings in {proposal name}`, `Move from …` and `Release from …` | `onOpenPerson` still a no-op |
| `Current shows the person sheet read-only` | on Current: dialog shows callings, `Callings in Current`, and no `Move…`, `Release`, `Add to dugout`, or `Profile, note & photo` button; no `Add position` control on the board | editable on Current |
| `an accepted proposal shows the sheet read-only` | same as above for an Accepted proposal | editable when `status === 'accepted'` |
| `move to a vacant single position sends placeInPosition` | Move… then a single destination sends exactly one `placeInPosition { memberId, from, to }`; after the ack and broadcast the sheet closes and `Moved {name}` shows | wrong `from`; list op for a single |
| `move to a list destination sends addToList` | a list destination sends `addToList { memberId, from, assignmentId }` | positionId instead of assignmentId |
| `Release sends releaseCalling` | sends `releaseCalling { memberId, positionId }` and shows `Released {name}` | sending `moveToDugout` |
| `Add to dugout keeps the sheet open and flips to In dugout` | sends `addToDugout { memberId }`; after the broadcast board includes the member, the open sheet shows `In dugout` | stale model; closing the sheet |
| `Send to dugout sends moveToDugout` | from the move sheet, sends `moveToDugout { memberId, from }` | missing `from` |
| `Assign calling places a member without a calling` | for a member with no callings, `Assign calling…` opens `Move {name}` with the `Tap a vacant calling` subtitle, and a destination sends `placeInPosition` with `from: null` | `from` set to a stale id |
| `a move that adds a second calling asks first` | moving a member who keeps another calling shows the second-calling dialog and sends nothing until `Add second calling` (or `Add another calling`); then sends the op | skipping preflight |
| `cancelling the second-calling dialog sends nothing` | Cancel leaves zero op frames and returns to the move sheet | sending on cancel |
| `a needs-approval move sends the approval after the placement` | placing a `needsApproval` member shows the approval dialog; confirming sends the placement, then `approvePlacement { memberId, positionId }` after its ack | approval before placement; no approval |
| `a list approval names the position the server filled` | for `addToList` of a needs-approval member, the `approvePlacement` positionId is the one the broadcast board gives that member, not a guessed id | approving the preflight id |
| `a refused operation shows the reason and keeps the sheet` | an op reply `{ ok: false, code: 'conflict', message: 'stale board' }` shows alert `Couldn't apply the change: stale board`; Dismiss clears it | swallowing refusals |
| `an offline refusal shows no alert` | a refusal with code `offline` shows no alert | alerting on offline |
| `a second tap while sending sends once` | two quick taps on a destination produce one op frame | no in-flight guard |
| `tapping a vacancy opens the fill sheet and places a dugout member` | dialog `Fill {title}` lists dugout members; choosing one sends `placeInPosition { memberId, from: null, to }` and shows `Placed {name}` | wrong target; `from` not null |
| `switching boards closes an open sheet` | with a sheet open, selecting another board in the switcher closes it | sheet shows the old board |

`fill-sheet.test.tsx`:

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `buildFillCandidates lists the dugout in core order with matches` | rows follow `dugout(board, ward)` order; `detail` is `No calling` or the held titles; a member whose tag the assignment prefers has `matchedTagNames` | sorting by match; wrong detail |
| `buildFillCandidates skips list members already in the list` | a member already in the list assignment is absent | duplicate placement offered |
| `buildFillCandidates filters by name or matched tag, case-insensitively` | query by part of a name and by a tag name; blank query returns all | case-sensitive; tags ignored |
| `buildFillCandidates returns nothing for an unknown position` | `[]` | throwing |
| `fill sheet shows empty and no-match states` | `No one in the dugout.` and `No matching people.` | blank sheet |
| `fill sheet calls back with the chosen member and cancels on Escape` | tapping a row calls `onSelect(memberId)`; Escape and Cancel call `onCancel` | wrong id |
| `person sheet hides Profile without onOpenProfile` | no `Profile, note & photo` button when the prop is absent; present when passed | always rendered |

`optional-add.test.tsx`: `organization screen hides Add position without onAddPosition` — editable organization screen with no `onAddPosition` shows no `Add position` control; passing it shows the control (existing behavior).

## Edge cases (each needs a test)
Covered above: Current and Accepted read-only, member with no callings, member already in a list, empty dugout, no filter matches, unknown position, second-calling cancel, needs approval on single and list, core refusal, server refusal, offline refusal, double tap, board switch with a sheet open.

## e2e (`apps/web/e2e/phone-editing.spec.ts`)
Phone projects only. Each test creates its own proposal through the switcher with `uniqueProposalName` (as `phone-app.spec.ts` does) and edits only that one. Read the fixture ward first and name the members and positions you use in a comment.
1. On Current, open an organization, tap a member: the sheet shows no Move… button. Close it.
2. On the new Draft, tap a member with a calling → Move… → type part of a vacant calling's title → tap it. The sheet closes, `Moved {name}` shows, and the organization screen lists them in the new calling with the old one vacant.
3. Tap a vacancy → `Fill …` → choose a dugout member → the row shows that member.
4. Release a calling → the row shows vacant.
5. A move that triggers the second-calling dialog shows it within the 390px width (no horizontal overflow) and completes after confirming.
6. `phone-chromium` only: a desktop context at `/?layout=desktop` on the same proposal sees the step-2 move without reloading.
Use real taps/clicks and typing; assert no horizontal overflow with every sheet open.

## GUI verification
Required (`docs/gui-verification.md`), at `/` on phone-chromium and phone-webkit: person sheet on a Draft, move sheet with a `Matches …` badge if the fixture has one, fill sheet, second-calling dialog, read-only sheet on Current. Look at each and compare with `PhonePerson.dc.html` and `Mobile.dc.html`, and the dialogs with `Confirm.dc.html`/`Approval.dc.html`. Fail on: horizontal scroll, a sheet or dialog clipped behind the bottom nav or the home indicator, a control under 44px, a dead button, or dialog text cut off.

## Human checks
- iPhone Safari at `/`: on a Draft, tap a member, Move…, filter and tap a vacant calling; tap a vacancy and fill it from the dugout; confirm a second-calling dialog. Confirm the sheets and dialogs feel natural one-handed and the TV/desktop on the same proposal updates as you go.

## Out of scope
- `Profile, note & photo`, notes, tags and photos on the phone, and Add position on the phone (T-101).
- Swapping or releasing an occupant on the phone (move destinations are vacant only, as in T-049).
- Search, Dugout and Changes tabs (T-095, T-096).
- Any change to desktop editing, the sync client or the server.
