# T-099: Import guide and operator prompt for the shipped collector

**Milestone:** 6 — Import and photos
**Depends on:** T-061 (directory photo collector) and T-098 (photo bundle import in Settings). Both done.
- Runs beside T-101. T-101 edits the phone shell. This task must not edit `apps/**`.

**Spec refs:** SPEC.md §15 (the shipped human guide matches the released collector: real launch commands, sign-in in the user's own browser, four PDF downloads, optional directory portraits, preview, confirm replace, cleanup). SPEC.md §15 (2026-10-30) (the Member List keeps name, youth/adult, and gender `M` or `F`; numeric age, birth date, phone, and email are discarded). The eight fenced operator sentences already in `docs/import/operator-prompt.md` stay verbatim and in order. Do not add the Member List to the "Limit acquisition" sentence; that sentence is locked by the existing test and by SPEC's shipped prompt text.

## Goal
`docs/import/guide.md` describes the import that exists today: four official PDFs replaced through the two HTTP commands, plus the shipped directory collector and the Settings handoff. The version line no longer says the collector is not shipped. The operator prompt points at that guide. The structural tests accept the real commands and reject an invented scraper. The guide stops saying gender is discarded.

## Design decisions (binding)

Documentation only. Application unit tests do not apply: no application behavior changes. The executable checks are `scripts/import-guide.test.mjs`, and the mutation below proves they catch a realistic defect (the collect command deleted from the guide).

### Version line
The first heading stays `# WardBoard import guide`. The next line is exactly:

`Version: four-PDF replace and directory photo collector.`

### What this version does
An admin can follow the guide with no model service. The four-PDF preview and replace stay. Directory portraits are optional. The command is the one in **Directory photos**. Direct upload in the app still works. Do not invent a different scraper or a command that downloads Church files. Delete the sentences that say directory photo collection is not shipped.

### Sign in
Keep the credentials sentence exactly: `Do not paste credentials into WardBoard, a collector, or a chat.`

### Directory photos
A new section, `## Directory photos`, after Sign in. It includes these lines exactly, each on its own line:

`pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging`

`pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging --resume`

`pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging --cleanup`

Also state, in prose:

- The collector opens a new Chromium window. The human signs in, including MFA. The collector never asks for, types, reads, or stores a password, cookie, or session. Press Enter when the household list is showing. Names never appear in the output.
- `--staging` is required and must be a folder outside any Git repository. The collector writes only inside `<dir>/wardboard-collector/`.
- `--resume` continues an interrupted collection in that same folder. A collection more than 7 days old cannot be resumed.
- `--headless` is for automated tests only. Do not use it for a real run.
- Exit codes: `0` success, `1` failed or cancelled, `2` bad arguments or a refused staging folder.
- The bundle is `manifest.json` plus portrait files named by the SHA-256 of their bytes. Household images are not portraits and are not downloaded.
- Handoff is the app, not a second CLI. In Settings, open **Directory photos**, select `manifest.json` and every portrait image, review the matches, and confirm namesakes. First photos apply immediately. An existing portrait is replaced one photo at a time. Then run the `--cleanup` command with the same staging folder. `--cleanup` deletes only what the collector created under `wardboard-collector/`.

### Four PDF sections
Keep the four download paths, the preview command (`organizations`, `withoutCallings`, `outOfUnit`, `memberList`, no `data:` URL), and the replace command (`expectedVersion`, `confirmReturn`). Keep `duplicate_report` and `inconsistentReports`.

Replace the Member List keep/discard sentence with the SPEC rule. The download section must include the exact phrase `gender (M or F)` and must say that only the name, the youth/adult category, and gender `M` or `F` are kept, while numeric age, birth date, phone, and email are discarded.

The discarded line keeps phone, email, address, birth date, age, record number, class rosters, and ministering. It must not contain the word `gender`.

In **Read the preview**, name `needsGender` among the JSON fields. In **Replace**, say that a key listed in `needsGender` needs `"gender": "M"` or `"gender": "F"` on its `new` resolution, beside `category` when that key is also in `needsCategory`. Do not guess. Leave the existing match and new-category shapes in place.

### Forbidden text
The guide contains no `TODO`, no `TBD`, no `<command>`, and no `npx wardboard-collector`. No fenced block contains `churchofjesuschrist.org`. Prose may say the human signs in to the Church directory in the window the collector opens. No fenced command opens a browser or scrapes.

### Operator prompt
Do not change the fenced block or the eight sentences in it. Above the fence, replace the "not shipped" paragraph with:

`The directory photo collector is documented in docs/import/guide.md, including pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging. The human PDF route in that guide is still the four downloads and the two HTTP commands. The agent follows that guide.`

That paragraph must not contain `not shipped`.

### Tests
Update `scripts/import-guide.test.mjs` in the same change. Keep `node:test` and `node:assert/strict`. Do not edit `scripts/verify.sh`. `node --test scripts/` already runs this file.

- Replace `the guide names this version and the missing collector` with `the guide names this version and the shipped collector`. Assert the heading and the exact version line above.
- Add `the guide names the collector commands`. Assert the three command lines as whole trimmed lines, not as substrings (the base command is a prefix of the resume and cleanup lines). Assert the guide includes `manifest.json`, `Directory photos`, `Names never appear`, and the exit codes `0`, `1`, and `2`.
- Change `the guide does not invent a collector command` so it still fails on `TODO`, `TBD`, `<command>`, and `npx wardboard-collector`, and also fails when a fenced block contains `churchofjesuschrist.org`. It must not fail merely because the guide contains `wardboard-collector`.
- Change `the operator prompt points at the manual guide` to `the operator prompt points at the shipped guide`. Above the fence: `docs/import/guide.md` is present, the base collect command is present, and `not shipped` is absent.
- Change `the guide lists the discarded fields` so `gender` is not required. Add `the guide keeps member gender`: the guide includes `gender (M or F)`, `needsGender`, `"gender": "M"`, and `"gender": "F"`, and the line that starts at `Discarded` does not include `gender`.
- Keep the credentials test, the four download paths, the preview fields, the replace command, `duplicate_report` / `inconsistentReports`, and `the operator prompt keeps the required sentences` with the eight sentences unchanged and in order.

## Scope
May change:
- `docs/import/guide.md`
- `docs/import/operator-prompt.md`
- `scripts/import-guide.test.mjs`

Must not change:
- `apps/**`, `packages/**`, `tools/**`, `scripts/verify.sh`, any other file under `scripts/`, `docs/tasks/**`, `SPEC.md`
- anything else

The in-app import guidance (`apps/web/src/shell/import-guidance.test.tsx`) forbids the word `collector` on the PDF import screen. Leave it. `tools/collector/README.md` still says bringing a bundle into WardBoard is not available; leave it (backlog B-073).

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests | `node --test scripts/import-guide.test.mjs` | `# fail 0`; every test named above passes |
| 2 | Red before green | run check 1 after the test file is updated and before the two docs are updated | the new assertions fail on the old version line `Directory collector: not shipped.`, the missing collect command, or the discarded-line word `gender`; record that output |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0, and under `node --test scripts/` the suite `import guide` reports `# fail 0` |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only the three May-change paths |
| 5 | Mutation | in a disposable worktree at the candidate, delete only the whole line `pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging` (leave the `--resume` and `--cleanup` lines), then run check 1 | `the guide names the collector commands` fails; remove the worktree |

The shell starts in the shared checkout. `cd` to this task's worktree first. Run at most one `./scripts/verify.sh` in that worktree.

## Unit tests to write
None. This task does not change application behavior. The structural checks in `scripts/import-guide.test.mjs` are the tests, and each one fails if the named sentence or command is missing or if a forbidden scraper command appears.

## Edge cases (each needs a test)
Covered by the structural checks: version line, credentials sentence, four downloads, preview and replace commands, duplicate and disagreement errors, discarded fields without gender, gender kept and `needsGender` documented, real collect/resume/cleanup lines, invented `npx wardboard-collector` / `TODO` / a Church URL inside a fence, operator sentences in order, and the prompt paragraph no longer saying `not shipped`.

## Human checks
none

## Out of scope
- Changing the collector, the Settings bundle screen, or the in-app PDF import copy.
- Editing the eight fenced operator sentences, including adding the Member List to "Limit acquisition".
- Product code, server import behavior, and tests outside `scripts/import-guide.test.mjs`.
