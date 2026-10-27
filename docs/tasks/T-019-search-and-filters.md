# T-019: Search and filters

**Milestone:** 2 — Board domain
**Depends on:** T-008 (done)
**Spec refs:** SPEC.md §10 "Global search" (people, callings, tags; also group names, custom assignments, external calling titles; grouped by type; partial case-insensitive; a person result shows all placements and dugout state; tag selection highlights people; scoped to the active board by default, across boards as an option; note bodies not searched; removed members excluded; filters for vacant, no calling, youth/adult, selected tags, which never edit placements), §8 (removed members never appear in search), §12 ("Search finds people, callings, and tags, including vacant callings and custom assignments"; "A member with a `removed_date` never appears in global search results"), `docs/design/ui-canvas/Search.dc.html` (artboard 11)

## Goal
Pure functions in `packages/core/src/search/` turn a query, a scope (one or more boards), and filters into grouped, deterministic results. They also compute which members and positions on one board a set of filters highlights.

## Design decisions (binding for this task)
- **Text normalization** (both query and candidate text): Unicode NFKD, strip combining marks (`\p{M}`), lowercase with `toLocaleLowerCase('en')`, collapse runs of whitespace to one space, trim. A candidate matches when the normalized query is a substring of the normalized candidate, so "jose" matches "José".
- `search(input: SearchInput, ward: Ward): SearchResults`
  ```ts
  interface SearchFilters { vacant?: boolean; noCalling?: boolean; category?: MemberCategory; tagIds?: readonly TagId[] }
  interface SearchInput { query: string; boards: readonly Board[]; filters?: SearchFilters }
  interface SearchResults { people: PersonResult[]; callings: CallingResult[]; tags: TagSearchResult[]; groups: GroupResult[] }
  interface PersonResult {
    memberId: MemberId;
    matchedOn: readonly ('name' | 'tag' | 'external_calling')[]; // in this fixed order, no duplicates
    placements: readonly { boardId: BoardId; positionId: PositionId; assignmentId: AssignmentId; title: string }[];
    dugout: readonly { boardId: BoardId; explicit: boolean }[];   // the scoped boards where the member is in the dugout
  }
  interface CallingResult {
    boardId: BoardId; assignmentId: AssignmentId; title: string; origin: AssignmentOrigin;
    callingGroupId: CallingGroupId; boardGroupId: BoardGroupId;
    positions: readonly { positionId: PositionId; occupantId: MemberId | null; occupantRemoved: boolean }[];
    vacantCount: number;
  }
  interface TagSearchResult { tagId: TagId; name: string; memberIds: readonly MemberId[] }
  interface GroupResult {
    boardId: BoardId; kind: 'boardGroup' | 'callingGroup'; id: BoardGroupId | CallingGroupId; name: string;
    positionCount: number; vacantCount: number;  // over enabled assignments in the group and its descendants
  }
  ```
- **Scope** is the `boards` array. One board is the default "this board" scope; Current plus every proposal is "all". Per-board results (`callings`, `groups`, `placements`, `dugout`) carry `boardId`. People and tags are ward-wide and appear once. An empty `boards` array is valid: people and tags can still match, with empty placements and dugout lists. Callings and groups are then empty.
- **What text matches:**
  - People: member `name`, the names of the member's tags, and each external calling's `title` and `unit`.
  - Callings: assignment `title`, for assignments that are `enabled` **or** have at least one occupant. Both standard and custom origins are included.
  - Tags: tag `name`.
  - Groups: board-group and calling-group `name`, including hidden board groups (§4: subgroups stay searchable when collapsed).
  - **Never searched:** member `note`, `photoRef`, any id.
- **Removed members** (non-null `removedDate`) never appear in `people` or in a tag's `memberIds`, and are never matched by filters. In `callings`, a position they occupy is reported honestly: `occupantId` set and `occupantRemoved: true`, so the UI can show the removed marker. That is board context, not a person result.
- **Filters** narrow results; they never change any board or ward (artboard 11: "Filters highlight matches on the board; they never change placements").
  - People filters are `noCalling`, `category`, and `tagIds`. A person must satisfy **all** active people filters. `tagIds` requires every listed tag. `noCalling` means the member holds no position on any scoped board. Active people filters apply only to `people`.
  - The calling filter is `vacant`. It keeps only `callings` with `vacantCount ≥ 1` and applies only to `callings`.
  - When any filter is active, `tags` and `groups` are empty.
  - **Empty query** (after normalization) with no active filter: every list is empty. Empty query with active filters: `people` is every non-removed member satisfying the people filters (if any are active), and `callings` is every vacant calling in scope (if `vacant` is active). Lists whose filter category is inactive are empty.
  - A non-empty query with filters: text matching first, then filters.
- `filterMatches(board: Board, ward: Ward, filters: SearchFilters): { memberIds: readonly MemberId[]; positionIds: readonly PositionId[] }` gives board highlights. `memberIds` are the non-removed members satisfying all active people filters. Scope for `noCalling` here is this board, and the list is empty when no people filter is active. `positionIds` is the **union** of the vacant positions of enabled assignments (when `vacant` is active) and the positions those members occupy on this board.
- **Ordering:** `people` and `memberIds` by name (`localeCompare` `'en'`, `{ sensitivity: 'base' }`), then id. `tags` the same way by tag name. `callings`, `groups`, `placements`, and `dugout`: boards in `boards` input order, then structural order within each board (as in `src/derive/views.ts`; groups by board-group order, then the calling-group chain). `positionIds` in structural order. Tests use fixture data with unique sibling orders (B-014 tie-breaks are out of scope). Local comparators in `src/search/` are fine; do not edit `src/derive/`.
- Reuse exported derive views (`vacancies`, `callingsOf`, `dugout`, `rootBoardGroupOf`) rather than reimplementing them. Outputs are deep-frozen, and inputs are never mutated.

## Scope
May change:
- `packages/core/src/search/search.ts`, `packages/core/src/search/normalize.ts`, `packages/core/src/search/types.ts`, `packages/core/src/search/index.ts` (new)
- `packages/core/src/index.ts` (one export line)
- `packages/core/test/search/search.test.ts`, `packages/core/test/search/normalize.test.ts` (new)

Must not change: `packages/core/src/model/**`, `src/derive/**`, `src/ops/**`, `src/rules/**`, `src/fixtures/**`, `src/diff/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Search tests | `pnpm --filter core exec vitest run test/search/` | all tests pass, at least the 22 named below |
| 2 | Export | `pnpm --filter core exec vitest run test/search/search.test.ts -t "is exported from the package root"` | 1 test passes, proving that `search` and `filterMatches` imported from `../../src/index.ts` are functions |
| 3 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use `buildFixtureWard()` and `buildFixtureProposal()`. The fixture has the tags `Musical`, `Teaches well`, `Weekday availability`, `New move-in`, and `Spanish speaker`; youth members; external callings (`Stake Family History Consultant`, `Stake Young Single Adult Adviser`); and a member note (`Travels for work most weekdays in March.`). Build variants with `createWard`/`createBoard` or real ops where needed.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `normalizes case, accents and whitespace` (normalize.test) | `"  JOSÉ   de "` normalizes to `"jose de"` | no NFKD/mark stripping; no collapse |
| `partial case-insensitive name match` | a lowercase fragment from the middle of a fixture name finds that person | prefix-only or case-sensitive |
| `a person result lists every placement and dugout state on scoped boards` | — | first placement only; dugout omitted |
| `a person matches on a tag name` | `matchedOn` includes `tag` | tags ignored |
| `a person matches on an external calling title or unit` | `"family history"` and `"example stake"` | external callings ignored |
| `note bodies are never searched` | `"travels"` returns no person | note included in haystack |
| `removed members never appear` | a removed member is absent from people, tag `memberIds`, and filter results even on an exact-name query | missing `removedDate` check |
| `a removed occupant is flagged in calling results` | `occupantRemoved: true` | hides the placement or omits the flag |
| `finds vacant callings` | a vacant assignment's title is found, with `vacantCount` ≥ 1 | only occupied positions indexed |
| `finds custom assignments` | an `addAssignment`-created custom title is found | standard only |
| `disabled unoccupied assignments are not returned` | — | ignores `enabled` |
| `finds board groups and calling groups, including hidden ones` | — | hidden groups skipped |
| `tag results list non-removed members by name` | — | includes removed members; unordered |
| `scope limits per-board results` | one board vs two boards: callings and placements carry the right `boardId`s; with two boards a person appears once | duplicates people per board |
| `empty query without filters returns nothing` | — | returns everything |
| `filters combine with AND for people` | `category: 'adult'` and `tagIds` [Musical, Teaches well] gives exactly the members with both tags | OR semantics |
| `no-calling filter uses every scoped board` | a member with a calling only on board B is excluded when B is in scope | checks the first board only |
| `vacant filter keeps only callings with vacancies and leaves people unfiltered` | — | filters people too |
| `any active filter empties tags and groups` | — | — |
| `filterMatches highlights the union of vacancies and matching members' positions` | — | intersection; includes removed members |
| `search never mutates inputs and results are frozen` | deep-frozen inputs don't throw; outputs frozen | mutation |
| `is exported from the package root` | public API | missing export line |

## Edge cases (each needs a test)
- A whitespace-only query behaves as empty.
- A query matching nothing gives four empty lists.
- An empty `boards` array still returns matching people and tags, with empty placements.
- `tagIds: []` is not an active filter.
- A query that matches a person both by name and by tag reports `matchedOn: ['name', 'tag']` once, in that order.

## Human checks
none

## Out of scope
- Search UI, navigation/zoom to a result, Add to dugout wiring (T-038, T-050). Ranking or relevance scoring. Searching proposal names or rationale. Server endpoints.
- Changing structural order tie-breaks (B-014) or editing `src/derive/`.
