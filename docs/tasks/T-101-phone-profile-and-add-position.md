# T-101: Phone profile sheet and add position

**Milestone:** 5 — Phone
**Depends on:** T-094 (phone person, move and fill sheets), T-093 (portrait upload), T-117 (gender rule on add position). All done.
- T-095 and T-096 also edit the phone shell and run after this task. Do not start them here.
- Runs beside T-099. T-099 edits only `docs/import/` and `scripts/import-guide.test.mjs`. This task must not edit those paths.

**Spec refs:** SPEC.md §6 and §7 (name, photo, youth/adult, and the brief note are shared member data; editing them updates the profile across Current and every proposal; notes are never shown on the TV). §5 and `docs/handbook-calling-gender.md` (a new calling's gender rule defaults from `classifyCallingGender` and may be overridden; `presidency_aligned` only for the Sunday School presidency titles). §10 (phone edits are bottom sheets and one server operation each; a refused operation is shown). Artboards `docs/design/ui-canvas/PhonePerson.dc.html` (the Profile link) and `AddPosition.dc.html` (title, type, count). On a phone the add-position form is a bottom sheet, not the desktop popover.

## Goal
On the phone Board tab, `Profile, note & photo` opens a profile sheet for that member on Current, on a Draft, and on an Accepted proposal: portrait or initials, the existing photo upload (including the replacement comparison), and a note saved with `updateMember`. On a Draft, Add position opens a sheet that sends `addAssignment` with the same title, type, count, and gender rule the desktop form sends. Current and Accepted still have no Move, Release, Add to dugout, vacancy fill, or Add position.

## Design decisions (binding)

### Where the wiring lives
Stay inside `PhoneBoardEditing` in `apps/web/src/shell/PhoneEditing.tsx`. Do not edit `PhoneApp.tsx`. Its `key` already remounts this component when the open board changes, which closes every sheet.

- **Profile** is available when `me !== null`, including Current (`proposal === null`) and Accepted. Pass `onOpenProfile` only then. When `me` is null, omit it, so the existing person sheet hides the button.
- **Add position** is available only when the board is already editable (`proposal.status === 'draft' && me !== null && baseline !== null`). Pass `onAddPosition` only then. `PhoneBoard` already hides the control when the callback is absent or the screen is not editable. Do not edit `PhoneBoard.tsx`.
- Read `send` from `useSync()` as today. Read the client for `updateMember` from `useSyncClient()`. Do not add methods to `useSync()`, and do not edit `apps/web/src/sync/**`.

### Profile sheet (`apps/web/src/features/phone-person/PhoneProfileSheet.tsx`, new)
A bottom sheet using the existing `wb-phone-sheet-scrim` and `wb-phone-sheet-dialog` classes. `role="dialog"` named `Profile · {name}`.

```ts
export interface PhoneProfileMember {
  readonly id: string;
  readonly name: string;
  readonly photoRef: string | null;
  readonly note: string | null;
  readonly category: 'adult' | 'youth';
}

export interface PhoneProfileSheetProps {
  readonly member: PhoneProfileMember;
  readonly currentUrl: string | null;
  readonly onSaveNote: (note: string | null) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly upload: (file: File) => Promise<{ photoRef: string }>;
  readonly assign: (memberId: string, photoRef: string) => Promise<void>;
  readonly onClose: () => void;
}
```

- Show the member's name and `Adult` or `Youth`. When `photoRef === null`, show initials from `initials(name)` on `avatarColor(name)` (`apps/web/src/design/person.ts`). Otherwise show `<img alt={name} src={currentUrl}>`. Do not show both.
- Render the existing `PhotoUpload` with this member, `currentUrl`, `upload`, and `assign`. Do not edit `PhotoUpload.tsx`, `upload.ts`, `assignPhoto.ts`, or `photos.css`. Its label is already `Upload photo for {name}`. A first photo uploads and assigns immediately. A replacement opens the existing comparison dialog and assigns only after `Use New Photo`. If that control overflows at 390px, add rules only under `.wb-phone-profile` in `phone-person.css`.
- Notes, matching `NotesDialog` without opening it (do not edit `NotesDialog.tsx`): the sentence `Notes are shared across Current and every proposal. They never appear on the TV or in search.`; a textarea named `Note`; the count `{n} / 280` using `MAX_NOTE_LENGTH`; `Notes can be at most 280 characters.` when over the limit. Save is disabled when pending, over the limit, or the trimmed value equals the trimmed existing note. Save sends the trimmed text, or `null` when the trim is empty. A second Save while the first is in flight does not call `onSaveNote` again. Success calls `onClose`. Failure shows `role="alert"` `Could not save the note: {message}` and stays open. Cancel, Escape, and the scrim call `onClose` without saving. Close is a button named `Close`, at least 44px.

`PhoneEditing` opens this sheet from the person sheet and keeps the person sheet underneath, so closing the profile returns to it. The member comes from `ward.members`. `currentUrl` is `photoUrl(photoRef)` or null. `upload` is `uploadPhoto`. `assign` is `assignPhoto(client, id, ref)` and throws `Error(result.message)` when `result.ok` is false, as `PersonPanel` does. `onSaveNote` calls `client.updateMember(id, { note })` and maps `{ ok: false, message }` the same way `PersonPanel` maps a refused note. While a note save is in flight, disable the sheet the same way other phone sends do. A successful save closes only the profile sheet. A photo upload does not close it. Switching boards closes it because the editor remounts.

### Add position sheet (`apps/web/src/features/phone-board/PhoneAddPositionSheet.tsx`, new)
A bottom sheet, same scrim and dialog classes. `role="dialog"` named `Add a position to {callingGroupName}`.

```ts
export interface PhoneAddPositionSheetProps {
  readonly callingGroupName: string;
  readonly organizationName: string;
  readonly groupId: string;
  readonly onSubmit: (request: AddAssignmentRequest) => void;
  readonly onClose: () => void;
}
```

Match the desktop `AddPositionForm` in `GroupDetail.tsx`. Do not edit that file, and do not export or reuse its private function.

- Calling title: textbox named `Calling title`.
- Gender requirement: combobox named `Gender requirement`, options `Any` (`any`), `Men only` (`M`), `Women only` (`F`). Add `Same as presidency` (`presidency_aligned`) only while `classifyCallingGender(organizationName, title.trim())` is `presidency_aligned`. Until the editor changes the combobox, the value is that Handbook result, including when the title changes. After they change it, keep their choice. If that choice is `presidency_aligned` and the Handbook result is no longer `presidency_aligned`, drop back to the new Handbook result instead of submitting a hidden option.
- Type: radios `Single person` and `List`. Default single. A list shows Positions, default 2, minimum 1, maximum 50, with buttons named `Fewer positions` and `More positions`.
- Help text, exactly: `Adds N vacant position(s) to this proposal only. Current and other proposals are unchanged.` where N is 1 for a single and the stepper value for a list.
- An empty trim shows `role="alert"` `Enter a calling title` and does not call `onSubmit`.
- Submit is a button named `Add position`. It calls `onSubmit` with `{ groupId, title: trimmed, type, positionCount, genderRule }`. `positionCount` is `1` for a single and the clamped list count otherwise. Always include `genderRule`. Do not rewrite `presidency_aligned` to `any`.
- Cancel, Escape, and the scrim call `onClose` and not `onSubmit`. Controls are at least 44px tall. No horizontal scrolling at 390px.

`PhoneEditing` opens it from `onAddPosition(callingGroupId)`. `callingGroupName` is `board.callingGroups[id].name`. `organizationName` is the board-group name `groupDetail(board, ward, callingGroupId, baseline)` already uses (`board.boardGroups[detail.boardGroupId].name`), which is `Sunday School` and not `Sunday School Presidency`. If the calling group or that board group is missing, do not open the sheet and send nothing. Submit calls `send('addAssignment', request)` once. A second submit while that send is in flight sends nothing. Success closes the sheet and shows `role="status"` `Added {title}`. A refused send keeps the sheet and shows the existing alert `Couldn't apply the change: {message}` with Dismiss. An `offline` result shows no alert. Switching boards closes the sheet.

### Allowed edits to existing tests
`apps/web/src/shell/phone-editing.test.tsx` may change only these three assertions, plus new tests:

- `tapping a person opens the person sheet for the open board`: the Profile button is present. Keep the Move, Release, and Add to dugout assertions.
- `Current shows the person sheet read-only` and `an accepted proposal shows the sheet read-only`: remove `/Profile, note & photo/` from the absent-button list, and assert the Profile button is present. Keep Move, Release, Add to dugout, and Add position absent, and keep the Current test's zero operation frames.

Do not edit any other existing test. If another existing test fails, stop and report BLOCKED. In particular, leave these alone: `fill-sheet.test.tsx` (`person sheet hides Profile without onOpenProfile`), `optional-add.test.tsx`, `phone-app.test.tsx`, `PhoneBoard.test.tsx`, `PhonePerson.test.tsx`, and every preview and e2e file that drives `/__preview/phone-board`.

## Scope
May change:
- `apps/web/src/shell/PhoneEditing.tsx`
- `apps/web/src/shell/phone-editing.css` (new sheet rules only, if the feature stylesheets are not enough)
- `apps/web/src/shell/phone-editing.test.tsx` (the three assertion updates above, and new tests)
- `apps/web/src/features/phone-person/PhoneProfileSheet.tsx` (new)
- `apps/web/src/features/phone-person/phone-profile.test.tsx` (new)
- `apps/web/src/features/phone-person/phone-person.css` (profile sheet rules only)
- `apps/web/src/features/phone-board/PhoneAddPositionSheet.tsx` (new)
- `apps/web/src/features/phone-board/phone-add-position.test.tsx` (new)
- `apps/web/src/features/phone-board/phone-board.css` (add-position sheet rules only)
- `apps/web/e2e/phone-profile.spec.ts` (new)
- `apps/web/e2e/gui/phone-profile.capture.ts` (new)

Must not change:
- `PhoneApp.tsx`, `PhoneBoard.tsx`, `PhonePersonSheet.tsx`, `GroupDetail.tsx`, `BoardShell.tsx`, `PersonPanel.tsx`, `NotesDialog.tsx`, `features/photos/**`, `features/dnd/**`, `apps/web/src/sync/**`, `apps/web/src/design/**`, `apps/server/**`, `packages/**`, `scripts/**`, `docs/**`, `playwright.config.ts`, every existing test, e2e, and capture file
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/phone-editing.test.tsx src/shell/phone-app.test.tsx src/features/phone-person src/features/phone-board src/features/group-view/GroupDetail.test.tsx` | every new test below passes; existing tests in those paths pass, with only the three assertion updates named above |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/phone-profile.spec.ts` | passes on phone-chromium and phone-webkit; desktop-chromium and tv-chromium skip with the reason `Phone profile and add position apply to the phone projects` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-profile/` has `profile-note`, `add-position`, and `current-profile` PNGs for both `phone-chromium` and `phone-webkit` |
| 4 | Red before green | run the new `phone-editing.test.tsx` assertions before `PhoneEditing` passes `onOpenProfile` or `onAddPosition` | those tests fail because the Profile button and the Add position control are absent; record that output. An import error is not the red result |
| 5 | Mutation | in a disposable worktree at the candidate, make the add-position sheet always submit `genderRule: 'any'`, then run check 1 | `add position sends addAssignment with the Handbook gender rule` fails; remove the worktree |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

The shell starts in the shared checkout. `cd` to this task's worktree first. Run at most one of `./scripts/verify.sh`, `pnpm --filter web run test:e2e`, and `gui:capture` in that worktree at a time.

## Unit tests to write
`phone-profile.test.tsx` renders `PhoneProfileSheet` with stub `upload`, `assign`, and `onSaveNote`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `profile sheet shows initials when there is no photo` | no `img`; the initials from `initials(name)` are visible; category reads `Adult` or `Youth` | always rendering a broken image |
| `profile sheet shows the portrait when photoRef is set` | `img` named by the member name and `src` equal to `currentUrl` | showing initials on top of a photo |
| `saving a note trims it, and an empty note is null` | `  Prefers mornings  ` calls `onSaveNote('Prefers mornings')` once; a whitespace-only note calls `onSaveNote(null)` | sending the raw spaces |
| `a note over 280 characters cannot be saved` | Save is disabled and `Notes can be at most 280 characters.` is visible | saving the overflow |
| `an unchanged note cannot be saved` | Save is disabled when the trim equals the current note | posting a no-op update |
| `a refused note save stays open` | `onSaveNote` resolving `{ ok: false, message: 'stale member' }` shows `Could not save the note: stale member` and does not call `onClose` | closing over an error |
| `a second save while pending calls onSaveNote once` | two clicks before the promise settles produce one call | no in-flight guard |
| `a new photo uploads and assigns without the comparison` | choosing a PNG file calls `upload` then `assign(memberId, photoRef)` and does not show the comparison dialog | waiting for a comparison on a first photo |
| `replacing a photo assigns only after Use New Photo` | with `photoRef` set, choosing a file shows the comparison and does not call `assign` until `Use New Photo` | replacing immediately |

`phone-add-position.test.tsx` renders `PhoneAddPositionSheet`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Relief Society defaults Teacher to women only` | organization `Relief Society`, title `Teacher`: the combobox value is `F`; submit sends `genderRule: 'F'`, `type: 'single'`, `positionCount: 1` | using the calling-group name, or omitting `genderRule` |
| `Sunday School presidency defaults to Same as presidency` | organization `Sunday School`, title `Sunday School Second Counselor`: value `presidency_aligned`, option `Same as presidency` is present, submit sends that rule | passing `Sunday School Presidency` as the organization, which classifies as `any` |
| `a non-presidency Sunday School title has no Same as presidency option` | title `Sunday School Teacher`: value `any`, and no option named `Same as presidency` | always offering the presidency option |
| `a stale presidency choice follows the new title` | choose `Same as presidency` for `Sunday School Second Counselor`, then change the title to `Sunday School Teacher` and submit | submit sends `genderRule: 'any'` | submitting the hidden `presidency_aligned` value |
| `an override is sent as chosen` | on a Relief Society `Teacher`, choose `Men only` | submit sends `genderRule: 'M'` | still sending the Handbook default |
| `an empty title sends nothing` | submit with a blank title shows `Enter a calling title` and does not call `onSubmit` | submitting `title: ''` |
| `a list defaults to 2 and clamps at 1 and 50` | List shows Positions `2` and help `Adds 2 vacant position(s)...`; Fewer stops at 1; More stops at 50; submit sends `type: 'list'` and that count | a count of 0 or 51 |
| `cancel and Escape send nothing` | Cancel and Escape call `onClose` and not `onSubmit` | submitting on Escape |

`phone-editing.test.tsx` uses the existing fake socket harness. Assert operation frames and `updateMember` frames.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `a draft person sheet opens the profile sheet` | `Profile, note & photo` opens dialog `Profile · Bea Placeholder` with `Note` and `Upload photo for Bea Placeholder` | `onOpenProfile` still omitted |
| `saving a profile note sends updateMember with the trimmed note` | one `updateMember` frame `{ memberId, patch: { note: 'Prefers mornings' } }`; after `memberUpdated` the profile dialog closes and the person sheet remains; no `op` frame | sending a board operation, or leaving the spaces in the note |
| `a refused profile note stays on the sheet` | a `rejected` reply shows `Could not save the note:` and the profile dialog | closing anyway |
| `Current opens the profile sheet and still has no move or add position` | Profile opens; no Move button; no Add position control; saving a note sends `updateMember` and no `op` frame | treating the note as a proposal edit, or hiding Profile on Current |
| `an accepted proposal opens the profile sheet without move actions` | Profile is present; Move, Release, and Add to dugout are absent | editable when `status === 'accepted'` |
| `a signed-out session has no profile button` | `PhoneBoardEditing` with `me: null` on a Draft shows no `Profile, note & photo` button | uploading without a session |
| `add position sends addAssignment with the Handbook gender rule` | from Relief Society, `Add a position to Relief Society Teachers`, title `Teacher`, one `addAssignment` whose request is `{ groupId, title: 'Teacher', type: 'single', positionCount: 1, genderRule: 'F' }` with that calling group's id | `genderRule: 'any'`, or the board-group id |
| `Sunday School presidency add sends presidency_aligned` | from Sunday School, title `Sunday School Second Counselor`, the combobox is `presidency_aligned` and the frame sends that rule | classifying the calling group name `Sunday School Presidency` |
| `an empty add-position title sends nothing` | no `op` frame and `Enter a calling title` is visible | sending the empty title |
| `a refused addAssignment keeps the sheet` | `{ ok: false, code: 'conflict', message: 'stale board' }` shows `Couldn't apply the change: stale board` | closing the sheet |
| `a second add submit while sending sends once` | two submits produce one `addAssignment` frame | no in-flight guard |
| `switching boards closes the add-position sheet` | open the sheet, switch to Current, the dialog is gone | leaving the Draft form up on Current |

## Edge cases (each needs a test)
Covered above: no photo, existing photo, note trim, empty note, 280-character limit, unchanged note, refused note, double save, Current and Accepted profile with no placement actions, signed-out, Handbook `F`, Handbook `presidency_aligned`, non-presidency title, stale presidency choice, explicit override, blank title, list bounds, cancel, Escape, refused add, double submit, board switch.

## e2e (`apps/web/e2e/phone-profile.spec.ts`)
Phone projects only. Each test creates its own proposal with `uniqueProposalName`, as `phone-editing.spec.ts` does, and edits only that proposal. The fixture member is Bea Placeholder, Primary Teacher. The new calling title is `Fictional Helper`.

1. On the new Draft, open Primary, choose `Add a position to Primary Teachers`, enter `Fictional Helper`, leave Gender requirement at `any`, and submit `Add position`. A vacant `Fictional Helper` row is visible. No horizontal overflow.
2. Open Bea Placeholder, open `Profile, note & photo`, enter `Fictional planning note`, save, close, and open the profile again. The note field shows `Fictional planning note`.
3. On Current, Primary has no `Add a position to Primary Teachers` button. Bea's sheet has `Profile, note & photo` and no Move button.

## GUI capture (`apps/web/e2e/gui/phone-profile.capture.ts`)
Phone projects only. Capture `profile-note` (profile sheet open on the note field), `add-position` (the add sheet open with Gender requirement visible), and `current-profile` (Current, profile open, Move absent). Fail the shot if the page scrolls horizontally.

## Human checks
On an iPhone at `/`, in a Draft: add a position and confirm the sheet is usable with one thumb and does not scroll sideways. Open Profile, edit a note, and upload a small fictional JPEG. A desktop window on the same ward shows that note and portrait without a reload. On Current, Profile still saves a note, and Move and Add position are absent.

## Out of scope
- Tags on the profile sheet.
- Search, Dugout, and Changes tabs (T-095, T-096).
- Desktop add-position, the desktop inspector, and drag-and-drop.
- The `/__preview/phone-board` and `/__preview/phone-person` routes.
- Any change to how Move, Fill, Release, or the second-calling and approval dialogs work.
