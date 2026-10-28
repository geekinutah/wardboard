# T-037: Person inspector and notes

**Milestone:** 4 — Desktop board
**Depends on:** T-008, T-011, T-026 (done). T-004 components, T-031 canvas, and T-070 previews are done.
- PLAN lists T-030 as a dependency. T-030 is done, but this task does not mount anything in the shell. It is a standalone preview, like T-032 to T-036. Mounting it, and wiring `Canvas`'s existing `onOpenNotes` and the server's `updateMember` message, is a later integration task.
- No shared files with the in-flight T-038, T-040, T-042, T-072, or T-052, or with T-041.

**Spec refs:**
- SPEC.md §3 Multiple callings: the person card links to the member's other callings and offers **Add to dugout**, which keeps every calling and shows no warning.
- SPEC.md §6: name, optional photo, youth/adult, current callings, short tags, access to a brief note. `needs_approval` is a neutral member property, not a tag. **Notes are never displayed by default anywhere. Double-clicking a member card opens that member's notes.**
- SPEC.md §7 / §10: member notes are ward-wide shared data (editing a note updates it everywhere).
- SPEC.md §12: "Double-clicking a member card opens notes; notes are otherwise never displayed, including on the TV."
- Server rule (`apps/server/src/members/rules.ts` `parseMemberNote`): a note is trimmed; empty means `null`; at most 280 characters counted as `Array.from(note).length`.
- Artboard 2 (`docs/design/ui-canvas/OrgDetail.dc.html`), the inspector for a person with multiple callings.

## Goal
`<PersonInspector>` shows one member's planning context on one board (callings, dugout state, tags, needs approval, outside callings) without ever showing the note. `<NotesDialog>` is the only place a note's text appears, and it saves through a callback. A preview at `/__preview/person` renders both. Nothing is sent to the server.

## Design decisions (binding)

### `apps/web/src/features/person/PersonInspector.tsx`
Exports `<PersonInspector board ward memberId readOnly onOpenNotes onAddToDugout />`:
- `board: Board`, `ward: Ward`, `memberId: MemberId`, `readOnly: boolean`
- `onOpenNotes: (memberId: MemberId) => void`
- `onAddToDugout: (memberId: MemberId) => void`

It uses `callingsOf`, `dugout`, and `rootBoardGroupOf` from `@wardboard/core`. It does not copy them or mutate `board` or `ward`.

**Chrome**
- `<aside aria-label="Person: {name}" data-member-id={memberId}>`. The name is a heading (`<h2>`).
- Under the name, the text `Adult` or `Youth`.
- If `memberId` is not in `ward.members`, render `<aside aria-label="Person">` with the text `This person is not in the ward.` and nothing else. No throw.

**Callings**
- The heading is `Callings in this proposal` when `board.kind === 'proposal'`, otherwise `Callings in Current`.
- One list item per `callingsOf(board, memberId)` entry, in that order. The item text is `{title}`, then on a second line `{calling group name} · {root board group name}`. The root board group comes from `rootBoardGroupOf(board, callingGroupId)`.
- If there are two or more callings, show `Serves in {n} callings` above the list.
- No callings: `No calling in this proposal` (or `No calling in Current`, by the same rule as the heading).

**Dugout state**
- If `dugout(board, ward)` has an entry for the member with `explicit: true`, show `In the dugout · placed here on purpose`.
- If it has an entry with `explicit: false`, show `In the dugout`.
- Otherwise, no dugout line.

**Tags, needs approval, outside callings**
- Each of the member's `tagIds` that resolves in `ward.tags` shows its name as visible text, in `tagIds` order. Unknown tag ids are skipped.
- `needsApproval: true` shows the text `Needs approval`. It is not one of the tags and is never shown as color or an icon alone.
- Each `externalCallings` entry shows `{title} · {unit}` under the heading `Outside the ward`. With none, the heading is not rendered.
- `removedDate` set: show `Removed from Current on {removedDate}` as text. The inspector otherwise renders normally.

**Actions**
- `Open notes` button. It calls `onOpenNotes(memberId)` and is shown even when `readOnly` (notes are shared member data, not board edits).
- `Add to dugout` button. It calls `onAddToDugout(memberId)`. It is not rendered when `readOnly` is true, when the member already has an explicit dugout entry, or when `removedDate` is set.
- Buttons are at least 44px tall.

**The note body is never rendered by the inspector**, not even in an attribute, `title`, or visually hidden text. The only hint is the `Open notes` button. It reads `Open notes` whether or not a note exists.

### `apps/web/src/features/person/NotesDialog.tsx`
Exports `<NotesDialog member onSave onClose />`:
- `member: Member`
- `onSave: (memberId: MemberId, note: string | null) => Promise<{ ok: true } | { ok: false; message: string }>`
- `onClose: () => void`

Behavior:
- `role="dialog"`, `aria-modal="true"`, labelled by a heading `Notes · {member name}`.
- The sentence `Notes are shared across Current and every proposal. They never appear on the TV or in search.`
- A `<textarea>` with accessible name `Note`, initially `member.note ?? ''`. It receives focus when the dialog opens.
- A counter `{n} / 280`, where `n` is `Array.from(value.trim()).length`.
- When `n > 280`, show `Notes can be at most 280 characters.` and disable Save.
- `Save` is disabled when the trimmed value equals the trimmed original (`member.note ?? ''`).
- Save calls `onSave(member.id, trimmed === '' ? null : trimmed)` once. While it is pending, Save is disabled and reads `Saving…`. A second click does not call `onSave` again.
- On `{ ok: true }`, call `onClose()`.
- On `{ ok: false, message }`, show `Could not save the note: {message}` (in a `role="alert"` element), keep the typed text, and re-enable Save.
- `Cancel` and the Escape key call `onClose()` without calling `onSave`.

### Preview
`preview.tsx` default-exports `{ title: 'Person', render }`. It renders, for `data.proposal.board`:
- A `PersonInspector` for **Jo Testwell** (the fixture member with two callings: Relief Society Teacher and Nursery Leader). The comment names her. If she is not found or does not hold two callings, the preview throws.
- `onOpenNotes` opens a `NotesDialog` for that member. `onSave` updates a local copy of the ward (React state) and resolves `{ ok: true }`. Nothing else is sent anywhere.
- `onAddToDugout` applies core `addToDugout` with `sequentialIds('person')` to a local copy of the board. A failed operation throws.
- `readOnly` is `false`.

### Files
- `features/person/` may hold CSS and small helpers. Do not change `apps/web/src/design/**`. If a design component lacks something, compose it in this folder.

## Scope
May change:
- `apps/web/src/features/person/**` (new)
- `apps/web/e2e/person.spec.ts`, `apps/web/e2e/gui/person.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component tests | `pnpm --filter @wardboard/web exec vitest run src/features/person` | all tests in `PersonInspector.test.tsx` and `NotesDialog.test.tsx` pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `person.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `apps/web/gui-artifacts/person/` has desktop, phone (Chromium and WebKit), and TV PNGs for both the inspector state and the open notes dialog, inspected against the inspector on artboard 2 |
| 4 | No note text in the inspector source | `grep -n "\.note\b" apps/web/src/features/person/PersonInspector.tsx` | no output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`PersonInspector.test.tsx` and `NotesDialog.test.tsx`. Use `buildFixtureWard()`, `buildFixtureProposal()`, and real core operations. For a member with a note, use **Jay Storybook** (`Travels for work most weekdays in March.`).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `lists both of Jo Testwell's callings with group and organization` | on the fixture current board: `Serves in 2 callings`, then `Relief Society Teacher` / `Relief Society Teachers · Relief Society`, then `Nursery Leader` / `Nursery · Primary`, in that order | only the first calling shown; org taken from the calling group instead of the root |
| `heading says this proposal on a proposal and Current on current` | the same member on the fixture current board and the fixture proposal board | heading hard-coded |
| `a member with no calling says No calling in this proposal and In the dugout` | Jay Storybook (no calling in the fixture) on the proposal board | empty list with no text; dugout state missing |
| `explicit inclusion says placed here on purpose and hides Add to dugout` | after `addToDugout` on an occupant | explicit flag ignored; button still offered |
| `never renders the note body` | for Jay Storybook, `container.innerHTML` does not contain `Travels for work`, and `Open notes` is present | note leaked into a tooltip, attribute, or hidden text |
| `Open notes and Add to dugout call back with the member id` | user clicks; the callbacks are called once with the id | wrong id; handler not wired |
| `readOnly hides Add to dugout but keeps Open notes` | `readOnly` true | notes blocked on Current, or the board edit offered on Current |
| `tags and Needs approval are text, unknown tag ids skipped` | Cy Mockup shows `Needs approval`; a ward copy whose member has a missing tag id renders without that tag and without throwing | icon-only flag; crash on a dangling id |
| `outside callings are listed only when present` | Kai Fictional shows `Stake Young Single Adult Adviser · Example Stake`; Jo Testwell has no `Outside the ward` heading | empty heading rendered |
| `removed member shows the removed date and no Add to dugout` | a ward copy with `removedDate: '2026-01-02'` | removed state ignored |
| `unknown member id shows the not-in-ward message` | id `m-missing` | throws or renders a blank card |

`NotesDialog.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `opens with the existing note, focused, under the member's name` | Jay Storybook: textarea value equals the note and has focus; heading `Notes · Jay Storybook` | blank textarea; no focus |
| `saves the trimmed note once, then closes` | type `  Prefers mornings  `, click Save twice quickly; `onSave` called exactly once with `'Prefers mornings'`; `onClose` called after it resolves | untrimmed value; double submit; never closes |
| `clearing the note saves null` | empty the textarea and save | sends `''` |
| `Save is disabled when unchanged` | open and click Save without edits; `onSave` not called | spurious writes |
| `281 characters disables Save and shows the limit message; 280 is allowed` | boundary: 280 code points enabled, 281 disabled; use a string with an emoji to prove code points, not UTF-16 units, are counted | `.length` counting; off-by-one |
| `a failed save shows the message and keeps the text` | `onSave` resolves `{ ok: false, message: 'offline' }`; alert text `Could not save the note: offline`; textarea keeps the edit; Save enabled again; `onClose` not called | text lost; dialog closes on failure |
| `Cancel and Escape close without saving` | both paths; `onSave` never called | Escape ignored; cancel saves |

`e2e/person.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `inspector lists two callings; a saved note appears only in the dialog` | `/__preview/person`: two callings visible; Open notes; type a note; Save; dialog closes; the note text is not on the page; Open notes again shows it in the textarea | preview not wired; inspector leaks the note after save |
| `Add to dugout updates the dugout line` | click Add to dugout; `In the dugout · placed here on purpose` appears and the button is gone | local board not updated |

## Edge cases (each needs a test)
Covered above: no callings, multiple callings, explicit vs automatic dugout, unknown member id, dangling tag id, removed member, note boundary at 280/281 (code points), empty note → null, unchanged note, failed save, double submit, read-only board.

## GUI verification
Required. Capture `/__preview/person` at desktop, phone (Chromium and WebKit), and TV, before and after clicking Open notes. Compare with the inspector on artboard 2:
- The name, Adult/Youth, both callings with their group lines, tags, and the two buttons are visible.
- The dialog shows the heading, the shared-note sentence, the textarea, the counter, and Save/Cancel.
- No note text is visible in the inspector state.
- No horizontal page scroll on the phone. Buttons are at least 44px. Needs approval, when present, is not color alone.
- The canvas, header, and dugout are outside this preview. Their absence is not a defect.

## Human checks
none

## Out of scope
- Mounting the inspector or dialog in `BoardShell`, wiring `Canvas`'s `onOpenNotes`, and sending `updateMember` (the sync client has no member-profile method yet; that is the later integration task).
- Editing tags, needs approval, or calling preferences (T-039).
- Photos (T-060).
- Removed markers on board cards (T-040).
- Navigating to another of the member's callings (search/navigation belongs to T-038 and the integration task).
