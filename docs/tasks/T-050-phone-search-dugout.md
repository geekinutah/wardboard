# T-050: Phone search and dugout

**Milestone:** 5 — Phone
**Depends on:** T-047 (phone shell), T-019 (core search), T-008 (core derived dugout), T-011 (core dugout ops). All `done`.
- Standalone previews, same rule as T-047 and T-048. It does **not** change `App.tsx` or mount the phone layout at `/`.
- No shared files with in-flight T-049 (`features/phone-person`) or T-051 (`features/phone-changes`).

**Spec refs:**
- SPEC.md §3: search results and person card offer Add to dugout, an explicit dugout inclusion that keeps all callings and shows no warning.
- SPEC.md §5: dugout automatically includes members with no remaining callings (excluding members who hold outside callings, unless explicitly added); explicit inclusions keep remaining callings visible (`Placed here · still serves as …`); the dugout is not a measure of availability.
- SPEC.md §6: `needs_approval` is shown as text (`Needs approval`).
- SPEC.md §8, §10: partial case-insensitive search over people, callings, tags, and groups; scoped to active board or all boards; filters for vacant, no calling, youth; removed members never returned; note bodies never searched.
- `docs/design/ui-canvas/PhoneSearch.dc.html` (artboard 21) and `docs/design/ui-canvas/PhoneDugout.dc.html` (artboard 23).

## Goal
`<PhoneSearch>` provides the phone Search tab screen (search input, scope and filter chips, grouped People / Callings / Tags results, and `+ Dugout` / `In dugout` actions) and `<PhoneDugout>` provides the phone Dugout tab screen (count header, availability explanation, category and tag filter chips, and dugout member rows with `Place` action). Previews at `/__preview/phone-search` and `/__preview/phone-dugout` render each inside `PhoneShell` on the fixture proposal. Nothing is sent to the server.

## Design decisions (binding)

### Part 1: `<PhoneSearch>` (`apps/web/src/features/phone-search/PhoneSearch.tsx`)

```tsx
export type PhoneSearchTarget =
  | { readonly kind: 'person'; readonly memberId: string }
  | { readonly kind: 'calling'; readonly boardId: string; readonly boardGroupId: string; readonly callingGroupId: string; readonly assignmentId: string }
  | { readonly kind: 'tag'; readonly tagId: string }
  | { readonly kind: 'group'; readonly boardId: string; readonly groupKind: 'boardGroup' | 'callingGroup'; readonly id: string };

export interface PhoneSearchProps {
  readonly ward: Ward;
  readonly activeBoard: Board;
  readonly allBoards: readonly Board[]; // activeBoard first, then other boards (including Current) for "All" scope
  readonly editable: boolean;
  readonly initialQuery?: string;
  readonly onSelectResult: (target: PhoneSearchTarget) => void;
  readonly onAddToDugout: (memberId: string) => void;
}
```

- Calls `search(ward, { query, boards: scope === 'all' ? allBoards : [activeBoard], filters })` from `@wardboard/core`. Does not mutate `ward` or any board.
- **Search header**:
  - `<input type="search" aria-label="Search" placeholder="Search people, callings, tags…" />` inside a 48px-tall label container (`initialQuery` defaults to `''`).
  - Filter/scope bar (`role="toolbar"` or `<div aria-label="Search filters">`), each button at least 44px tall with `aria-pressed` (`true` / `false`) and a non-color pressed indicator (filled dark background + bold weight + leading `✓ ` when pressed):
    - Scope buttons (mutually exclusive, default `'active'`):
      - Single-board button: label `This proposal` when `activeBoard.kind === 'proposal'`, or `Current` when `activeBoard.kind === 'current'`.
      - Wide-scope button: label `All`.
    - Filter chips (toggle independently):
      - `Vacant` → toggles `filters.vacant`.
      - `No calling` → toggles `filters.noCalling`.
      - `Youth` → toggles `filters.category = 'youth'` (or `undefined` when off).
      - When a tag is selected via a tag result row (or tag chip), show an active chip `Tag: {tagName}` that clears the tag filter when tapped.
- **Results area** (`<div className="wb-phone-search-results">`):
  - When `query.trim() === ''` and no filter is active (`!vacant && !noCalling && !category && (!tagIds || tagIds.length === 0)`): render helper text `Type a name, calling, or tag, or choose a filter.`
  - Otherwise, if all four result lists (`people`, `callings`, `tags`, `groups`) are empty: render `No matches.`
  - **People section** (rendered when `results.people.length > 0`): heading `h2` `People`. Each row shows:
    - A primary button (at least 44px tall) with avatar (`initials`, `avatarColor`), member name, and subtitle:
      - For a youth member, prefix `Youth · ` before calling titles (or `Youth · No calling` when no placements and no external callings).
      - Placement titles on the scoped boards joined with ` · `, or external calling titles (`{unit} · {title}`) when no ward placement, or `No calling` when none.
      - Clicking calls `onSelectResult({ kind: 'person', memberId: person.memberId })`.
    - Dugout status/action on `activeBoard`:
      - Let `inActiveDugout = person.dugout.some((d) => d.boardId === activeBoard.id)` or `dugout(activeBoard, ward).some((d) => d.memberId === person.memberId)`.
      - Let `explicitlyInDugout = activeBoard.dugoutInclusions.includes(person.memberId)`.
      - When `inActiveDugout`: show badge text `In dugout` (unless `editable && !explicitlyInDugout` is false — note: if a member is already in the dugout automatically or explicitly on `activeBoard`, show `In dugout`; if `!inActiveDugout && editable`, render a button `+ Dugout` with `aria-label={`Add ${member.name} to dugout`}`, at least 44×44, that calls `onAddToDugout(person.memberId)` without calling `onSelectResult`).
  - **Callings section** (rendered when `results.callings.length > 0`): heading `h2` `Callings`. Each row is a button (at least 44px tall) showing:
    - `calling.title`
    - `{boardGroup.name} · {callingGroup.name}` (or `{boardGroup.name}` when equal)
    - Right-side state text: `Vacant` when `calling.vacantCount >= 1`; otherwise the occupant names joined with `, ` (with ` (Removed)` appended if `occupantRemoved`).
    - Clicking calls `onSelectResult({ kind: 'calling', boardId: calling.boardId, boardGroupId: calling.boardGroupId, callingGroupId: calling.callingGroupId, assignmentId: calling.assignmentId })`.
  - **Tags section** (rendered when `results.tags.length > 0` or `results.groups.length > 0`): heading `h2` `Tags`.
    - Each tag row is a button (at least 44px tall) showing the tag name and `{tag.memberIds.length} ${tag.memberIds.length === 1 ? 'person' : 'people'} · show them`. Clicking toggles `tag.tagId` into `filters.tagIds` and calls `onSelectResult({ kind: 'tag', tagId: tag.tagId })`.
    - Each group row (if any) is a button (at least 44px tall) showing `group.name` and `Group · ${group.positionCount} positions, ${group.vacantCount} vacant`, calling `onSelectResult({ kind: 'group', boardId: group.boardId, groupKind: group.kind, id: group.id })`.
  - Footer note when results are shown: `Note text isn't searched.`

### Part 2: `<PhoneDugout>` (`apps/web/src/features/phone-dugout/PhoneDugout.tsx`)

```tsx
export interface PhoneDugoutProps {
  readonly board: Board;
  readonly ward: Ward;
  readonly editable: boolean;
  readonly onPlaceMember: (memberId: string) => void;
}
```

- Calls `dugout(board, ward)` from `@wardboard/core`. Does not mutate `board` or `ward`.
- **Header**:
  - `h1`: `Dugout · {filteredRows.length}`
  - Subtitle: `No calling in this proposal, or placed here on purpose. Not a measure of availability.`
  - Filter chips bar (each button at least 44px tall, `aria-pressed` `true`/`false`, non-color pressed indicator with filled background + bold weight + leading `✓ ` when pressed):
    - Category group (mutually exclusive, default `'all'`): `All`, `Adults`, `Youth`.
    - Tag chips (toggle independently): `Weekday` (matches ward tag named `Weekday availability` or `Weekday`) and `Teaching` (matches ward tag named `Teaches well` or `Teaching`).
- **List** (`<div className="wb-phone-dugout-list">`):
  - When `dugout(board, ward).length === 0`: render `No one is in the dugout.`
  - When `filteredRows.length === 0` (but dugout is non-empty): render `No one matches this filter.`
  - For each entry in `filteredRows` (in `dugout()` order):
    - Lookup `member = ward.members[entry.memberId]`.
    - Subtitle parts:
      - If `entry.explicit && entry.callings.length > 0`: `Placed here · still ${entry.callings.map((c) => c.title).join(', ')}`.
      - Else if `entry.explicit`: `Placed here`.
      - Follow with member's tag names (mapped from `member.tagIds` to `ward.tags[id].name`) and, when `member.needsApproval` is true, `Needs approval`, joined by ` · `. If no explicit phrase, no tags, and no `needsApproval`, show `No calling`.
    - When `editable` is true: render a `<button type="button">` (at least 44px tall) with accessible name `Place ${member.name}` showing avatar (`initials`, `avatarColor`), `{member.name} · {Adult|Youth}`, the subtitle line, and right-aligned action label `Place`. Clicking calls `onPlaceMember(entry.memberId)`.
    - When `editable` is false: render the row without the `Place` action button (or as a static `<article>`).

### Previews
1. `apps/web/src/features/phone-search/preview.tsx`:
   - Default-exports `{ title: 'Phone search', render }`.
   - Renders `PhoneShell` (active tab `'search'`, starting with `initialQuery="a"` so People, Callings, and Tags results are immediately visible) wrapping `PhoneSearch` on the fixture proposal (`board` in React state so clicking `+ Dugout` runs `addToDugout(board, ctx, { memberId })` and updates the row to `In dugout` and increments the shell's dugout count). Selecting a result sets a visible status line.
2. `apps/web/src/features/phone-dugout/preview.tsx`:
   - Default-exports `{ title: 'Phone dugout', render }`.
   - Starts with `board` equal to `data.proposal.board` after `addToDugout` on `Jo Testwell` (so an explicit-inclusion row with remaining callings `Placed here · still …` is visible alongside automatic dugout members and `Cy Mockup` if added, or automatic dugout members like `Jay Storybook` and `Tai Demo`).
   - Renders `PhoneShell` (active tab `'dugout'`) wrapping `PhoneDugout`. Clicking a row's `Place` sets a visible status line `Place ${memberName}`.

## Scope
May change:
- `apps/web/src/features/phone-search/**` (new)
- `apps/web/src/features/phone-dugout/**` (new)
- `apps/web/e2e/phone-search-dugout.spec.ts`, `apps/web/e2e/gui/phone-search-dugout.capture.ts` (new)

Must not change:
- `apps/web/src/features/phone-shell/**`, `apps/web/src/features/phone-board/**`, `apps/web/src/features/phone-person/**`, `apps/web/src/features/phone-changes/**`, `App.tsx`, `main.tsx`, `apps/web/src/shell/**`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, `docs/tasks/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component tests | `pnpm --filter @wardboard/web exec vitest run src/features/phone-search src/features/phone-dugout` | all tests in `PhoneSearch.test.tsx` and `PhoneDugout.test.tsx` pass |
| 2 | Browser | `pnpm --filter @wardboard/web run build && pnpm --filter @wardboard/web exec playwright test -c e2e/playwright.config.ts e2e/phone-search-dugout.spec.ts` | exits 0; all tests pass on desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-search/` and `apps/web/gui-artifacts/phone-dugout/` have PNGs for desktop, phone-chromium, phone-webkit, and tv; inspected against `PhoneSearch.dc.html` and `PhoneDugout.dc.html` |
| 4 | Scope | `git diff origin/main --name-only` | only paths under `apps/web/src/features/phone-search/`, `apps/web/src/features/phone-dugout/`, `apps/web/e2e/phone-search-dugout.spec.ts`, and `apps/web/e2e/gui/phone-search-dugout.capture.ts` |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

Run at most one of `verify.sh`, `test:e2e`, or `gui:capture` in this worktree at a time.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `empty query and no filters shows helper prompt` (`PhoneSearch.test.tsx`) | no People/Callings headings, shows `Type a name, calling, or tag, or choose a filter.` | showing all ward members on empty query |
| `searching Ada lists Ada Fictional under People, omits removed members, and never searches notes` | `Ada Fictional` visible; a removed member is absent; query `travels` shows `No matches.` | note body searched or removed member leaked |
| `+ Dugout button calls onAddToDugout without selecting the person, and In dugout shows for dugout members` | clicking `Add Ada Fictional to dugout` calls `onAddToDugout` once and not `onSelectResult`; `Jay Storybook` shows `In dugout` and no `+ Dugout` button; when `editable={false}`, `+ Dugout` is hidden | `+ Dugout` triggers navigation or appears on read-only board |
| `scope toggle switches between This proposal and All` | a custom assignment added only on `Current` appears only after clicking `All` | scope buttons inert |
| `Vacant, No calling, Youth chips and tag rows filter results` | clicking `Vacant` lists vacant callings; clicking a tag result row activates the tag filter | filter chips not wired to core `search` |
| `dugout lists automatic and explicit members with Adult/Youth, tags, Needs approval, and remaining callings` (`PhoneDugout.test.tsx`) | automatic row (`Jay Storybook`) has `Adult` and `Weekday availability`; explicit row (`Jo Testwell`) has `Placed here · still`; `Cy Mockup` (when included) has `Needs approval` text | remaining callings or `Needs approval` omitted |
| `All, Adults, Youth, Weekday, and Teaching chips filter without mutating the board` | `Youth` keeps `Tai Demo` and hides adults; `Weekday` keeps `Jay Storybook`; `Youth` + `Weekday` shows `No one matches this filter.`; board is unchanged | filter mutates board or uses OR instead of AND |
| `Place button calls onPlaceMember when editable and is hidden when read-only` | clicking `Place Jay Storybook` calls `onPlaceMember('m-0036')`; when `editable={false}`, no `Place` buttons exist | `Place` shown on Current |

`e2e/phone-search-dugout.spec.ts` (all four projects):
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `phone search preview lists results and adds a member to the dugout` | `/__preview/phone-search`: People and Callings headings visible; click `Add Ada Fictional to dugout`; row updates to `In dugout`; no horizontal overflow | preview not wired or horizontal scroll on phone |
| `phone dugout preview filters by Youth and triggers Place` | `/__preview/phone-dugout`: `Placed here · still` visible; click `Youth`; `Tai Demo` remains and adult rows disappear; click `Place Tai Demo`; `Place Tai Demo` status appears; no horizontal overflow | filter or Place callback broken |

## Edge cases (each needs a test)
Covered above: empty query + no filters, query matching nothing (`No matches.`), note body query (`travels`), removed member excluded, member already in dugout (`In dugout` vs `+ Dugout`), read-only board (`editable: false`), empty dugout (`No one is in the dugout.`), filter combination matching nothing (`No one matches this filter.`), explicit dugout member with remaining callings vs no callings.

## GUI verification
Required. Capture `/__preview/phone-search` (`apps/web/gui-artifacts/phone-search/`) and `/__preview/phone-dugout` (`apps/web/gui-artifacts/phone-dugout/`) at desktop, phone-chromium, phone-webkit, and TV. Compare with `PhoneSearch.dc.html` and `PhoneDugout.dc.html`:
- Phone search shows the search input, scope/filter chips (`This proposal`, `All`, `Vacant`, `No calling`, `Youth`) with non-color pressed state, `People` rows with `+ Dugout` / `In dugout`, `Callings` rows with `Vacant` or occupant names, and `Tags` rows.
- Phone dugout shows `Dugout · {n}`, the availability explanation sentence, filter chips (`All`, `Adults`, `Youth`, `Weekday`, `Teaching`), and member rows with `Adult`/`Youth`, remaining callings on explicit inclusions, and `Place`.
- No horizontal scroll at 390×844; all buttons and chips are at least 44px tall.

## Human checks
- After the phone shell is mounted at `/`: on an iPhone, switch to the Search and Dugout tabs, filter by chip, and confirm scrolling and tap targets feel comfortable one-handed.

## Out of scope
- Mounting at `/` or changing `phone-shell`.
- Opening the person or move sheet directly from search/dugout (`onSelectResult` and `onPlaceMember` are the callback seams).
