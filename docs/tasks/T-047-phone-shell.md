# T-047: Phone shell and board switcher

**Milestone:** 5 — Phone
**Depends on:** T-030 (app shell), T-004 (design components), T-070 (preview harness), T-016 (net diff), T-008 (derived views). All `done`.
- Standalone preview, like the desktop feature tasks. It does **not** change `App.tsx` or choose the phone layout by viewport width: the existing phone-viewport e2e tests (`board-shell.spec.ts`, `smoke.spec.ts`, `sync.spec.ts`) load `/` and expect the desktop shell, and tests may not be changed. Switching `/` to the phone shell at phone widths, with those tests updated by contract, is a later integration task.
- **Location change from PLAN:** the preview harness only discovers `apps/web/src/features/*/preview.tsx`, so the phone shell lives in `apps/web/src/features/phone-shell/` (not `apps/web/src/phone/shell/`). Later phone tasks follow the same `features/phone-*` pattern. PLAN.md is updated to match.
- No shared files with in-flight T-037, T-040, T-041, T-042, T-046 or the importer tasks.

**Spec refs:**
- SPEC.md §10 Devices: phone layout with bottom tabs; the same operations as desktop; tap rather than drag.
- SPEC.md §3: Current is read-only with its import date shown prominently; proposals are shared tabs; **Start proposal** creates a proposal (never a drag). Switching boards is local to each user (§7 LocalViewState, §12 "Active-tab selection and zoom remain local to each user/client").
- `docs/design/README.md` rows 19–25 and artboards `PhoneHome.dc.html` (header + bottom tabs) and `PhoneTabs.dc.html` (board switcher sheet, artboard 25).

## Goal
`<PhoneShell>` is the phone frame: a header naming the active board with its status and a one-line summary, a board switcher sheet listing Current and every proposal with **Start proposal**, and four bottom tabs (Board, Search, Dugout, Changes) with counts. The content of each tab is passed in as children. A preview at `/__preview/phone-shell` renders it with the fixture ward. Nothing is sent to the server.

## Design decisions (binding)

### Pure helpers (`apps/web/src/features/phone-shell/summary.ts`)
```ts
export type BoardEntry = {
  id: string;
  kind: 'current' | 'proposal';
  name: string;                      // 'Current' for the current board
  status: 'current' | 'draft' | 'accepted';
  importedAt: string | null;         // current only; ISO
  changeCount: number;               // proposals: net calling + release + added/removed position entries; current: 0
  removedCount: number;              // proposals: affected removed members + positions; current: 0
};
export function changeCount(diff: NetDiff): number;   // callings + releases + addedPositions + removedPositions lengths
export function headerSummary(input: { kind: 'current' | 'proposal'; callings: number; releases: number; vacant: number }): string;
export function switcherSubtitle(entry: BoardEntry): string;
```
- `headerSummary` for a proposal: `+{c} calling(s) · −{r} release(s) · {v} vacant` using `calling`/`release` when the number is 1 (U+2212 minus sign before releases). For Current: `{v} vacant`.
- `switcherSubtitle` for Current: `Read-only · imported {MMM D}` (`Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })`), or `Read-only` when `importedAt` is null. For a proposal: parts joined with ` · `: `Accepted` first if accepted; then `No changes` / `1 change` / `{n} changes`; then `1 removed item` / `{n} removed items` only when `removedCount > 0`.

### `apps/web/src/features/phone-shell/PhoneShell.tsx`
`<PhoneShell boards activeBoardId summary activeTab onTabChange dugoutCount onSelectBoard onStartProposal canStartProposal children />`:
- `boards: readonly BoardEntry[]` (exactly one `kind: 'current'`; proposals in tab order as given)
- `activeBoardId: string`; `summary: string` (from `headerSummary`)
- `activeTab: 'board' | 'search' | 'dugout' | 'changes'`; `onTabChange(tab)`
- `dugoutCount: number`
- `onSelectBoard(id: string)`, `onStartProposal()`, `canStartProposal: boolean`
- `children: ReactNode` — the active tab's content

**Header** (`<header>`): a status label as text — `CURRENT`, `PROPOSED` (draft) or `ACCEPTED` — then the active board's name as the h1, then `summary`. The name is inside a button with accessible name `Switch board, current board {name}` that opens the switcher. If `activeBoardId` is not in `boards`, show the name `Unknown board`, no status, and still allow switching (no throw).

**Bottom tabs**: `<nav aria-label="Board sections">` fixed to the bottom of the viewport, four buttons in this order with visible labels `Board`, `Search`, `Dugout · {dugoutCount}`, and `Changes · {active proposal changeCount}` (just `Changes` when the active board is Current or unknown). The active tab has `aria-current="page"` and a non-color indicator (bold label plus a top bar). Clicking a tab calls `onTabChange` with its key. Each tab is at least 44px tall and the four together fit 390px with no horizontal scroll. The content area reserves bottom padding so the last content row is never hidden behind the tabs, and respects `env(safe-area-inset-bottom)`.

**Switcher sheet**: `role="dialog"` `aria-modal="true"` labelled by heading `Boards`. Focus moves into it on open and returns to the header button on close.
- A `Current` option (button) with `switcherSubtitle`.
- Heading `Proposals`, then one option per proposal with its name and `switcherSubtitle`. With no proposals: `No proposals yet.`
- The active board's option has `aria-current="page"` and a visible `Viewing` text label.
- Choosing an option calls `onSelectBoard(id)` once and closes the sheet. Choosing the already-active board just closes it (no call).
- `Start proposal` button (shown when `canStartProposal`) calls `onStartProposal()` and closes the sheet.
- Footnote text: `Each person picks their own board; switching here never changes anyone else's view.`
- A `Close` button and Escape close it without calling anything. Every option is at least 44px tall.

### Preview (`apps/web/src/features/phone-shell/preview.tsx`)
Default-exports `{ title: 'Phone shell', render }`. Using `data.current`, `data.proposal`, `data.ward`:
- Boards: Current (`importedAt: '2026-10-24T12:00:00Z'`), the fixture proposal (its name, draft, `changeCount(proposalDiff(proposal))`, `removedCount = state.members.length + state.positions.length` where `state = removedState(proposal, current, ward)`), and a second fictional proposal entry `Youth focus` (accepted, 0 changes) that reuses the current board as its content.
- Starts on the fixture proposal, Board tab. Header summary from `diffBoards`/`proposalDiff` and `vacancies(board).length`; `dugoutCount` from `dugout(board, ward).length`; all computed with core for the active board.
- Tab content is a placeholder paragraph naming the tab, e.g. `Board tab content`, and the board name (later phone tasks fill these).
- `onSelectBoard` switches the active board in React state. `onStartProposal` shows the text `Start proposal requested` (T-041 owns the dialog). `canStartProposal: true`.

## Scope
May change:
- `apps/web/src/features/phone-shell/**` (new)
- `apps/web/e2e/phone-shell.spec.ts`, `apps/web/e2e/gui/phone-shell.capture.ts` (new)

Must not change:
- `App.tsx`, `main.tsx`, `app.css`, `apps/web/src/shell/**`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component tests | `pnpm --filter @wardboard/web exec vitest run src/features/phone-shell` | all tests in `summary.test.ts` and `PhoneShell.test.tsx` pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `phone-shell.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-shell/` has phone Chromium and phone WebKit PNGs for the Board tab, the Changes tab, and the open switcher, plus desktop and TV PNGs of the same states; inspected against `PhoneHome.dc.html` and `PhoneTabs.dc.html` |
| 4 | Root app untouched | `git diff main --stat -- apps/web/src/App.tsx apps/web/src/main.tsx apps/web/src/preview` | empty output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `headerSummary pluralizes and uses a minus sign` (`summary.test.ts`) | `{proposal, 4, 3, 20}` → `+4 callings · −3 releases · 20 vacant`; `{proposal, 1, 1, 1}` → `+1 calling · −1 release · 1 vacant`; `{proposal, 0, 0, 0}` → `+0 callings · −0 releases · 0 vacant`; Current `{v: 20}` → `20 vacant` | always plural; hyphen instead of U+2212; Current shows changes |
| `changeCount sums all four diff lists` | a hand-built `NetDiff` with 2/1/1/1 entries → 5; empty → 0 | added/removed positions ignored |
| `switcherSubtitle covers Current, null import date, accepted, removed items` | `Read-only · imported Oct 24`; `Read-only`; `Accepted · 3 changes`; `7 changes · 2 removed items`; `1 change · 1 removed item`; `No changes` | local time zone; `0 removed items` shown; singular wrong |
| `header shows status text, board name and summary` (`PhoneShell.test.tsx`) | for draft, accepted, current: `PROPOSED` / `ACCEPTED` / `CURRENT` as text, h1 name, summary string | status as color only |
| `tabs show counts and mark the active tab` | `Dugout · 14`, `Changes · 7` on a proposal; `Changes` with no count on Current; `aria-current="page"` only on the active tab; clicking Search calls `onTabChange('search')` | count shown on Current; several tabs current |
| `switcher lists Current and proposals and marks the viewed board` | open via the header button: dialog `Boards`, Current with subtitle, proposals in given order, `Viewing` on the active one | order changed; active not marked |
| `choosing another board selects it once and closes` | click `Youth focus` → `onSelectBoard('…')` once; dialog gone; focus back on the header button | sheet stays open; double call; focus lost |
| `choosing the viewed board just closes` | no `onSelectBoard` call | redundant switch |
| `Start proposal calls back and closes; hidden when not allowed` | `canStartProposal` true/false | button shown when not allowed |
| `Close and Escape close without calling back` | both paths | Escape ignored |
| `no proposals shows the empty text` | boards = [Current] | empty heading only |
| `unknown active board id renders Unknown board without throwing` | `activeBoardId: 'b-missing'` | crash |
| `renders children for the active tab` | child text present | children dropped |

`e2e/phone-shell.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `switches boards through the sheet` | `/__preview/phone-shell`: tap the header button, tap `Current`, header shows `CURRENT` and `Current`, Changes tab has no count | preview not wired; taps not reaching the sheet on WebKit |
| `bottom tabs switch content and stay visible` | tap Dugout → `Dugout tab content`; the nav's bounding box bottom equals the viewport bottom (within 1px) and `document.documentElement.scrollWidth <= innerWidth` | tabs scroll away; horizontal overflow |

## Edge cases (each needs a test)
Covered above: no proposals, unknown active board, Current vs draft vs accepted, singular/plural/zero counts, null import date, removed count 0 vs >0, re-selecting the viewed board, Start proposal not allowed, Escape.

## GUI verification
Required. Capture `/__preview/phone-shell` at phone (Chromium and WebKit), desktop and TV: Board tab, Changes tab, and the open switcher. Compare with `PhoneHome.dc.html` and `PhoneTabs.dc.html`:
- Header status label, board name, summary line readable; tab labels fully visible with counts; active tab distinguishable without color.
- Switcher sheet fully on screen; options at least 44px; Start proposal visible; footnote visible.
- No horizontal scroll at 390 × 844; the tabs do not cover the last line of content.
- Desktop and TV captures only confirm nothing breaks at wide widths; the phone shell is not the desktop layout, so a narrow-looking frame there is not a defect.

## Human checks
- On an iPhone (after the later integration task mounts it): open WardBoard, confirm the bottom tabs sit above the home indicator, and that the board switcher sheet opens and closes comfortably with one thumb.

## Out of scope
- Choosing the phone layout at `/` by viewport width (later integration task; existing tests would need a contract change).
- The content of each tab: organization screens (T-048), person/move sheets (T-049), search and dugout (T-050), changes (T-051).
- The Start proposal dialog (T-041).
