# T-038: Search and filters UI

**Milestone:** 4 — Desktop board
**Depends on:** T-019 (done). T-004 and T-070 are done.
- PLAN lists T-030 as a dependency. This task drops it on purpose. Search renders in its own preview. T-030 is in progress and leaves the shell's search input inert. Mounting this box into that slot is a later task.
- No shared files with T-030, T-036, or T-040. Add to dugout emits a request. It does not render the dugout panel.

**Spec refs:**
- SPEC.md §3: Add to dugout keeps every calling and shows no warning.
- SPEC.md §8 and §10: persistent search of people, callings, and tags; group names too; grouped results; partial case-insensitive match; scope is the active board unless widened; removed members never appear; note bodies are not searched.
- SPEC.md §10 and artboard 11: filters highlight and never change placements.
- Artboard 11 (`docs/design/ui-canvas/Search.dc.html`).

## Goal
`<SearchBox>` is the search field, filter chips, scope switch, and grouped results. It calls `search` and `filterMatches` from `@wardboard/core`. Choosing a result or adding someone to the dugout emits a callback. A preview at `/__preview/search` renders it over the fixture proposal.

## Design decisions (binding)

```tsx
export type SearchTarget =
  | { readonly kind: 'person'; readonly memberId: MemberId }
  | { readonly kind: 'calling'; readonly boardId: BoardId; readonly callingGroupId: CallingGroupId; readonly assignmentId: AssignmentId }
  | { readonly kind: 'tag'; readonly tagId: TagId }
  | { readonly kind: 'group'; readonly boardId: BoardId; readonly groupKind: 'boardGroup' | 'callingGroup'; readonly id: string };

export function SearchBox(props: {
  ward: Ward;
  active: Board;
  boards: readonly Board[]; // active first, then the other boards in tab order. Current is included when the scope is widened.
  readOnly: boolean;
  onNavigate: (target: SearchTarget) => void;
  onAddToDugout: (request: AddToDugoutRequest) => void;
  onHighlight: (highlight: { memberIds: readonly MemberId[]; positionIds: readonly PositionId[] }) => void;
  onClose: () => void;
}): ReactElement;
```

`boards` is every board the wide scope may search. The single-board scope passes `[active]` to `search`. The wide scope passes `boards` unchanged.

**Field.** `<input type="search" aria-label="Search people, callings, tags" placeholder="Search people, callings, tags">`. The listbox is closed when the normalized query is empty and no filter is active. While it is open, the text `Esc to close` is visible. Escape calls `onClose` and closes the listbox. The typed query remains.

**Filters.** Chips, each `aria-pressed` true or false, with a non-color pressed indicator (a leading `✓` and bold weight):
- `Vacant positions` sets `filters.vacant`.
- `No calling` sets `filters.noCalling`.
- `Youth` and `Adults` set `filters.category` to `youth` or `adult`. Pressing one clears the other. Pressing the active one clears the category.
- One chip per ward tag, label `Tag: {name}`, in tag-name order. Pressed tags become `filters.tagIds`.
- The sentence `Filters highlight matches on the board; they never change placements.`
- Every filter change calls `onHighlight(filterMatches(active, ward, filters))`. The initial highlight is the empty result. `search` is called with the same filters. The board and ward objects are not mutated.

**Scope.** A group labelled `Search scope`.
- The single-board button reads `This proposal` when `active.kind === 'proposal'`, and `Current` when `active.kind === 'current'`. It is pressed by default.
- The wide button reads `All proposals & Current`.
- Exactly one is pressed. Pressed uses a filled background, not color alone.

**Results.** `role="listbox"` labelled `Search results`.
- The count `{n} results` is people + callings + tags + groups.
- Omit an empty section. People are headed `People`. Callings are headed `Callings`. Tags and groups share `Tags & groups` when either is non-empty, tags first.
- Each row is `role="option"`. The first option is `aria-selected="true"` when the list opens or the results change. ArrowUp and ArrowDown move that selection and do not leave the list. Enter calls `onNavigate` for the selected option. A click on a row does the same.
- A person row shows the name, `Adult` or `Youth`, placement titles on the scoped boards joined with ` · `, or `No calling` when that person has no scoped placement. `In dugout` when `person.dugout` contains the active board. `Add to dugout` when `readOnly` is false and the member is not already in `active.dugoutInclusions`. The button calls `onAddToDugout({ memberId })` and does not navigate. There is no warning.
- A calling row shows the title, `{board group name} · {calling group name}`, and `Vacant` when `vacantCount >= 1`. Otherwise it shows the occupant names. An `occupantRemoved` position adds the word `Removed`.
- A tag row shows the tag name and `Tag · {memberIds.length} people · select to highlight`. Choosing it also presses that tag's chip.
- A group row shows the name and `Group · {positionCount} positions, {vacantCount} vacant`.
- All four lists empty while the panel is open: `No matches`.
- The open panel ends with `note text isn't searched`.

**Controls** are at least 44px tall, including chips. Artboard 11 draws several controls shorter than that.

**Preview.** `{ title: 'Search', render }`. It uses `data.ward`, `data.proposal.board` as `active`, and `boards` equal to `[data.proposal.board, data.current]`. `readOnly` is false. Callbacks append `JSON.stringify` of the payload under the box. A second `SearchBox` with `readOnly` is rendered below it, labelled `Read-only` in an `<h2>`.

## Scope
May change:
- `apps/web/src/features/search/**` (new)
- `apps/web/e2e/search.spec.ts`, `apps/web/e2e/gui/search.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, other `features/**`, `packages/**`, `apps/server/**`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component | `pnpm --filter @wardboard/web exec vitest run src/features/search` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `search.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/search/` has desktop, phone, and TV PNGs of the open results, inspected against artboard 11 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`SearchBox.test.tsx`, with `buildFixtureWard()` and `buildFixtureProposal()`. Query through the real `search` function's behavior, not a stub.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `empty query and no filters leaves the listbox closed` | no listbox, no `No matches` | showing every member |
| `typing Ada lists Ada Fictional under People and omits a removed member` | add a removed member named Ada Gone via `createWard` copied from the fixture, or search a removed fixture member by name if one exists; the removed name is absent | removed members shown |
| `a note query shows No matches` | query `travels` against the fixture | note text indexed |
| `Vacant positions lists a vacant calling and does not change the board` | board JSON unchanged; `onHighlight` receives that calling's vacant position id | filter writes placements |
| `Youth and Adults are exclusive, and a tag chip requires that tag` | `Tag: Musical` pressed, Adults pressed, Youth clears Adults | both categories applied |
| `This proposal searches only the active board; All proposals & Current includes Current` | a custom calling added only on the proposal shows in the narrow scope and a current-only title shows only after widening. Build the extra calling with `addAssignment` | scope ignored |
| `Add to dugout emits the member id and does not navigate or warn` | click `Add to dugout` on a person who still has a calling; `onNavigate` not called; no warning text | release, or a confirm dialog |
| `Add to dugout is hidden when the member is already explicitly included or readOnly` | `addToDugout` first; the read-only box has no such button | second explicit add |
| `arrow keys move the selected option and Enter navigates` | ArrowDown then Enter yields the second target | click-only |
| `Escape closes the list and calls onClose, leaving the query` | | query cleared |
| `a tag row presses its chip` | | highlight chip unchanged |
| `In dugout shows for a dugout member, with No calling when they have none` | Jay Storybook on the fixture current board | badge missing |

`e2e/search.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `type Ada, add that person to the dugout, and see the emitted request` | `/__preview/search`: fill the search box with `Ada`, click Add to dugout, the page shows the JSON request with that member id and no warning | callback not wired in the browser |

## Edge cases (each needs a test)
Covered above: empty query, no matches, removed member, note text, read-only, already explicit, narrow versus wide scope.

## GUI verification
Required. Capture the preview with the results open (query `Ada` or a filter that opens the panel) at desktop, phone Chromium, phone WebKit, and TV. Compare with artboard 11:
- Grouped sections, the scope switch, filter chips, and Add to dugout are visible.
- A pressed chip is distinguishable without color alone.
- `note text isn't searched` is visible while results are open.
- No horizontal page scroll. Controls are at least 44px.
- The dimmed ward canvas behind the artboard's panel is out of scope.

## Human checks
none

## Out of scope
- Replacing the shell's inert search input. T-030 owns that input until a follow-up mounts `SearchBox`.
- Zooming the canvas to a result (no canvas in this task). `onNavigate` is the seam.
- Ranking, proposal-name search, and server endpoints.
- The dugout panel (T-036).
