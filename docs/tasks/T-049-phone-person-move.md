# T-049: Phone person and move sheets

**Milestone:** 5 — Phone
**Depends on:** T-048 (phone board), T-009 (move and fill), T-008 (derived views), T-020 (tags and affinities). All `done`.
- Standalone preview, same rule as T-047 and T-048. It does **not** change `App.tsx` or mount the phone layout at `/`.
- No shared files with in-flight T-050 (`features/phone-search`, `features/phone-dugout`) or T-051 (`features/phone-changes`).

**Spec refs:**
- SPEC.md §3: dragging/moving from a calling slot proposes releasing that specific calling and filling the destination; never implicitly release all of a person's callings. Add to dugout keeps all callings and shows no warning.
- SPEC.md §5: moving or releasing leaves a visible vacancy; list vacancies vs single vacancies; dragging/sending to dugout releases that calling and records explicit dugout inclusion; assigning a calling clears explicit dugout inclusion.
- SPEC.md §6: calling affinities show matching preferred tags during selection (`Matches {tag}`) and never rank or reject candidates.
- SPEC.md §10: phones use bottom sheets for person and move actions; tap-to-move replaces drag.
- `docs/design/ui-canvas/PhonePerson.dc.html` (artboard 22) and `docs/design/ui-canvas/Mobile.dc.html` (artboard 5).

## Goal
`<PhonePersonSheet>` and `<PhoneMoveSheet>` provide the phone bottom sheets for inspecting a member's callings in a proposal (with per-calling `Move…` and `Release`, plus `Add to dugout` and `Profile, note & photo`) and for tap-to-move destination selection (vacant positions with search filter, preferred-tag affinity badges, `Send to dugout`, and `Cancel`). A preview at `/__preview/phone-person` composes `PhoneShell` and `PhoneBoard` with both sheets wired to real core operations (`placeInPosition`, `addToList`, `releaseCalling`, `moveToDugout`, `addToDugout`) on the fixture proposal. Nothing is sent to the server.

## Design decisions (binding)

### Model (`apps/web/src/features/phone-person/model.ts`)

```ts
export interface PhonePersonCallingRow {
  readonly positionId: string;
  readonly assignmentId: string;
  readonly title: string;
  readonly orgLabel: string; // "{boardGroup.name} · {callingGroup.name}" (or "{boardGroup.name}" when callingGroup.name === boardGroup.name)
}

export interface PhonePersonSheetModel {
  readonly memberId: string;
  readonly name: string;
  readonly categoryLabel: 'Adult' | 'Youth';
  readonly tagNames: readonly string[];
  readonly needsApproval: boolean;
  readonly externalCallings: readonly { readonly unit: string; readonly title: string }[];
  readonly callings: readonly PhonePersonCallingRow[];
  readonly inExplicitDugout: boolean;
}

export interface PhoneVacantDestinationRow {
  readonly key: string; // positionId for single; assignmentId for list
  readonly target:
    | { readonly kind: 'single'; readonly positionId: string }
    | { readonly kind: 'list'; readonly assignmentId: string };
  readonly title: string;
  readonly orgLabel: string; // "{boardGroup.name} · {callingGroup.name}" (or "{boardGroup.name}" when equal)
  readonly matchedTagNames: readonly string[]; // from core preferenceMatches(board, ward, assignmentId, memberId), mapped to ward.tags[id].name
}

export function buildPersonSheetModel(
  board: Board,
  ward: Ward,
  memberId: string,
): PhonePersonSheetModel | null;

export function buildVacantDestinations(
  board: Board,
  ward: Ward,
  memberId: string,
  query?: string,
): readonly PhoneVacantDestinationRow[];
```

- `buildPersonSheetModel` returns `null` when `ward.members[memberId]` is missing (no throw).
- `categoryLabel` is `'Adult'` when `member.category === 'adult'`, else `'Youth'`.
- `tagNames` maps `member.tagIds` through `ward.tags[id]?.name` (filtering any undefined).
- `callings` uses `callingsOf(board, memberId)` in core order. For each entry, look up `board.boardGroups[entry.boardGroupId]` and `board.callingGroups[entry.callingGroupId]`: `orgLabel` is `${boardGroup.name} \u00B7 ${callingGroup.name}` unless `boardGroup.name === callingGroup.name`, in which case it is `${boardGroup.name}`.
- `inExplicitDugout` is `board.dugoutInclusions.includes(memberId)`.
- `buildVacantDestinations` iterates `vacancies(board)` in core order:
  - For a `single` assignment, emit one row with `key = vacancy.positionId` and `target = { kind: 'single', positionId: vacancy.positionId }`.
  - For a `list` assignment, collapse multiple vacant positions of the same `assignmentId` into a single row (at the first vacancy's position in core order) with `key = vacancy.assignmentId` and `target = { kind: 'list', assignmentId: vacancy.assignmentId }`. Skip the list if the member already occupies a position in that list assignment (`already_in_list` prevention, SPEC §5).
  - `matchedTagNames` uses `preferenceMatches(board, ward, assignmentId, memberId)` from `@wardboard/core`, mapped to tag names in that order.
  - When `query` is provided and non-blank after `.trim().toLowerCase()`, keep only rows where `title.toLowerCase().includes(q)` or `orgLabel.toLowerCase().includes(q)` or any `matchedTagNames` entry `.toLowerCase().includes(q)`. Do not rank or reorder by tag match (SPEC §6).

### `<PhonePersonSheet>` (`apps/web/src/features/phone-person/PhonePersonSheet.tsx`)

```tsx
export interface PhonePersonSheetProps {
  readonly model: PhonePersonSheetModel;
  readonly boardName: string;
  readonly editable: boolean;
  readonly onStartMove: (positionId: string) => void;
  readonly onRelease: (positionId: string) => void;
  readonly onAddToDugout: () => void;
  readonly onPlaceFromDugout?: () => void;
  readonly onOpenProfile: () => void;
  readonly onClose: () => void;
}
```
- Renders a modal bottom sheet (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the `h2` containing `model.name`). Escape and the `Close` button (`aria-label="Close"`, at least 44×44) call `onClose()`.
- Header: avatar circle (`initials(model.name)`, `avatarColor(model.name)`), `h2` with `{model.name}` and `· {model.categoryLabel}`, tag chips for `model.tagNames`, and `Needs approval` badge text when `model.needsApproval` is true.
- Section heading (`h3`): `Callings in {boardName}`.
  - If `model.callings.length === 0`: text `No callings in this proposal.` When `editable` and `onPlaceFromDugout` is provided, also render a button `Assign calling…` (at least 44px tall) that calls `onPlaceFromDugout()`.
  - For each calling in `model.callings`: shows `calling.title` and `calling.orgLabel`. When `editable` is true, renders two buttons (each at least 44px tall):
    - `Move…` with `aria-label={`Move from ${calling.title}`}` → calls `onStartMove(calling.positionId)`.
    - `Release` with `aria-label={`Release from ${calling.title}`}` → calls `onRelease(calling.positionId)`.
  - When `editable` is false, the `Move…` and `Release` buttons are absent.
- When `model.externalCallings.length > 0`, renders a section `Outside the ward` listing each `{unit} · {title}`.
- Dugout control:
  - When `editable` is true and `!model.inExplicitDugout`: a button (at least 44px tall) with text `Add to dugout` and subtitle `keeps current callings` → calls `onAddToDugout()`.
  - When `model.inExplicitDugout`: text `In dugout`.
- Profile button: `<button type="button">` with text `Profile, note & photo` (at least 44px tall) → calls `onOpenProfile()`.

### `<PhoneMoveSheet>` (`apps/web/src/features/phone-person/PhoneMoveSheet.tsx`)

```tsx
export interface PhoneMoveSheetProps {
  readonly memberName: string;
  readonly sourceCalling: { readonly positionId: string; readonly title: string; readonly orgLabel: string } | null;
  readonly destinations: readonly PhoneVacantDestinationRow[];
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelectDestination: (target: PhoneVacantDestinationRow['target']) => void;
  readonly onSendToDugout: (() => void) | null;
  readonly onCancel: () => void;
}
```
- Renders a modal bottom sheet (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the `h2` `Move {memberName}`). Escape and the `Cancel` button (at least 44px tall) call `onCancel()`.
- Subtitle:
  - When `sourceCalling !== null`: `Releases from ${sourceCalling.orgLabel} \u00B7 ${sourceCalling.title}. Tap a destination.`
  - When `sourceCalling === null`: `Tap a vacant calling to place ${memberName}.`
- Search input: `<input type="search" aria-label="Find a calling" placeholder="Find a calling…" value={query} onChange={...} />` inside a label/container at least 44px tall.
- Section label: `Vacant positions`.
- Destination list:
  - When `destinations.length === 0`: text `No matching vacant positions.`
  - One `<button type="button">` per row (at least 44px tall), accessible name including `row.title` and `row.orgLabel`, showing `row.title`, `row.orgLabel`, and when `row.matchedTagNames.length > 0`, a visible badge `Matches {row.matchedTagNames.join(', ')}`. Clicking calls `onSelectDestination(row.target)`.
- Footer actions:
  - When `sourceCalling !== null` and `onSendToDugout !== null`: button `Send to dugout` (at least 44px tall) → calls `onSendToDugout()`.
  - Button `Cancel` (at least 44px tall) → calls `onCancel()`.

### Preview (`apps/web/src/features/phone-person/preview.tsx`)
Default-exports `{ title: 'Phone person & move', render }`.
- Holds local state for `board` (initialized to `data.proposal.board`), `activeBoardId` (`data.proposal.id`), `activeTab` (`'board'`), `query` (`''`), `status` (`string | null`), and `sheet`:
  - `{ kind: 'none' }`
  - `{ kind: 'person'; memberId: string }`
  - `{ kind: 'move'; memberId: string; fromPositionId: string | null }`
- Starts on the Primary organization screen (`initialScreen={{ kind: 'organization', boardGroupId: primaryBoardGroupId }}`) with the person sheet already open for `Jo Testwell` (who holds two callings in the fixture ward: `Relief Society Teacher` and `Nursery Leader`, and carries the `Teaches well` tag) so `/__preview/phone-person` immediately shows `PhonePersonSheet` over Primary.
- Tapping a person on `PhoneBoard` opens `{ kind: 'person', memberId }`.
- In `PhonePersonSheet`:
  - `Move…` on a calling transitions to `{ kind: 'move', memberId, fromPositionId: positionId }` and resets `query` to `''`.
  - `Release` runs core `releaseCalling(board, ctx, { memberId, positionId })`, updates `board`, sets `status` to `Released ${memberName}`, and closes or updates the sheet.
  - `Add to dugout` runs core `addToDugout(board, ctx, { memberId })`, updates `board`, and sets `status` to `Added ${memberName} to dugout`.
  - `Profile, note & photo` sets `status` to `Profile requested for ${memberName}` and closes the sheet.
- In `PhoneMoveSheet`:
  - Selecting a single destination runs `placeInPosition(board, ctx, { memberId, from: fromPositionId, to: target.positionId })`, updates `board`, closes the sheet, and sets `status` to `Moved ${memberName}`.
  - Selecting a list destination runs `addToList(board, ctx, { memberId, from: fromPositionId, assignmentId: target.assignmentId })`, updates `board`, closes the sheet, and sets `status` to `Moved ${memberName}`.
  - `Send to dugout` runs `moveToDugout(board, ctx, { memberId, from: fromPositionId })`, updates `board`, closes the sheet, and sets `status` to `Sent ${memberName} to dugout`.

## Scope
May change:
- `apps/web/src/features/phone-person/**` (new)
- `apps/web/e2e/phone-person.spec.ts`, `apps/web/e2e/gui/phone-person.capture.ts` (new)

Must not change:
- `apps/web/src/features/phone-shell/**`, `apps/web/src/features/phone-board/**`, `App.tsx`, `main.tsx`, `apps/web/src/shell/**`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, `docs/tasks/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component & model tests | `pnpm --filter @wardboard/web exec vitest run src/features/phone-person` | all tests in `model.test.ts` and `PhonePerson.test.tsx` pass |
| 2 | Browser | `pnpm --filter @wardboard/web run build && pnpm --filter @wardboard/web exec playwright test -c e2e/playwright.config.ts e2e/phone-person.spec.ts` | exits 0; all tests pass on desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-person/` has PNGs of the person sheet and the move sheet for desktop, phone-chromium, phone-webkit, and tv; inspected against `PhonePerson.dc.html` and `Mobile.dc.html` |
| 4 | Scope | `git diff origin/main --name-only` | only paths under `apps/web/src/features/phone-person/`, `apps/web/e2e/phone-person.spec.ts`, and `apps/web/e2e/gui/phone-person.capture.ts` |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

Run at most one of `verify.sh`, `test:e2e`, or `gui:capture` in this worktree at a time.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `buildPersonSheetModel returns callings, tags, category, and null for unknown member` (`model.test.ts`) | Jo Testwell has `Adult`, `Teaches well`, and two callings (`Relief Society · Relief Society Teachers` / `Relief Society Teacher` and `Primary · Nursery` / `Nursery Leader`); Tai Demo has `Youth`; `m-missing` returns `null` | missing second calling; crash on unknown member |
| `buildPersonSheetModel includes external callings and Needs approval` | Hal Testwell has `Example Stake` / `Stake Family History Consultant`; Cy Mockup has `needsApproval: true` | external callings or needsApproval omitted |
| `buildVacantDestinations lists single and collapsed list vacancies with preference matches` | for Jo Testwell (`Teaches well`), vacant `Primary Teacher` list positions collapse into one list destination with `matchedTagNames: ['Teaches well']`; `Primary` `Second Counselor` (vacant on preview proposal) is a single destination with `matchedTagNames: []`; `Nursery Leader` list is excluded because Jo Testwell already holds a position in that list | duplicate list rows; `already_in_list` not filtered; preference match missing |
| `buildVacantDestinations filters by query without reordering` | query `chorister` returns only `Chorister`; query `teaches well` returns destinations matching that tag; blank query returns all | query case-sensitive; tag match not searched |
| `person sheet renders callings, Move and Release buttons when editable, and hides them when read-only` (`PhonePerson.test.tsx`) | `Move from Nursery Leader` and `Release from Nursery Leader` fire callbacks with the positionId; with `editable={false}` those buttons and `Add to dugout` are absent | buttons shown on read-only board |
| `Add to dugout and In dugout states` | when `inExplicitDugout` is false, clicking `Add to dugout` calls `onAddToDugout` once; when `inExplicitDugout` is true, `In dugout` text is shown and the button is absent | duplicate add button shown |
| `Close button and Escape close the person sheet` | both call `onClose` | Escape ignored |
| `move sheet shows source release subtitle, filters destinations, shows Matches badge, and selects a destination` | subtitle names source org and title; `Matches Teaches well` badge visible; clicking a destination calls `onSelectDestination` with its target | badge missing; wrong target payload |
| `move sheet Send to dugout and Cancel callbacks` | `Send to dugout` calls `onSendToDugout`; `Cancel` and Escape call `onCancel`; when `sourceCalling` is null, `Send to dugout` is not rendered | Send to dugout rendered when placing from dugout |

`e2e/phone-person.spec.ts` (all four projects):
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `person sheet opens Move sheet and moves Jo Testwell into a vacant calling` | `/__preview/phone-person`: dialog `Jo Testwell` is visible; click `Move from Nursery Leader`; dialog `Move Jo Testwell` is visible with `Matches Teaches well`; click a vacant destination; sheet closes and `Moved Jo Testwell` status appears; no horizontal overflow | sheet transition broken; move operation not applied |
| `releasing a calling from the person sheet updates the board` | `/__preview/phone-person`: click `Release from Nursery Leader`; `Released Jo Testwell` appears | release callback not wired |

## Edge cases (each needs a test)
Covered above: unknown member id (`null`), member with zero callings, member with multiple callings, member already in a list assignment (list excluded from move destinations), member in explicit dugout (`In dugout` vs `Add to dugout`), read-only board (`editable: false`), empty destination filter match (`No matching vacant positions.`), `sourceCalling: null` (no `Send to dugout` button), Escape key dismissal.

## GUI verification
Required. Capture `/__preview/phone-person` at desktop, phone-chromium, phone-webkit, and TV for two states: `person-sheet` (the initial open `PhonePersonSheet` for Jo Testwell) and `move-sheet` (after clicking `Move from Nursery Leader` to open `PhoneMoveSheet`). Compare with `PhonePerson.dc.html` and `Mobile.dc.html`:
- Person sheet shows avatar, name, `· Adult`, tag chip, both callings with `Move…` and `Release` buttons, `Add to dugout` with `keeps current callings`, and `Profile, note & photo`.
- Move sheet shows `Move Jo Testwell`, the release subtitle, the search field, vacant destination rows with dashed vacancy styling and `Matches Teaches well` badge, `Send to dugout`, and `Cancel`.
- No horizontal scroll at 390×844; all interactive controls in the open sheet are at least 44px tall.

## Human checks
- After the phone shell is mounted at `/`: on an iPhone, tap a member on the Board tab, tap `Move…`, filter and tap a vacant destination, and confirm both bottom sheets feel natural one-handed.

## Out of scope
- Mounting at `/` or changing `phone-shell` or `phone-board`.
- Occupied single-destination swap/release-occupant dialog, second-calling confirmation dialog, and needs-approval approval dialog on phone (desktop `features/dnd` owns those dialogs; phone integration will wire them if needed).
- Editing notes, tags, or photos inside the profile sheet (`onOpenProfile` is the callback seam).
