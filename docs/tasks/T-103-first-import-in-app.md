# T-103: With no Current, the app opens the import workflow

**Milestone:** 6 — Import and photos
**Depends on:** T-102 (the first import creates Current on the server) and T-097 (the import screen in Settings). T-097 is done. **T-102 must be done before this task starts.**
- Promoted from B-061. Mike decided on 2026-10-29: "if there is no current, we should default to an import workflow."
- Runs alongside T-098 (photo bundle import), which edits `shell/SettingsRoute.tsx`. This task must not edit `SettingsRoute.tsx`, `PhoneApp.tsx`, `PhoneEditing.tsx`, `BoardShell.tsx` or `features/photos/**`.

**Spec refs:** SPEC.md §8, including the 2026-10-29 sentence T-102 adds ("When there is no Current board, WardBoard opens the import workflow, and the first import creates Current from the three reports"). Also §2/§10 (import is for Admins; Editors have no import routes) and §10 (phones have their own layout). Artboards `docs/design/ui-canvas/Import.dc.html` and `Settings.dc.html`.

## Goal
On a fresh install with no Current board, an Admin who opens `/` gets the import workflow instead of an empty board. They choose the three reports, review them, and create Current. The app then shows the new board without a reload. An Editor sees a short explanation instead. Once a Current exists, `/` behaves exactly as today.

## Design decisions (binding)

### Choosing the screen (`apps/web/src/App.tsx`)
- Inside `SyncProvider`, at every path except `SETTINGS_PATH`: when `boards !== null && boards.current === null`, render `<FirstImport />` in place of `PhoneApp`/`BoardShell`, for both layouts.
- While `boards` is null, keep today's behavior (each shell shows its own loading state).
- When `boards.current` becomes non-null, the normal shell renders, and it opens Current the way it does today.
- `/settings` is unchanged.
- Put the condition in a small hook or component inside the new `FirstImport.tsx`. The edit to `App.tsx` is only the branch that renders it.

### `apps/web/src/shell/FirstImport.tsx` (new)
- A page inside `<main>`, with h1 `Set up WardBoard`.
- **Admin** (`me.role === 'admin'`): the paragraph `There's no Current board yet. Import the ward's three LCR reports to create it.`, then `<ImportSection />` (the T-097 component, reused). It should fit the page at both desktop and 390px widths.
- **Editor:** the paragraph `WardBoard has no Current board yet. Ask an Admin to import the ward's reports.` No file inputs, and no `/api/import/` request.
- `me === null`: show `Loading…` (`role="status"`).

### `ImportSection.tsx` change
- When `boards.current === null`, the section no longer shows `Import needs an existing Current board.` It offers the sources step, and `ImportReview` gets `expectedVersion={0}`. When a Current exists, it uses `boards.current.version` as today.
- **Authorized test change.** The existing test `no Current shows the explanation` in `apps/web/src/shell/import-section.test.tsx` contradicts Mike's 2026-10-29 decision. Replace that one test with `no Current offers the first import with version 0` (see below). No other existing test may change.

### e2e server
- Add an optional parameter to `startCheckoutServer` in `apps/web/e2e/checkout-server.ts`: `startCheckoutServer(options?: { seed?: boolean })`, default `true`. With `seed: false`, it skips `seedFixtureWard`, so the data directory has no Current.
- The suite's global setup and every existing caller stay as they are.

## Scope
May change:
- `apps/web/src/App.tsx` (the branch only)
- `apps/web/src/shell/FirstImport.tsx`, `apps/web/src/shell/first-import.css`, `apps/web/src/shell/first-import.test.tsx` (new)
- `apps/web/src/shell/ImportSection.tsx` (the no-Current path only), `apps/web/src/shell/import-section.test.tsx` (replace the one test named above only)
- `apps/web/e2e/checkout-server.ts` (the optional `seed` option only)
- `apps/web/e2e/first-import.spec.ts`, `apps/web/e2e/gui/first-import.capture.ts` (new)

Must not change:
- every other existing test file (unit, e2e and capture)
- `SettingsRoute.tsx`, `BoardShell.tsx`, `PhoneApp.tsx`, `PhoneEditing.tsx`
- `apps/web/src/features/**`, `apps/web/src/sync/**`, `apps/server/**`, `packages/**`, `fixtures/**`, `scripts/**`
- `playwright.config.ts`, `global-setup.ts`, `package.json`, `docs/gui-verification.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/first-import.test.tsx src/shell/import-section.test.tsx src/shell/phone-app.test.tsx src/shell/BoardShell.test.tsx src/App.test.tsx` | every new test passes; every other existing test in those files passes unmodified |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/first-import.spec.ts` | passes on desktop-chromium and phone-chromium; the other projects skip with the reason `First import runs on one desktop and one phone engine` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/first-import/` has `setup`, `review`, `board` PNGs for `desktop-chromium` and `phone-chromium` |
| 4 | Mutation | in a disposable worktree at the candidate, make `App.tsx` skip the `FirstImport` branch, then run check 1 | `no Current opens the import workflow for an Admin` fails; remove the worktree |
| 5 | Only the authorized test changed | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints only `apps/web/src/shell/import-section.test.tsx`; and `git diff origin/main...HEAD -- apps/web/src/shell/import-section.test.tsx` shows only the one test replaced |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`first-import.test.tsx` uses the fake `WebSocketLike` + `SyncClient` pattern from `phone-app.test.tsx` (copy the helpers; don't import from it) and a fake `fetch`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `no Current opens the import workflow for an Admin` | `boards` with `current: null` and an Admin `me`: `/` shows h1 `Set up WardBoard` and the Import section's three file inputs, in both the phone and desktop layouts (mock `useLayout` as `phone-app.test.tsx` does) | still rendering the empty shell |
| `an Editor sees the explanation and no import` | Editor `me`: the Editor text shows; there are no file inputs; the fake `fetch` sees no `/api/import/` call | Editors offered the import |
| `the board appears when Current arrives` | after a `boards` message with a non-null `current`, the setup page is gone and the shell renders and subscribes to Current | stuck on the setup page |
| `a loaded Current never shows the setup page` | with `current` present from the start, no `Set up WardBoard` | wrong condition |
| `Settings stays reachable without a Current` | at `/settings` with no Current, the Settings page renders, not the setup page | branch applied to every path |
| `no Current offers the first import with version 0` (replaces the old test in `import-section.test.tsx`) | with `current: null`: the inputs show; preview, then replace sends `expectedVersion: 0` | keeping the old message; sending `undefined` |

## Edge cases (each needs a test)
Covered above: Admin, Editor, `me` still loading (add `shows Loading until me arrives` in `first-import.test.tsx`), Current arriving, an existing Current, the Settings path.

## e2e (`apps/web/e2e/first-import.spec.ts`)
Runs on desktop-chromium and phone-chromium.
- In `test.beforeAll`, start `startCheckoutServer({ seed: false })`; stop it in `test.afterAll`. Use absolute URLs from `server.url`.
- Use the fictional `fixtures/lcr-reports/` PDFs, attached with `setInputFiles`.

Steps:
1. Open `/`. The page shows `Set up WardBoard` and the import inputs, not a board.
2. Attach the three PDFs and press Preview import. Resolve every row with real clicks: each person is new on an empty ward, and choose a category where it is asked.
3. Replace Current. The setup page gives way to the board without a reload: on the phone, the phone shell with `Current`; on desktop, the desktop shell with the Current tab.
4. desktop-chromium only: a second page opened at `/` before step 3 also leaves the setup page and shows the board without reloading.

Assert no horizontal overflow on phone-chromium at each step.

## GUI verification
Required (`docs/gui-verification.md`) on desktop-chromium and phone-chromium. Capture three screens:
- the setup page with the three files chosen (`setup`)
- the review (`review`)
- the board after the first import (`board`)

Compare with `Import.dc.html` and `Settings.dc.html`. Fail on:
- horizontal scroll at 390px
- controls under 44px
- the setup heading or text clipped
- a blank or stuck screen after the import

## Human checks
- On a fresh, disposable data directory (never the real one): start the server and open `/` in desktop Chrome as the Admin. Import the three fixture PDFs, create Current, and confirm the setup reads clearly and lands on the board.
- Open `/` on a phone during setup and confirm it reads well there too.

## Out of scope
- Server changes (T-102).
- Seeding handbook default groups or oversight (B-054).
- Bulk-resolving identity rows (B-062).
- Changing `ImportReview` or the Settings page.
