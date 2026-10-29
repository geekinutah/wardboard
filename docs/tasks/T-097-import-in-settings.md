# T-097: Import screen in Settings

**Milestone:** 6 — Import and photos
**Depends on:** T-059 (import preview UI), T-058 (import replace on the server), T-080 (Settings page). All done.
- Runs in parallel with T-094 (phone sheets) and T-100 (portraits on cards). It must not edit any file they list. In particular, not `shell/PhoneApp.tsx`, `features/phone-*/**`, `features/dnd/**`, `design/**`, or any board view.

**Spec refs:** SPEC.md §8 (import is a deliberate replacement of Current: upload, allow-list before persistence, preview including ambiguous identities, explicit confirmation, atomic replacement; a failed import leaves the old Current intact; the three PDF report routes are the primary roster inputs; namesakes are never silently merged). §15 (the three report routes; discarded fields never reach storage, logs or backups). §2/§10 (Admins vs Editors; the import routes are Admin-only on the server). Artboard `docs/design/ui-canvas/Import.dc.html`, `Settings.dc.html`.

## Goal
On `/settings`, an Admin sees an **Import** section. They choose the three LCR report PDFs, press **Preview import**, review the T-059 preview, resolve the identities and replace Current, all in the app. Every open board updates through sync. Editors don't see the section, and their client never calls the import routes.

## Design decisions (binding)

### Wiring (`apps/web/src/shell/ImportSection.tsx`, new)
- `SettingsRoute.tsx` passes `extra={<><TagLibrarySection />{isAdmin ? <ImportSection /> : null}</>}`. No other change to `SettingsRoute.tsx`.
- `ImportSection` is a `<section aria-labelledby>` with heading `Import` (h2, styled like the Tags section) and the note `Replace Current with the three LCR reports. Nothing changes until you confirm.`
- **Sources step:** three labelled file inputs, each `accept="application/pdf,.pdf"`, with exactly these labels: `Organizations and callings`, `Members without callings`, `Out-of-unit callings`. After a pick, the chosen file name shows next to its label. A `Preview import` button is disabled until all three are chosen.
- **Preview:** on press, `readReportFiles({ organizations, withoutCallings, outOfUnit })`, then `postImportPreview(fetch, encoded)`. While waiting, the button shows `Reading reports…` and is disabled. Keep the encoded strings in component state only for the replace call; never log them or the file names.
- **Failure messages** (`role="alert"`, the sources step stays so the Admin can pick again): `forbidden` → `Only admins can import.`; `too_large` → `Those files are too large to import.`; `bad_request` → `Those files couldn't be read as the three LCR reports.`; `offline` → `The import couldn't reach the server.` A file the browser can't read (rejected `readReportFiles`) → the `bad_request` message.
- **Review:** on success, render `<ImportReview preview={…} expectedVersion={boards.current.version} onReplace={…} />` from `useSync()`. `onReplace({ expectedVersion, resolutions })` calls `postImportReplace(fetch, { ...encoded, expectedVersion, resolutions })` and returns its result unchanged, so `ImportReview` shows its own success and failure text. Use `window.fetch` bound, injectable through an optional `fetchImpl` prop for tests.
- A `Start over` button (visible on the review step) clears the files, the encoded reports and the preview and returns to the sources step.
- **No Current yet:** when `boards` is loaded and `boards.current === null`, the section shows `Import needs an existing Current board.` and no file inputs (the server refuses a preview without one; see Notes).
- `ImportReview` and `features/import/client.ts`/`plan.ts` are used as they are. Their files, tests and preview are not changed.

## Scope
May change:
- `apps/web/src/shell/SettingsRoute.tsx` (the `extra` line only)
- `apps/web/src/shell/ImportSection.tsx`, `apps/web/src/shell/import-section.css`, `apps/web/src/shell/import-section.test.tsx` (new)
- `apps/web/e2e/import-settings.spec.ts`, `apps/web/e2e/gui/import-settings.capture.ts` (new)

Must not change:
- every existing test file (unit, e2e and capture), `apps/web/src/features/import/**`, `apps/web/src/features/settings/**`, `TagLibrarySection.tsx`, `App.tsx`, `BoardShell.tsx`, `PhoneApp.tsx`, `apps/web/src/sync/**`, `apps/server/**`, `packages/**`, `fixtures/**`, `scripts/**`, `playwright.config.ts`, `package.json`, `docs/gui-verification.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/import-section.test.tsx src/shell/settings-route.test.tsx src/features/import` | every new test below passes; the existing settings-route and import tests pass unmodified |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/import-settings.spec.ts` | passes on desktop-chromium and phone-chromium; the other projects skip with the reason `Import in Settings runs on one desktop and one phone engine` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/import-settings/` has `sources`, `review`, `replaced` PNGs for `desktop-chromium` and `phone-chromium` |
| 4 | Mutation | in a disposable worktree at the candidate, make `SettingsRoute` render `<ImportSection />` for every signed-in user, then run check 1 | `Editors don't see the import section` fails; remove the worktree |
| 5 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
In `import-section.test.tsx`, using the fake `WebSocketLike` + `SyncClient` pattern from `settings-route.test.tsx` (copy helpers; don't edit or import that test file) and a fake `fetch` that records calls. Use tiny fictional `File` objects; no real PDFs in unit tests.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Admins see the import section on Settings` | as an Admin, `/settings` shows heading `Import` and the three labelled file inputs | section not mounted |
| `Editors don't see the import section` | as an Editor, no `Import` heading or file inputs, and the fake `fetch` sees no `/api/import/` call | gating missing |
| `Preview stays disabled until all three reports are chosen` | disabled with 0, 1 and 2 files; enabled with 3 | enabling on the first file |
| `Preview posts the three encoded reports` | fake `fetch` receives one `POST /api/import/preview` whose JSON body has exactly `organizations`, `withoutCallings`, `outOfUnit` as the base64 of each file's bytes, in the right fields | files swapped between fields; raw text |
| `a preview opens the review with the Current version` | a 200 preview renders `Review before replacing Current`; replacing sends `expectedVersion` equal to `boards.current.version` from the sync snapshot | hard-coded or missing version |
| `replace sends the same reports and the resolutions` | after resolving the rows, the replace call's body has the same three strings as the preview, plus `expectedVersion` and `resolutions` from the review | re-reading or dropping a report |
| `replace success shows ImportReview's message` | a 200 `{matched, created, removed}` shows `Replaced Current. Matched …` | result not returned to ImportReview |
| `a stale replace shows the new version` | 409 `{ error: 'stale', currentVersion: 9 }` shows `Current changed. It is now version 9.` | swallowing the refusal |
| `each preview failure shows its message` | 403, 413, 400 and a throwing fetch each show their exact message and keep the file inputs | one generic message; losing the sources step |
| `an unreadable file shows the read failure` | a `File` whose `arrayBuffer` rejects shows `Those files couldn't be read as the three LCR reports.` and makes no fetch | unhandled rejection |
| `Start over returns to the sources step` | from the review, `Start over` shows the empty inputs and a disabled Preview | stale preview kept |
| `no Current shows the explanation` | with `boards.current === null`, the section shows `Import needs an existing Current board.` and no inputs | offering an import that can only fail |
| `the reports never reach the console` | spying on `console.log/info/warn/error` through a preview and replace, no call includes a report string or file name | debug logging of uploads |

## Edge cases (each needs a test)
Covered above: Editor, fewer than three files, each preview failure, unreadable file, stale replace, no Current, start over.

## e2e (`apps/web/e2e/import-settings.spec.ts`)
Runs on desktop-chromium and phone-chromium. Replacing Current would break the other specs that share the suite's server, so this spec starts **its own** server: call `startCheckoutServer()` from `e2e/checkout-server.ts` in `test.beforeAll`, stop it in `test.afterAll`, and load `${server.url}/settings` (absolute URL). Read the PDFs from `fixtures/lcr-reports/` (fictional; see its README) and attach them with `setInputFiles`.
1. Open Settings as the seeded Admin; the Import section shows. Attach the three PDFs; press Preview import.
2. The review shows; resolve every row the preview asks about using real clicks (match or treat as new as the rows allow).
3. Replace Current. `Replaced Current. Matched …` shows.
4. desktop-chromium only: a second page on the same server, opened at `/?layout=desktop` before step 3, shows Current's new import date after step 3 without reloading.
5. Assert no horizontal overflow on phone-chromium on each step.

## GUI verification
Required (`docs/gui-verification.md`) on desktop-chromium and phone-chromium: the sources step with three files chosen, the review step, the replaced message. Compare with `Import.dc.html` and the Settings page in `Settings.dc.html`. Fail on: horizontal scroll at 390px, file inputs or the Preview button under 44px, the review overflowing the Settings column, or an error that is shown only by color.

## Human checks
- Desktop Chrome, on a disposable data directory (not the real one): import the three fixture PDFs from `fixtures/lcr-reports/`, resolve the identities, replace Current, and confirm the flow reads clearly and the board shows the new import date.

## Out of scope
- Importing when there is no Current yet (server change; reported as a backlog candidate).
- Photo bundles (T-098) and the import guide (T-099).
- Changing `ImportReview`, the import client, the preview JSON or the server routes (B-054, B-055, B-056 stay open).
- A dedicated `/import` route or a link from the board header.

## Notes
- The server returns 400 for a preview with no Current (`apps/server/src/import/http.ts`, `planCurrent`). Report anything else you find under Notes / blockers.
