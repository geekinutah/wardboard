# T-048: Phone board and organization screens

**Milestone:** 5 — Phone
**Depends on:** T-047 (phone shell). Done. Also uses done core derive (`wardOverview`, `groupDetail`, `overseerOf`) and the fictional fixture ward.
- Standalone preview, same rule as T-047. It does **not** change `App.tsx` or mount the phone layout at `/`.
- No shared files with in-flight T-089 (`features/settings`, `features/tags`, `shell/SettingsRoute.tsx`, `shell/TagLibrarySection.tsx`, `e2e/tag-library.spec.ts`).

**Spec refs:**
- SPEC.md §4: ward overview is organization areas with vacancy counts and proposed-change counts; organization detail shows leadership, groups, and calling slots or vacancy placeholders; the + control adds a position on the board being edited. Out-of-Unit is not this task.
- SPEC.md §5: a vacant slot stays visible; color is never the only signal.
- SPEC.md §10: phones tap through the three zoom levels instead of using the desktop canvas.
- `docs/design/ui-canvas/PhoneHome.dc.html` (organization list) and `PhoneOrg.dc.html` (organization screen).

## Goal
The Board tab can show the ward's organizations and, after a tap, one organization's groups and positions. A preview at `/__preview/phone-board` renders that inside the existing phone shell, on the fixture proposal. Nothing is sent to the server. Tapping a person, a vacancy, or + records a callback for T-049; this task does not open those sheets.

## Design decisions (binding)

### Model (`apps/web/src/features/phone-board/model.ts`)

```ts
export interface PhoneOrgListRow {
  readonly boardGroupId: string;
  readonly name: string;
  readonly changeLabel: string;
  readonly vacantLabel: string;
}

export interface PhonePositionRow {
  readonly positionId: string;
  readonly memberId: string | null;
  readonly name: string;
  readonly title: string;
  readonly proposed: boolean;
}

export interface PhoneOrgSection {
  readonly callingGroupId: string;
  readonly heading: string;
  readonly rows: readonly PhonePositionRow[];
}

export interface PhoneOrganization {
  readonly boardGroupId: string;
  readonly name: string;
  readonly vacantLabel: string;
  readonly overseerText: string;
  readonly sections: readonly PhoneOrgSection[];
}

export function proposedChangeLabel(changeCount: number): string;
export function phoneOrgList(board: Board, baseline: Board | null): readonly PhoneOrgListRow[];
export function phoneOrganization(
  board: Board,
  ward: Ward,
  baseline: Board | null,
  boardGroupId: string,
): PhoneOrganization | null;
```

- `proposedChangeLabel`: `0` → `No changes`; `1` → `1 proposed change`; otherwise `{n} proposed changes`.
- `phoneOrgList` is `wardOverview(board, baseline)` in that order. `changeLabel` comes from `proposedChangeLabel(tile.changeCount)`. `vacantLabel` is `{n} vacant`, including `0 vacant`. Do not add an Out-of-Unit row.
- `phoneOrganization` returns `null` when `board.boardGroups[boardGroupId]` is missing. It does not throw.
- Otherwise the name is the board group's name. `overseerText` is `Overseen by Bishop`, `Overseen by First Counselor`, or `Overseen by Second Counselor`, from `overseerOf(board, { kind: 'boardGroup', id })`. Do not append a person's name.
- Sections are the top-level calling groups of that board group (parent is the board group), ordered by `order` then id. For each, call `groupDetail(board, ward, callingGroupId, baseline)` and render every section it returns, in that order.
- A section heading is the calling group's name. When that group's `kind` is not `presidency` and not `bishopric`, append ` · {filled} of {total}`, where `filled` is the sum of `filledCount` and `total` is the sum of `positions.length` across that section's assignments.
- A position row uses the member's name, or `Vacant` when `memberId` is null. `title` is the assignment title. `proposed` is the detail position's `proposed` flag. Skip sections that have no positions.
- `vacantLabel` is `{n} vacant`, where `n` is the number of rows in the sections with `memberId === null`.

### `PhoneBoard`

`<PhoneBoard board baseline ward editable onAddPosition onOpenPerson onOpenVacancy initialScreen />`

- `editable: boolean`. Current and an accepted proposal pass `false`. A draft passes `true`.
- `onAddPosition(callingGroupId: string)`, `onOpenPerson(memberId: string, positionId: string)`, `onOpenVacancy(positionId: string)`.
- `initialScreen` is `{ kind: 'list' }` by default, or `{ kind: 'organization', boardGroupId: string }`.

**List screen** (`<main aria-label="Organizations">`): one button per list row, accessible name `{name}, {changeLabel}, {vacantLabel}`. Visible text is the name, the change label, and the vacant label (the vacant label is text, not color alone). Activating a row shows that organization. An empty list renders `No organizations.`

**Organization screen**:
- A back button named `Board` (visible text `Board`, at least 44×44) returns to the list.
- An `h1` with the organization name, then `vacantLabel`, then `overseerText`.
- Each section is a region labelled by an `h2` of `heading`. When `editable` is true, it contains a button named `Add a position to {calling group name}` (the group name, not the `n of m` suffix), at least 44×44, which calls `onAddPosition` once with that calling group id. When `editable` is false, that button is absent.
- An occupied row is a button named `{member name}, {title}`. Its text includes the name, the title, and, when `proposed`, the text `+ Proposed`. Activating it calls `onOpenPerson` once.
- A vacant row is a button named `Vacant, {title}` only when `editable` is true, and calls `onOpenVacancy` once. When `editable` is false it is text, not a button.
- Footer when `editable`: `Tap a person for options · tap a vacancy to fill it`. When not editable: `This board is read-only`.
- No sections: `No positions in this organization.` The header still renders.
- `initialScreen` whose board group does not exist: text `Organization not found`, the `Board` back button, and no throw.
- Export `PhoneOrganizationScreen` for the organization screen so a test can pass a `PhoneOrganization` directly. `PhoneBoard` uses it for a real model.

### Preview (`apps/web/src/features/phone-board/preview.tsx`)

Default-exports `{ title: 'Phone board', render }`. Compose the existing `PhoneShell` (do not modify it) around `PhoneBoard`:

- Same board entries as the phone-shell preview: Current (`importedAt: '2026-10-24T12:00:00Z'`), the fixture proposal, and `Youth focus` (accepted, 0 changes). Start on the fixture proposal and the Board tab.
- `editable` is true only when the active entry is that draft proposal.
- `board` / `baseline`: the draft uses `data.proposal.board` and `data.proposal.baseline`. Current and Youth focus use `data.current` and `baseline={null}`.
- Header summary and dugout count use the same core helpers as the phone-shell preview (`headerSummary`, `changeCount`, `vacancies`, `dugout`).
- Search, Dugout, and Changes tabs stay a placeholder paragraph naming the tab.
- `onAddPosition` sets a status line `Add position requested for {group name}`. `onOpenPerson` sets `Person {name}`. `onOpenVacancy` sets `Vacancy {title}`. The line is visible on the organization screen.

## Scope
May change:
- `apps/web/src/features/phone-board/**` (new)
- `apps/web/e2e/phone-board.spec.ts`, `apps/web/e2e/gui/phone-board.capture.ts` (new)

Must not change:
- `apps/web/src/features/phone-shell/**`, `App.tsx`, `main.tsx`, `apps/web/src/shell/**`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, `docs/tasks/**`, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component tests | `pnpm --filter @wardboard/web exec vitest run src/features/phone-board` | all tests in `model.test.ts` and `PhoneBoard.test.tsx` pass |
| 2 | Browser | `pnpm --filter @wardboard/web run build && pnpm --filter @wardboard/web exec playwright test -c e2e/playwright.config.ts e2e/phone-board.spec.ts` | exits 0; both tests pass on desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-board/` has PNGs of the organization list and the Primary screen for desktop, phone-chromium, phone-webkit, and tv; inspected against `PhoneHome.dc.html` and `PhoneOrg.dc.html` |
| 4 | Scope | `git diff main --stat -- apps/web/src/features/phone-shell apps/web/src/App.tsx apps/web/src/shell apps/web/src/preview` | empty output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

Run at most one of `verify.sh`, `test:e2e`, or `gui:capture` in this worktree at a time.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `proposedChangeLabel uses singular and plural` (`model.test.ts`) | `0` → `No changes`; `1` → `1 proposed change`; `2` → `2 proposed changes` | always plural; "0 proposed changes" |
| `phoneOrgList follows wardOverview order and labels` | fixture proposal: rows include `Primary` after `Young Women`; Primary's change label is `No changes`; its vacant label matches `wardOverview`'s `vacantCount` as `{n} vacant`; no row named `Out-of-Unit` | reordered; vacancy dropped; Out-of-Unit invented |
| `a placement turns the Primary change label singular` | fill the vacant Primary Secretary with a core placement against the fixture proposal; Primary's `changeLabel` is `1 proposed change` | diff not scoped to the organization |
| `phoneOrganization describes Primary` | name `Primary`; `overseerText` is `Overseen by` plus one of the three counselor/bishop labels; a section heading `Primary Presidency` with no `of` count; a section heading that starts `Primary Teachers · ` and contains ` of `; a row `Yara Fictional` / `President`; a row name `Vacant` title `Secretary` | presidency gets an `n of m` suffix; secretary vacancy omitted |
| `phoneOrganization marks a net new calling` | the same Secretary placement: that row's `proposed` is true. Against `baseline: null`, `proposed` is false | proposed on Current |
| `phoneOrganization returns null for an unknown id` | `phoneOrganization(..., 'bg-missing')` is `null` and does not throw | throw |
| `list buttons open an organization` (`PhoneBoard.test.tsx`) | fixture draft, `editable`: the Primary button's accessible name contains `Primary`, `No changes`, and `vacant`; activating it shows heading `Primary`, text `Yara Fictional`, text `Vacant`, and button `Board` | row not a button; name hidden |
| `Board returns to the list` | from Primary, `Board` shows the organizations list again and hides the `h1` `Primary` | history stack broken |
| `add and vacancy callbacks fire only when editable` | `Add a position to Primary Teachers` calls `onAddPosition` once with that group's id; `Vacant, Secretary` calls `onOpenVacancy` once. With `editable` false both buttons are absent, `This board is read-only` is shown, and the tap hint is not | add shown on Current; vacancy still a button |
| `person callback and proposed text` | activating `Yara Fictional, President` calls `onOpenPerson` once. After the Secretary placement, that row's button name contains the member name and the text `+ Proposed` is present | proposed as color only; callback gets the wrong id |
| `unknown initial organization` | `initialScreen` with `bg-missing` shows `Organization not found` and `Board`, and does not throw | crash |
| `empty organization screen` | `PhoneOrganizationScreen` with `sections: []`, name `Empty Org`: heading `Empty Org` and text `No positions in this organization.` | empty screen with no message |

`e2e/phone-board.spec.ts` (all four projects):
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `opens Primary and comes back` | `/__preview/phone-board`: Primary row visible; activate it; heading `Primary`; `Yara Fictional` visible; `Board` returns to a list that contains `Primary`. `documentElement.scrollWidth <= clientWidth` | preview route missing; horizontal scroll at 390 |
| `add position is announced on a draft` | on Primary, activate `Add a position to Primary Teachers`; the page shows `Add position requested for Primary Teachers` | callback not wired |

## Edge cases (each needs a test)
Covered above: zero/one/many changes, unknown board group, empty organization, editable false (no add, vacancy not a button, read-only hint), proposed text only after a net placement, presidency heading without `n of m`, no Out-of-Unit row.

## GUI verification
Required. Capture `/__preview/phone-board` at desktop, phone-chromium, phone-webkit, and TV: the organization list, and Primary after it is opened. Compare with `PhoneHome.dc.html` and `PhoneOrg.dc.html`:
- Each organization row shows its name, a change line, and a vacant label as text. Rows are at least 44px tall.
- Primary shows `Board`, the `h1`, a vacant count, an `Overseen by` line, group headings, a person row, a `Vacant` row, `+ Proposed` only where a calling actually changed, and the add control at least 44×44.
- The list and Primary have no horizontal scroll at 390×844. The phone shell's bottom tabs do not cover the last row (the shell's own padding; do not edit the shell).
- A desktop or TV capture that is a narrow phone column is not a defect. Overlapping text, a clipped name, or a control under 44px is a defect.

## Human checks
- After a later task mounts the phone shell at `/`: on an iPhone, open the Board tab, tap Primary, and confirm the back control and the organization list are comfortable one-handed.

## Out of scope
- Mounting this at `/` or changing `phone-shell`.
- Person, move, and release sheets (T-049). The add-position form itself (title, single/list, count) — this task only fires `onAddPosition`.
- Search, dugout, and changes tabs (T-050, T-051).
- Out-of-Unit on the phone list.
- Drag and drop.
