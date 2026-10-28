# T-074: Out-of-Unit card and view

**Milestone:** 4 — Desktop board (promoted from backlog B-030)
**Depends on:** T-073 (core `outOfUnitMembers` and the dugout rule — must be `done` first), T-004 (design components), T-070 (preview harness), T-032 (ward overview tile look). T-004, T-070, T-032 are `done`.
- Standalone preview, like T-032 to T-038. It does not change `WardOverview`, the canvas, or the shell. Adding the tile to the overview and canvas navigation, and dragging from it (T-035), are later integration work.
- No shared files with in-flight T-037, T-040, T-041, T-042, T-046, T-047 or the importer tasks.

**Spec refs:** SPEC.md §4 Starting board groups item 9 (**CONFIRMED 2026-10-28:** read-only Out-of-Unit area listing every current member with an outside calling, their calling and unit; identical on Current and every proposal; no positions or vacancies; generally cannot be called; Add to dugout allowed with no warning), §5 Dugout, §6 (youth/adult shown as text; never color alone), §3 (Add to dugout keeps callings and shows no warning). Decision record: `docs/tasks/backlog/B-030-out-of-unit-members-unavailable.md`. Visual reference: the organization tiles on artboard 1 (`docs/design/ui-canvas/Main.dc.html`) and the shipped `apps/web/src/features/ward-overview/` tiles (read only).

## Goal
`<OutOfUnitTile>` is an overview tile like the organization tiles, summarizing how many members serve outside the ward. `<OutOfUnitView>` lists each of them with their outside callings and offers **Add to dugout**. Both read core's `outOfUnitMembers(ward)` and `dugout(board, ward)`. A preview at `/__preview/out-of-unit` renders both. Nothing is sent to the server.

## Design decisions (binding)

### `apps/web/src/features/out-of-unit/OutOfUnitTile.tsx`
`<OutOfUnitTile ward onOpen />`, `ward: Ward`, `onOpen: () => void`.
- `<article aria-label="Out-of-Unit">` with heading `Out-of-Unit` (h3) and the text `{n} members serving outside the ward` (`1 member serving outside the ward`; `No members serving outside the ward` for 0).
- Up to three member names from `outOfUnitMembers(ward)` in its order, then `+{k} more` when there are more.
- The whole tile's primary action is a button `Open Out-of-Unit` (≥44px) calling `onOpen`. Double-clicking the tile also calls `onOpen` (matching how organization tiles open).
- Styled like the organization tiles (same tokens from `apps/web/src/design/`; do not edit the design folder or `features/ward-overview`). The tile carries the visible label `Outside the ward` as text so it is not mistaken for a ward organization.

### `apps/web/src/features/out-of-unit/OutOfUnitView.tsx`
`<OutOfUnitView board ward readOnly onAddToDugout />`: `board: Board`, `ward: Ward`, `readOnly: boolean`, `onAddToDugout: (memberId: MemberId) => void`.
- `<section aria-labelledby>` with heading `Out-of-Unit` (h2) and the sentence `These members hold callings outside the ward and generally can't be called here. Placing one in a ward calling asks for confirmation.`
- One `<article data-member-id={id} aria-label={name}>` per `outOfUnitMembers(ward)` entry, in that order: the name, `Adult` or `Youth` as text, then one line per outside calling `{title} · {unit}`. If the member also holds ward callings on this board (`callingsOf(board, id)`), add `Also serves in the ward as {title1}, {title2}` as text.
- `Add to dugout` button (≥44px) per member calling `onAddToDugout(id)`. Not rendered when `readOnly`, or when `dugout(board, ward)` has the member with `explicit: true`; in that case show the text `In the dugout · placed here on purpose` instead.
- There are no vacancy placeholders, no + add position, and no release/move controls.
- No members: the text `No one in the ward holds a calling outside it.`
- Never renders a member's note (do not read `member.note`).

### Preview (`apps/web/src/features/out-of-unit/preview.tsx`)
Default-exports `{ title: 'Out-of-Unit', render }`. Renders the tile and, below it, the view for `data.proposal.board` with `readOnly: false`. The fixture has **Hal Testwell** (also a Temple and Family History Consultant) and **Kai Fictional** (outside calling only). `onOpen` scrolls the view into view and focuses its heading. `onAddToDugout` applies core `addToDugout` with `sequentialIds('out-of-unit')` to a local copy of the board (React state); a failed operation throws.

## Scope
May change:
- `apps/web/src/features/out-of-unit/**` (new)
- `apps/web/e2e/out-of-unit.spec.ts`, `apps/web/e2e/gui/out-of-unit.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component tests | `pnpm --filter @wardboard/web exec vitest run src/features/out-of-unit` | all tests in `OutOfUnitTile.test.tsx` and `OutOfUnitView.test.tsx` pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `out-of-unit.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/out-of-unit/` has desktop, phone (Chromium and WebKit) and TV PNGs before and after Add to dugout, inspected against the artboard 1 tiles |
| 4 | No note access | `grep -n "\.note\b" apps/web/src/features/out-of-unit/*.tsx` | no output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `buildFixtureWard()`, `buildFixtureProposal()` and real core operations.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tile counts and names the out-of-unit members` (`OutOfUnitTile.test.tsx`) | fixture: `2 members serving outside the ward`, names Hal Testwell and Kai Fictional, label `Outside the ward` | count from positions; label missing |
| `tile pluralizes, truncates and handles none` | ward copies with 1, 5 and 0 out-of-unit members → `1 member…`, three names + `+2 more`, `No members serving outside the ward` | always plural; all names listed; crash on empty |
| `tile opens by button and double-click` | both call `onOpen` once | only one path wired |
| `view lists each member with outside callings and category` (`OutOfUnitView.test.tsx`) | Kai: `Adult`, `Stake Young Single Adult Adviser · Example Stake`; Hal: `Stake Family History Consultant · Example Stake` and `Also serves in the ward as Temple and Family History Consultant` | ward calling line missing; unit dropped |
| `view has no vacancy, add-position, release or move controls` | no `Vacant`, `+ add position`, `Release`, `Move` text or buttons | reused group view with edit controls |
| `Add to dugout calls back with the id and hides after explicit inclusion` | click for Kai → `onAddToDugout(kaiId)`; rerender with a board after core `addToDugout` → `In the dugout · placed here on purpose`, no button | button stays; wrong id |
| `readOnly hides Add to dugout` | `readOnly: true` (Current) | board edit offered on Current |
| `removed members are not listed` | ward copy with Kai `removedDate` set → only Hal | removed member shown |
| `empty ward shows the none message` | all `externalCallings` emptied | blank section |
| `never renders a note` | ward copy giving Kai a note `Private note text`; `container.innerHTML` lacks it | note leaked |

`e2e/out-of-unit.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tile opens the view and Add to dugout updates it` | `/__preview/out-of-unit`: click `Open Out-of-Unit`, the view heading is focused; click Add to dugout on Kai → `In the dugout · placed here on purpose` | preview not wired; local board not updated |

## Edge cases (each needs a test)
Covered above: 0, 1 and many members; truncation; member with both ward and outside callings; explicit inclusion; read-only; removed member; note never shown.

## GUI verification
Required. Capture `/__preview/out-of-unit` at desktop, phone (Chromium and WebKit) and TV, before and after Add to dugout. Compare the tile with artboard 1's organization tiles:
- Tile heading, count, names and the `Outside the ward` label are readable; the tile does not look like a vacancy-bearing organization (no vacancy counts).
- Each member's outside calling and unit are visible; buttons ≥44px; no horizontal scroll on the phone; nothing conveyed by color alone.

## Human checks
- After the integration task adds the tile to the board: on the office TV, confirm the Out-of-Unit tile reads as separate from the ward organizations from the meeting table.

## Out of scope
- Adding the tile to `WardOverview`, canvas zoom navigation into the view, and presentation mode (later integration task).
- Dragging a card from the view to the dugout (T-035) and the second-calling dialog naming outside callings (T-035, using T-073's `secondCallingNoticesWithOutside`).
- Importing outside callings (T-055 → T-058).
