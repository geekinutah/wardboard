# T-032: Level 1 — ward overview

**Milestone:** 4 — Desktop board
**Depends on:** T-070 (preview harness), T-008, T-016 (done).
- PLAN lists T-031 as a dependency. This task drops it on purpose: the view is standalone and marks its zoom targets with T-031's `data-zoom-target` convention, and T-030 mounts it in the canvas later.
- Runs alongside T-033 and T-034. Its only shared file is the one-line export in `packages/core/src/derive/index.ts`.

**Spec refs:**
- SPEC.md §4 (Ward at a glance):
  - Labeled organization areas with leadership photos, not every member's picture.
  - Clear vacancy counts.
  - Level 1 shows organization tiles with labels, leaders' photos, vacancy counts and proposed-change counts.
  - It must stay useful on a TV.
- SPEC.md §4 (starting board groups).
- SPEC.md §5: vacancies are always labeled "Vacant".
- SPEC.md §3: the diff is against the proposal's baseline.
- `docs/design/README.md`: tokens, and "never rely on color alone".
- Artboard 1 (`docs/design/ui-canvas/Main.dc.html`): the tile grid in "Ward at a glance".

## Goal
A pure core function `wardOverview` computes one tile per visible board group: leaders, vacancy count, filled/total counts, and the proposed-change count against the baseline. `<WardOverview>` renders those tiles per artboard 1, each tile a zoom target. A preview at `/__preview/ward-overview` shows it for the fixture proposal.

## Design decisions (binding)

### Core: `packages/core/src/derive/overview.ts`
```ts
export interface OverviewLeader { readonly positionId: PositionId; readonly title: string; readonly memberId: MemberId | null; readonly proposed: boolean }
export interface OverviewTile {
  readonly boardGroupId: BoardGroupId; readonly name: string;
  readonly leaders: readonly OverviewLeader[];
  readonly positionCount: number; readonly filledCount: number; readonly vacantCount: number;
  readonly changeCount: number;   // 0 when baseline is null
}
export function wardOverview(board: Board, baseline: Board | null): readonly OverviewTile[];
```
- **Tiles**: one per board group with `visible: true`, ordered by `order` (then id).
- **Leaders**: positions of **enabled** assignments with `prominent: true` anywhere under the board group (any nesting depth), in the same structural order `vacancies()` uses. `memberId` is the occupant, or null.
- **Counts**: only enabled assignments count. `positionCount` is their positions, `filledCount` the occupied ones, and `vacantCount = positionCount − filledCount`. This must agree with `vacancyCountsByBoardGroup` (tested).
- **`changeCount`**: `diffBoards(baseline, board)` entries attributed to this board group.
  - `callings` and `addedPositions` are attributed through `rootBoardGroupOf(board, board.assignments[assignmentId].groupId)`.
  - `releases` and `removedPositions` are attributed through the same lookup on `baseline`.
  - Each entry counts once.
- **`proposed`** on a leader: true when the leader's `positionId` is in `diff.callings` (proposal boards only).
- Pure, no I/O. Add one export line to `packages/core/src/derive/index.ts`.

### Web: `apps/web/src/features/ward-overview/`
- **Component**: `WardOverview.tsx` exports `<WardOverview board ward baseline selectedId? />`. It renders a grid of tiles. Each tile is an element with `data-zoom-target="org:<boardGroupId>"`, `aria-label="<name>"`, and these contents:
  - The name as a heading (`h2`).
  - The leaders. Each leader is a small avatar using `initials`/`avatarColor` from `design/person.ts`, plus a short name (`displayName`) and the title. A vacant leader is a dashed circle with the text "Vacant" and the title. A proposed leader shows the text "+ Proposed" as well as the proposed color.
  - The text "<vacantCount> vacant" in vacancy style. When `vacantCount` is 0, it shows "No vacancies".
  - The text "<positionCount> positions · <filledCount> filled".
  - When `changeCount > 0`, a chip with the text "<changeCount> proposed" (`Chip` variant `proposed`). When it is 0, no chip.
  - When `selectedId` matches, a 2 px accent border **and** `aria-current="true"` (never color alone).
- **Layout**: CSS grid, 4 columns at ≥1280 px, 3 columns at ≥960 px, 2 below that. Tile text uses tokens only. At 1920×1080 (TV), tile names are ≥20 px. The view never causes horizontal page scroll.
- **Preview**: `preview.tsx` default-exports `{ title: 'Ward overview', render }`. It renders the proposal board with its baseline, and below that the Current board (baseline null), each under a heading ("Proposal: <name>", "Current").

## Scope
May change:
- `packages/core/src/derive/overview.ts` (new), `packages/core/src/derive/index.ts` (one export line), `packages/core/test/derive/overview.test.ts` (new)
- `apps/web/src/features/ward-overview/**` (new)
- `apps/web/e2e/gui/ward-overview.capture.ts` (new)

Must not change:
- Other `packages/core/**` files, `apps/web/src/App.tsx`, `main.tsx`, `apps/web/src/design/**`, `apps/web/src/preview/**`, `apps/web/src/features/canvas/**`, `apps/server/**`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Core | `pnpm --filter @wardboard/core exec vitest run test/derive/overview.test.ts` | all pass |
| 2 | Component | `pnpm --filter @wardboard/web exec vitest run src/features/ward-overview` | all pass |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | `gui-artifacts/ward-overview/desktop-chromium.png` and `tv-chromium.png`; inspected against artboard 1 per `docs/gui-verification.md` |
| 4 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
`overview.test.ts` uses the fixture ward, built with core ops for each scenario.
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `one tile per visible board group in order` | `setBoardGroupVisible(false)` on one → tile gone; order follows `order` | hidden groups shown, or insertion order used |
| `leaders are prominent positions at any depth in structural order` | Aaronic Priesthood includes the quorum presidents nested below it | top-level-only search |
| `vacant leader has null memberId` | — | — |
| `counts ignore disabled assignments and match vacancyCountsByBoardGroup` | — | disabled positions counted as vacancies |
| `change count is zero with no baseline and for an unchanged proposal` | — | — |
| `release counts toward the board group it came from` | release a Primary teacher → Primary +1, others 0 | attributing releases via the proposal board (where the position may be gone) |
| `move across organizations counts in both` | move a Primary teacher to a Relief Society vacancy → Primary 1 (release), Relief Society 1 (calling) | — |
| `added and removed positions count` | `addListPosition` +1; `removePosition` of a vacant position +1 in its group | position changes ignored |
| `moving back cancels` | move, then move back → 0 | not using the net diff |
| `proposed leader flag` | placing someone into a vacant counselor seat → that leader `proposed: true` | — |

`WardOverview.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `each tile is a labeled org zoom target` | `data-zoom-target` = `org:<id>`, accessible name = the org name | missing hook for the canvas |
| `vacant leaders say Vacant` | — | color-only vacancy |
| `vacancy and position counts render as text` | — | — |
| `zero vacancies reads No vacancies` | — | "0 vacant" |
| `proposed chip only when changes exist` | — | "0 proposed" chip |
| `proposed leader shows + Proposed text` | — | color-only |
| `selected tile has aria-current` | — | color-only selection |

## Edge cases (each needs a test)
- A board group with no positions: 0/0, "No vacancies", no leaders, and it still renders.
- All board groups hidden: the grid shows the text "No organizations are shown."
- `baseline` null: no proposed chips or markers anywhere.

## GUI verification
Required. Capture `/__preview/ward-overview` at desktop and TV. Phone does not apply: phones get their own screens in T-047+. Still check one phone capture for no horizontal scroll. Check against artboard 1:
- Tiles are readable.
- Leaders don't overflow their tiles.
- Vacancy text is visible and labeled.
- Proposed chips appear only where changes exist.
- On TV, names are readable at 1920×1080.

## Human checks
- On the office TV, open the preview and judge from the meeting table whether tile names and vacancy counts are readable.

## Out of scope
- Mounting inside the canvas or shell (T-030).
- Drag of leaders (T-035).
- The status strip and dugout panel (T-030 and T-036).
- Removed markers (T-040).
- Real photos.
