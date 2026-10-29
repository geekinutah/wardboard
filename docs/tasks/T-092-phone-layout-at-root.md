# T-092: Phone layout at the app root, with the Board tab

**Milestone:** 5 — Phone
**Depends on:** T-047 (phone shell), T-048 (phone board), T-071 (session and baseline sync), T-079 (Start proposal in the app). All done.
- Runs in parallel with T-093 (person photo) and T-061 (collector). T-093 does not edit any existing e2e file or the files listed here. If both change `apps/web/src/shell/PersonPanel.tsx`, that is a scope violation by this task: this task must not touch it.

**Spec refs:** SPEC.md §12 (phones get their own interaction model, bottom navigation Board/Search/Dugout/Changes, a sheet switches boards and starts proposals; phone edits appear on other clients in real time), §16 milestone 5. Artboards `docs/design/ui-canvas/PhoneHome.dc.html`, `PhoneTabs.dc.html`, `PhoneOrg.dc.html`. `docs/gui-verification.md` (phone viewport 390 × 844).

**Decision Mike approved on 2026-10-28:** existing e2e specs and GUI captures that drive the desktop shell at `/` keep running on the phone projects by loading `/?layout=desktop`. That one-line change per file is the only edit to existing tests this task may make.

## Goal
On a narrow screen (≤ 640px wide), `/` shows the phone layout: the T-047 phone shell with live boards from sync, the board switcher, Start proposal, and the T-048 Board tab showing the open board read-only. Wider screens see the desktop shell unchanged. `?layout=desktop`, `?layout=phone` and `?layout=auto` override the choice for the browser tab. Search, Dugout and Changes show a short placeholder until T-095 and T-096 wire them.

## Design decisions (binding)

### Choosing the layout (`apps/web/src/shell/layout.ts`, pure)
```ts
export type Layout = 'phone' | 'desktop';
export const LAYOUT_STORAGE_KEY = 'wardboard.layout';
export const PHONE_MEDIA_QUERY = '(max-width: 640px)';

export function layoutOverride(
  search: string,          // window.location.search, e.g. '?layout=desktop'
  stored: string | null,   // sessionStorage value
): { override: Layout | null; persist: Layout | 'clear' | 'keep' };

export function chooseLayout(override: Layout | null, narrow: boolean): Layout;
```
- `layout=desktop` → `{ override: 'desktop', persist: 'desktop' }`; `layout=phone` likewise.
- `layout=auto` → `{ override: null, persist: 'clear' }`.
- No `layout` parameter or any other value (case-sensitive, so `Desktop` is "other"): use `stored` if it is exactly `'desktop'` or `'phone'` → `{ override: stored, persist: 'keep' }`, otherwise `{ override: null, persist: 'keep' }`.
- When `layout` repeats, the first value wins (`URLSearchParams.get`).
- `chooseLayout`: the override if non-null, else `'phone'` when `narrow`, else `'desktop'`.

### Hook (`apps/web/src/shell/useLayout.ts`)
`useLayout(): Layout` reads the search and `sessionStorage` once on mount and applies `persist` (`setItem`/`removeItem`). It follows `matchMedia(PHONE_MEDIA_QUERY)` and its `change` events. When `window.matchMedia` is undefined (jsdom), `narrow` is `false`. Any `sessionStorage` exception counts as `stored = null` and skips the write. **Amended 2026-10-28 (round 1 blocker):** after reading it, when the URL has a `layout` parameter, remove only that parameter with `history.replaceState` (keep the path, every other parameter, and the hash; push no history entry). Existing specs that load `/?layout=desktop` then see `/` again, as their assertions expect (for example `settings-route.spec.ts`'s Back check). The override still lives in `sessionStorage`, so reloads and in-app navigation keep it.

### App (`apps/web/src/App.tsx`)
`/__gallery` is unchanged. `/settings` renders `SettingsRoute` in either layout. Otherwise, `'phone'` renders `<PhoneApp />` and `'desktop'` renders `<BoardShell />`, both inside the same single `SyncProvider`. Do not change `BoardShell.tsx`.

### `PhoneApp` (`apps/web/src/shell/PhoneApp.tsx`)
Uses `useSync`, `useMe`, `useBaseline`, `useCurrentBoard`, and `useRemovedState` (from `board-levels.tsx`).
- On the first `boards` with a non-null `current`, if nothing is subscribed, `open(boards.current.boardId)` once (same rule as `BoardShell`).
- `PhoneShell` props:
  - `boards`: Current first (`kind 'current'`, name `Current`, status `current`, `importedAt` from `boards.current`, counts 0), then proposals sorted by `tabOrder` then `id` (`kind 'proposal'`, `id` = the proposal's `boardId`, `status` draft/accepted, `importedAt` null). For the **subscribed** proposal, `changeCount` = `changeCount(diffBoards(baseline, board))` when the baseline is loaded, and `removedCount` = removed members + removed positions from `useRemovedState`. Every other proposal (or a subscribed one whose baseline isn't loaded) gets `null` for both.
  - `activeBoardId`: `subscribedBoardId ?? ''`.
  - `summary`: `headerSummary` with `kind 'proposal'` and the diff's callings/releases when on a proposal with its baseline loaded. Otherwise `kind 'current'`. `vacant` = `vacancies(board).length` (0 before the board loads).
  - `dugoutCount`: `dugout(board, ward).length`, or 0 before both load.
  - `canStartProposal`: `me !== null`. `onStartProposal` opens the existing `<StartProposal>` (from `StartProposal.tsx`, unchanged) with `isOpen` true. Its own close/create handling applies.
  - `onSelectBoard(id)`: `open(id)`, and reset the Board tab to its organization list.
  - `activeTab`: local state, initially `'board'`.
- Children, under `<SyncBanner />`:
  - Board tab: when board and ward are loaded, `<PhoneBoard key={subscribedBoardId} board baseline ward editable={false} … />` with no-op `onAddPosition`, `onOpenPerson`, `onOpenVacancy` (T-094 wires them). Before that, `<p>Loading board…</p>`.
  - Search, Dugout, Changes: `<section aria-labelledby>` with an `<h2>` naming the tab, the sentence `This screen isn't on phones yet.`, and a link `Use desktop layout` with `href="/?layout=desktop"`. The link must be at least 44px tall.
- No drag and drop, canvas, `EditingLayer` or `PersonPanel` in the phone layout.

### Phone shell summary (`apps/web/src/features/phone-shell/summary.ts`)
`BoardEntry.changeCount` and `removedCount` become `number | null`. `switcherSubtitle` for a proposal with `changeCount === null` returns `Draft` or `Accepted`. `removedCount === null` adds no removed part. Every existing output for numeric counts is unchanged, and the existing tests pass unmodified. `PhoneShell.tsx` changes only if TypeScript requires it, and its existing tests pass unmodified.

### Existing e2e files
In each existing file under `apps/web/e2e/` (specs and `gui/` captures) that calls `page.goto('/')`, change that call to `page.goto('/?layout=desktop')`, and change nothing else in the file. As of `origin/main` 99a76e6 these are 14 specs (`accepted-mode`, `board-shell`, `board-views`, `editing`, `out-of-unit-board`, `person-panel`, `present-mode`, `preview`, `settings-route`, `smoke`, `start-proposal`, `summary-mode`, `sync`, `tags-in-app`) and 13 captures (`accepted-mode`, `board-shell`, `board-views`, `editing`, `out-of-unit-board`, `person-panel`, `present-mode`, `settings-route`, `shell`, `start-proposal`, `summary-mode`, `sync`, `tags-in-app`). Re-check with `grep -rn "goto('/')" apps/web/e2e` after rebasing. `/settings` and `/__preview` loads are not changed. If any of those specs still fails after this change, stop and report it; do not edit further.

## Scope
May change:
- `apps/web/src/App.tsx`
- `apps/web/src/shell/layout.ts`, `layout.test.ts`, `useLayout.ts`, `useLayout.test.tsx`, `PhoneApp.tsx`, `phone-app.test.tsx`, `phone-app.css` (all new)
- `apps/web/src/features/phone-shell/summary.ts`, `summary.test.ts` (new cases appended only), `PhoneShell.tsx` (types only, if needed)
- the `page.goto('/')` lines in existing `apps/web/e2e/*.spec.ts` and `apps/web/e2e/gui/*.capture.ts`, as above
- `apps/web/e2e/phone-app.spec.ts`, `apps/web/e2e/gui/phone-app.capture.ts` (new)

Must not change:
- `apps/web/src/shell/BoardShell.tsx`, `PersonPanel.tsx`, `StartProposal.tsx`, `SettingsRoute.tsx`, `board-levels.tsx`, the other phone feature folders, `apps/web/src/sync/**`, `apps/web/src/features/photos/**`, `apps/web/src/features/person/**`
- any other line of any existing test, `playwright.config.ts`, `package.json`, `scripts/**`, `docs/gui-verification.md`, `apps/server/**`, `packages/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/layout.test.ts src/shell/useLayout.test.tsx src/shell/phone-app.test.tsx src/features/phone-shell` | every test below passes, and the existing phone-shell tests pass unmodified |
| 2a | Existing e2e files edited only at `goto('/')` | `git diff -U0 --diff-filter=M origin/main...HEAD -- apps/web/e2e \| grep -E '^[-+][^-+]' \| grep -vE "^[-+]\s*await page\.goto\('/(\?layout=desktop)?'\);$"` | prints nothing |
| 2b | Existing unit tests untouched except appended summary cases | `git diff --diff-filter=M --name-only origin/main...HEAD -- 'apps/web/src/**/*.test.ts' 'apps/web/src/**/*.test.tsx'` then `git diff origin/main...HEAD -- apps/web/src/features/phone-shell/summary.test.ts \| grep -c '^-[^-]'` | the first lists at most `apps/web/src/features/phone-shell/summary.test.ts`; the second prints `0` |
| 3 | Phone app e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/phone-app.spec.ts` | passes on all four projects (tests that don't apply to a project skip with a reason) |
| 4 | Full e2e | `pnpm --filter web run test:e2e` | exits 0 |
| 5 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-app/` has `board-<project>.png`, `switcher-<project>.png`, `proposal-<project>.png` and `placeholder-<project>.png` for phone-chromium and phone-webkit, and `desktop-<project>.png` for desktop-chromium |
| 6 | Mutation | in a disposable worktree at the candidate, change `PHONE_MEDIA_QUERY` to `(max-width: 300px)` and run check 3 | the phone-project test `phone width opens the phone layout at /` fails; remove the worktree |
| 7 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 8 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `layout=desktop and layout=phone override and persist` | both values give the override and `persist` of that value | ignoring the param; not persisting |
| `layout=auto clears the stored override` | `{ override: null, persist: 'clear' }` even when stored is `desktop` | keeping the stored value |
| `stored value applies without a param` | stored `phone` → override `phone`, `keep`; stored `tablet` or null → null, `keep` | trusting any stored string |
| `unknown or differently cased values are ignored` | `?layout=Desktop` and `?layout=wide` fall back to stored | case-insensitive match |
| `first layout param wins` | `?layout=phone&layout=desktop` → phone | last-wins parsing |
| `chooseLayout prefers the override, then width` | the four combinations | width overriding an explicit choice |
| `useLayout follows the media query` | a stubbed `matchMedia` that flips `matches` and fires `change` switches the hook's result | reading width once |
| `useLayout without matchMedia is desktop` | jsdom without `matchMedia` → `desktop` | throwing |
| `useLayout removes the layout parameter from the address` | `/?layout=desktop&x=1#h` becomes `/?x=1#h` through `replaceState`, `history.length` is unchanged, and the stored override is `desktop` | leaving the parameter (breaks the existing settings Back check); dropping other parameters; `pushState` |
| `useLayout survives a sessionStorage error` | a `getItem` that throws still yields the width layout and no exception | unguarded storage |
| `phone app opens Current and lists boards` | after `boards` arrives, the shell heading is `Current`, the switcher lists Current then proposals by `tabOrder`, and `open` was called once with Current's board id | not opening; desktop tab order ignored |
| `subscribed proposal shows its counts; others show status only` | the active proposal's switcher subtitle shows its change count; another Draft shows `Draft` | computing counts from the wrong board; showing `No changes` for an unloaded proposal |
| `header summary uses the diff on a proposal` | text matches `headerSummary` for the fixture's callings, releases and vacancies | always the current-kind summary |
| `board tab renders the organization list read-only` | an organization name from the fixture is listed and no `Add position` button exists | `editable` true |
| `selecting a board opens it and returns to the list` | choosing a proposal in the sheet calls `open` with its board id and the Board tab shows the list | stale organization screen |
| `start proposal opens the dialog` | tapping Start proposal in the sheet shows the Start proposal dialog | no-op |
| `placeholder tabs link to the desktop layout` | Search shows `This screen isn't on phones yet.` and a link to `/?layout=desktop` | missing link |
| `switcher subtitle with unknown counts shows status only` | null counts → `Draft` / `Accepted`; numeric counts unchanged | `0 changes` for null |
| `app chooses PhoneApp or BoardShell` | with the hook returning phone, the bottom navigation `Board sections` renders; with desktop, the `Boards` tablist renders | always desktop |

Use the sync test helpers the existing shell tests use (read `BoardShell.test.tsx` and its helpers; do not modify them).

## e2e (`apps/web/e2e/phone-app.spec.ts`)
- `phone width opens the phone layout at /` (phone projects): `/` shows the `Board sections` navigation with Board, Search, `Dugout · n` and Changes, the heading `Current`, and an organization from the fixture (for example `Primary`). The desktop `Boards` tablist is absent. The page has no horizontal overflow.
- `the switcher opens a proposal` (phone projects): open the switcher, choose `Spring adjustments`, see the heading `Spring adjustments`, `PROPOSED`, and a summary matching `/\+\d+ callings? · −\d+ releases? · \d+ vacant/`. Read-only use of the fixture proposal is fine.
- `layout=desktop keeps the desktop shell after reload` (phone projects): `/?layout=desktop` shows the `Boards` tablist and the address becomes `/`. After `page.reload()` and after navigating to `/` in the same tab, it still does. `/?layout=auto` then shows the phone layout.
- `wide screens keep the desktop shell` (desktop-chromium, tv-chromium): `/` shows the `Boards` tablist and no `Board sections` navigation.
- `an edit on desktop updates the phone without reload` (phone-chromium only): the phone starts its own uniquely named proposal through the switcher's Start proposal (use `uniqueProposalName` from `e2e/support/proposals.ts`). A second browser context at the desktop viewport opens `/?layout=desktop`, selects that proposal's tab, and adds a member to the dugout through the person inspector's add-to-dugout action. The phone's `Dugout · n` label increases by one without a reload.

## GUI verification
Required. Capture `phone-app` on phone-chromium and phone-webkit: the Current board list (`board`), the open switcher sheet (`switcher`), `Spring adjustments` open (`proposal`), and the Search placeholder (`placeholder`). Capture `desktop-desktop-chromium.png` of `/` to show the desktop shell is unchanged. Look at the screenshots and compare them with `PhoneHome.dc.html` and `PhoneTabs.dc.html`. Fail on any of: horizontal scroll, bottom tabs overlapping content or hidden, the Start proposal dialog or the Current read-only bar clipped at 390px, the active tab shown only by color, or tap targets under 44px.

## Human checks
- iPhone (Safari), on the dev server or the Mac Studio: open `/`. Confirm the phone layout appears, the bottom tabs clear the home indicator, and the switcher sheet opens and closes comfortably with one thumb. Rotate to landscape and back, and confirm nothing breaks.
- iPhone: open `/?layout=desktop`, confirm the desktop board appears, then open `/?layout=auto` and confirm the phone layout returns.

## Out of scope
- Person and move sheets, add position on phone, and editing from the Board tab (T-094).
- Search and Dugout tabs (T-095), and the Changes tab and Accept (T-096).
- Settings on phone beyond `/settings` working as today.
- A visible layout toggle beyond the placeholder link.
- Photos on phone.
