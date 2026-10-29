# T-061: Directory photo collector

**Milestone:** 6 — Import and photos
**Depends on:** T-060 (photo upload and comparison), done. T-058 and T-057 are done; they are not used here.
- No shared files with in-flight T-092 (`apps/web/src/App.tsx`, `apps/web/src/shell/`, phone-shell, `apps/web/e2e/`) or T-093 (`apps/web/src/features/person/`, `apps/web/src/features/photos/`, `apps/web/src/shell/PersonPanel.tsx`).

**Spec refs:** SPEC.md §14 "Confirmed photo input routes" (individual portraits only; household images are not portraits; collection reports missing photos and progress and tolerates interruption without duplicates), §15 "Required implementation contract" (deterministic, no LLM, user signs in in the browser, no credential/cookie/session export, configurable selectors and layout version, bounded retries, progress, cancellation, resumable), "Data collection and retention boundary" (private staging outside Git, no full-page snapshots or contact data, delete collector-created files only, bounded retention for interrupted runs), and "Verification required before shipping collectors" (canary credentials and personal fields that the checks must catch, no model SDK or model-service request, repeat runs produce equivalent output).

**Decisions Mike confirmed on 2026-10-28** (these settle the packaging that SPEC §14 left open):
1. A local command opens a fresh, non-persistent Playwright Chromium window. The user signs in there, including MFA. It never attaches to the user's everyday browser or profile. `playwright` is a runtime dependency of the collector.
2. Output is a staging bundle of names and portrait files only. The collector prints counts and statuses, never names.
3. Getting a bundle into WardBoard is a later task (T-098 in `docs/tasks/phone-integration-plan.md`). This task only produces the bundle.
4. Agents test only against a fictional directory served locally. The real directory's selectors are a best guess in config; Mike's first real run is a human check.

## Goal
`pnpm --filter @wardboard/collector run collect -- --staging <dir>` opens a Chromium window, waits for the user to sign in and press Enter, walks the configured directory's households, and writes `<dir>/wardboard-collector/bundle/manifest.json` plus one file per individual portrait. It skips household images, records members with no portrait, retries failed images a bounded number of times, can be interrupted and resumed without duplicates, cleans up only its own files, and never writes cookies, tokens, page HTML, screenshots, URLs, Church identifiers or contact details anywhere, including stdout and stderr.

## Design decisions (binding)

### Package
- New workspace package `tools/collector/`, name `@wardboard/collector`, `"private": true`, `"type": "module"`, TypeScript run the same way as `packages/importer` (read it and copy its tsconfig/eslint/vitest pattern).
- Runtime dependency: `playwright` at exactly `1.64.1`, the same version as `@playwright/test` in `apps/web`, so the browser binaries are shared. Dev dependency: `vitest` at the version `packages/importer` uses. No other dependencies.
- Scripts: `collect` (runs `src/cli.ts`), `test` = `playwright install chromium && vitest run` (the gate runs `pnpm -r test` before it installs browsers), `typecheck`, `lint`.
- The collector does not import from `apps/*`. It must not depend on, or call, any model SDK or AI service.

### CLI (`src/cli.ts`)
```
collect --staging <dir> [--config <file>] [--resume | --cleanup] [--headless]
```
- `--headless` runs Chromium without a window. It exists for tests and CI. The README says not to use it for a real run, because the user cannot sign in without a window.
- `--staging` is required. It is the user's chosen parent folder. The collector owns only `<dir>/wardboard-collector/` (the *work dir*) and creates it with mode `0700`.
- Refuse, exit code 2, and create nothing when `<dir>` or any parent of it contains `.git` (file or directory). Message: `Choose a staging folder outside any Git repository.`
- Refuse, exit code 2, when the work dir already exists and neither `--resume` nor `--cleanup` was given. Message: `A previous collection exists in this folder. Run again with --resume to continue it or --cleanup to delete it.`
- `--config` defaults to `tools/collector/config/directory.json` (below).
- Exit codes: 0 success, 1 collection failed (unsupported layout, cancelled), 2 bad arguments or refused staging.
- Ctrl-C (SIGINT) cancels. The state file is saved, the browser closes, and the message is `Collection cancelled. Run again with --resume to continue or --cleanup to delete what was collected.` Exit 1.

### Core function (`src/collect.ts`)
The CLI is a thin wrapper over one function that tests call directly. It is the same code path whether a person or an AI operator runs the CLI:
```ts
export type CollectOptions = {
  stagingDir: string;
  config: DirectoryConfig;
  mode: 'new' | 'resume';
  browser: { headless: boolean };
  waitForSignIn: (message: string) => Promise<void>; // CLI: print message, wait for Enter
  log: (line: string) => void;                       // CLI: stdout
  signal?: AbortSignal;                              // cancellation
  now?: () => Date;                                  // retention check
};
export function collect(options: CollectOptions): Promise<CollectResult>;
export function cleanup(stagingDir: string, log: (line: string) => void): Promise<CleanupResult>;
```
- It launches Chromium with `chromium.launch({ headless })` and `browser.newContext()`. It must never call `launchPersistentContext`, `storageState`, `context.cookies`, `addCookies`, `page.screenshot`, `page.content`, `page.pdf`, tracing, or video/HAR recording. Every page and image request goes through that context, so the user's session reaches the directory without the collector reading it.
- It opens `config.startUrl`, calls `waitForSignIn('Sign in to the directory in the browser window that opened, then press Enter here.')`, then collects.
- Images are fetched through the signed-in context (for example `context.request.get(src)` or an in-page `fetch`). The bytes are accepted only when they start with the JPEG (`FF D8 FF`) or PNG (`89 50 4E 47 0D 0A 1A 0A`) signature and are at most 5 MiB.

### Config (`config/directory.json`, validated by `src/config.ts`)
```json
{
  "layoutVersion": "directory-v1",
  "startUrl": "https://directory.churchofjesuschrist.org/",
  "selectors": {
    "householdList": "...",
    "householdLink": "...",
    "householdName": "...",
    "householdImage": "...",
    "memberEntry": "...",
    "memberName": "...",
    "memberPortrait": "...",
    "signedOut": "..."
  },
  "timeouts": { "navigationMs": 30000, "elementMs": 10000 },
  "retries": { "image": 2 }
}
```
- The shipped selectors are a best guess for the real directory. Comment this in a top-level `"_note"` string. The fictional test site uses its own config file under `test/fixtures/`.
- `startUrl` must be `https:`, or `http://127.0.0.1` / `http://localhost` (tests only). Each selector is a non-empty string, `retries.image` is an integer 0–5, and the timeouts are positive integers. Anything else fails with `Invalid collector config: <field>` and exit 2.
- If `householdList` is not found within `elementMs` after sign-in, fail with `Unsupported directory layout (expected directory-v1). Nothing was imported.` and exit 1. Do not guess.
- If `signedOut` matches at any point after sign-in, call `waitForSignIn('Sign-in expired. Sign in again in the browser window, then press Enter here.')` and then retry the current household from its start.

### What is collected
For each household, in the order the list shows them:
- Images matching `householdImage` are **never downloaded**. Count them as `skippedHousehold`.
- For each `memberEntry`: read `memberName` text (trim, collapse whitespace). If `memberPortrait` exists, fetch it. Success adds an entry. Failure after `1 + retries.image` attempts counts as `failed` and adds the name to `missing` with `reason: 'failed'`. No portrait element adds the name to `missing` with `reason: 'none'`.
- Read nothing else from the page: no attributes other than the portrait `src` (used only to fetch it and never written), and no addresses, phone numbers, email addresses, dates, or link URLs.

### Bundle (`<work dir>/bundle/`)
- Portrait files are named `<sha256 of bytes>.jpg` or `.png`. Identical bytes are written once.
- `manifest.json`, pretty-printed with two spaces and a trailing newline:
```json
{
  "format": "wardboard-photo-bundle",
  "version": 1,
  "layoutVersion": "directory-v1",
  "portraits": [{ "name": "Ada Fictional", "file": "<sha>.jpg", "duplicateName": false }],
  "missing": [{ "name": "Ben Example", "reason": "none" }],
  "skippedHousehold": 3
}
```
- `portraits` is sorted by `name` (`localeCompare` with `'en'`), then by `file`. `missing` is sorted by `name`, then by `reason`. When two portraits share a name, both are kept and both get `"duplicateName": true`.
- No timestamps, run ids, URLs, household names, or counts other than `skippedHousehold`. Two runs over the same site produce byte-identical `manifest.json` and identical file sets.

### Progress and log lines
Only counts and fixed text, for example `Households 3 of 12 · portraits 5 · missing 1 · failed 0 · household images skipped 2`. The final line is `Done. <n> portraits, <m> missing, <f> failed, <s> household images skipped. Bundle: <absolute bundle path>`. No member or household names, URLs, selector match text, or error bodies. An exception message from Playwright is not echoed; log `Image request failed` or `Page did not load` instead.

### Resume and state (`<work dir>/state.json`)
- Holds the layout version, the 0-based index of each completed household (never its name or URL), the collected portraits and missing entries so far, the files the collector created, and `startedAt` (ISO time from `now()`).
- It is rewritten atomically (write a temporary file in the work dir, then rename) after each household.
- `--resume` skips completed household indexes and finishes. The final bundle equals an uninterrupted run, with no duplicate portraits or missing entries.
- `--resume` on a state older than 7 days (by `now()`) refuses with `This collection is more than 7 days old. Run again with --cleanup to delete it.` and exit 2. A state with a different `layoutVersion` refuses with `This collection used a different directory layout. Run again with --cleanup to delete it.` and exit 2.

### Cleanup
- `--cleanup`, and the end of a successful run if the user later hands off the bundle (T-098), delete only the paths recorded in `state.json` (portrait files, `manifest.json`, `state.json`, temporary files), then remove `bundle/` and the work dir only if each is empty.
- Any other file in the work dir is left in place. The log line is `Left <n> files that the collector did not create in <work dir>.` with no file names.
- Files in the staging parent outside the work dir are never touched.
- A failed delete is reported as `Could not delete <n> files in <work dir>.` and exit 1.
- A successful collection does **not** delete the bundle. The bundle is the handoff.

### Documentation
`tools/collector/README.md`: what it does, the exact `collect` command with `--staging`, `--resume` and `--cleanup`, that Chromium opens and the user signs in themself, what the bundle contains, that names never appear in the output, that the selectors are unverified against the real directory, and that bringing a bundle into WardBoard is not available yet. Do **not** edit `docs/import/guide.md` or `docs/import/operator-prompt.md`; their structural tests require "not shipped" until T-099.

## Fictional test directory (`tools/collector/test/fixtures/` and `test/support/`)
A Node `http` server on an ephemeral `127.0.0.1` port, started and stopped by the tests. No real names, photos or URLs. It serves:
- `/signin?ok=1` sets the cookie `wb_session=CANARY-SESSION-7f3a91` (HttpOnly) and redirects to the household list. The test config's `startUrl` is that URL, so the session exists before `waitForSignIn` is called, and the tests' `waitForSignIn` simply resolves (and records its message). Nothing types into a form.
- The household list and household pages. Every page also carries canary personal data that must never leave the page: an address `CANARY-ADDR-1 Fictional Lane`, phone `CANARY-PHONE-555-0100`, email `canary-email@example.invalid`, birth date `CANARY-DOB-2001-01-01`, a link to `/member/CANARY-MRN-0001`, a `data-record` attribute `CANARY-MRN-0002`, and a hidden token `CANARY-TOKEN-x9`.
- At least 4 households, including: one with two members who have portraits (PNG and JPEG); one with a household image plus one member portrait; a member with no portrait; a member whose image returns 500 every time; a member whose image returns 500 once and then succeeds; two members in different households with the same name (`Cal Sample`) and different portraits; and two members whose portraits have identical bytes.
- Portrait and page requests without the `wb_session` cookie return 403, which proves that fetches use the signed-in context.
- A switch that makes the next page load show the `signedOut` element once, so the expired-session path can be tested.
- Portraits are tiny generated PNG/JPEG byte arrays built in the test support code. Do not commit image files of real people.

## Scope
May change:
- `tools/collector/**` (new)
- `pnpm-lock.yaml` (only for the new package)
- `docker/Dockerfile`: only if the runtime stage's `pnpm install --prod --frozen-lockfile` needs the collector's manifest. Then copy `tools/collector/package.json` like the other manifests, or filter that install to exclude the collector. The image must not contain `tools/collector/src`.

Must not change:
- `docs/import/**`, `apps/**`, `packages/**`, `scripts/**`, root `package.json`, `pnpm-workspace.yaml` (already includes `tools/*`), every existing test
- anything else

New dependencies allowed: `playwright@1.64.1` (runtime, collector only), `vitest` (dev, same version as `packages/importer`).

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Collector tests | `pnpm --filter @wardboard/collector test` | every test below passes |
| 2 | Typecheck and lint | `pnpm --filter @wardboard/collector typecheck && pnpm --filter @wardboard/collector lint` | both exit 0 |
| 3 | No model SDK, only allowed deps | `node -e "const p=require('./tools/collector/package.json');console.log(JSON.stringify({d:p.dependencies,dd:Object.keys(p.devDependencies)}))"` | `{"d":{"playwright":"1.64.1"},"dd":["vitest"]}` |
| 4 | Canary mutation | In a disposable worktree at the candidate, make the collector also write `await page.content()` for each household into the work dir, then run check 1 | `no canary value reaches staging, logs or the manifest` fails; remove the worktree |
| 5 | Session mutation | In a disposable worktree, make the collector write `JSON.stringify(await context.cookies())` into `state.json`, then run check 1 | `no canary value reaches staging, logs or the manifest` fails (and the forbidden-API check fails); remove the worktree |
| 6 | Cleanup mutation | In a disposable worktree, change cleanup to `rm` the whole staging parent recursively, then run check 1 | `cleanup removes only collector files` fails; remove the worktree |
| 7 | Docker image | `./scripts/verify.sh` (its docker smoke step) | the image builds and the smoke passes; `docker run --rm --entrypoint sh <image> -c 'test ! -e tools/collector/src'` exits 0 when run against the built image (record the command and output) |
| 8 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 9 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Tests run the real collector, headless, against the fictional server. No mocks of Playwright.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `collects individual portraits and skips household images` | the manifest lists exactly the expected fictional names and files; `skippedHousehold` equals the fixture's count; no household image bytes are in the bundle | downloading `householdImage`; one entry per household |
| `records members with no portrait and failed images as missing` | `missing` has the no-portrait member (`none`) and the always-500 member (`failed`); the flaky member is in `portraits` | treating a failed image as success; no retry |
| `retries are bounded` | the always-500 image is requested exactly `1 + retries.image` times (count on the server) | unbounded retry; no retry |
| `namesakes are kept and flagged` | both `Cal Sample` portraits are present with `duplicateName: true` | collapsing by name |
| `identical bytes are written once` | the two identical portraits share one file, and the bundle directory has one file for them | writing by counter |
| `repeat runs produce byte-identical manifests` | two fresh runs into two staging dirs give identical `manifest.json` bytes and file sets | timestamps or run ids in the manifest; unsorted output |
| `fetches use the signed-in context` | the server saw the `wb_session` cookie on every portrait request, and no portrait request was refused | fetching with a separate client |
| `no canary value reaches staging, logs or the manifest` | after a run, every file under the staging parent, plus all captured `log` lines, contains none of the `CANARY-` strings, `canary-email@`, or `wb_session`; logs contain no fixture member name | writing page HTML, cookies, URLs, `data-record`, or names to logs |
| `the collector source uses no forbidden browser APIs` | the files under `src/` do not contain `launchPersistentContext`, `storageState`, `.cookies(`, `addCookies`, `screenshot(`, `.content(`, `.pdf(`, `tracing`, `recordVideo`, `recordHar` | adding any of them |
| `only the fixture host is contacted` | every request the context made (recorded through a test hook) went to the fixture's `127.0.0.1:<port>` | a stray request to another host |
| `an unsupported layout fails without a bundle` | a config whose `householdList` matches nothing gives exit/result `unsupported_layout`, the exact message, and no `manifest.json` | guessing rows; writing a partial bundle |
| `an expired sign-in waits for the user and continues` | after the `signedOut` page, `waitForSignIn` is called a second time with the expired message, and the final manifest equals the normal run | failing the run; skipping that household |
| `cancel then resume equals an uninterrupted run` | aborting the signal after household 2 leaves `state.json` with indexes `[0,1]`; resume finishes; the manifest equals the uninterrupted run with no duplicates | restarting from household 0 and duplicating; losing state on abort |
| `resume refuses old or different-layout state` | a state 8 days old (injected `now`) and one with another `layoutVersion` each refuse with their exact messages | resuming anyway |
| `refuses a staging folder inside a Git repository` | a staging dir under a temp folder containing `.git` gives exit 2 and the message, and creates nothing | creating the work dir first |
| `refuses an existing collection without --resume or --cleanup` | exit 2 and the exact message | overwriting |
| `cleanup removes only collector files` | a user file in the staging parent and an extra file the user put in the work dir both remain; every recorded file is gone; the extra-file message gives the count only | `rm -rf` of the work dir or parent |
| `invalid config is rejected` | an `ftp:` start URL, an empty selector, and `retries.image` 9 each give `Invalid collector config: <field>` | accepting them |
| `the CLI prints counts, not names` | spawning the `collect` entry with `--headless`, a temp fixture config, and piped stdin, then writing a newline when the sign-in prompt appears, prints the `Done.` line, exits 0, and prints no fixture name | logging names |

## Edge cases (each needs a test)
Covered above: household image, no portrait, failed and flaky images, namesakes, identical bytes, unsupported layout, expired sign-in, cancellation, resume, old state, different layout, Git staging, existing collection, cleanup with foreign files, invalid config.

## GUI verification
Not applicable: no `apps/web/src/**` change. The collector opens Chromium, but there is no WardBoard screen to capture.

## Human checks
- Mike, on the Mac Studio: run `pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging`, sign in to the directory in the window that opens, and press Enter. Note whether it reports `Unsupported directory layout` (selectors need updating) or completes. If it completes, open the bundle folder and confirm that the portraits are individual faces and none is a household photo, and that `manifest.json` has names only. Then run with `--cleanup` and confirm the folder is gone. Do not commit or share the bundle.

## Out of scope
- Importing a bundle into WardBoard, name matching against the ward, and the comparison review (T-098).
- Updating `docs/import/guide.md` and the operator prompt (T-099).
- PDF report collection (the guide's manual download stays the route).
- Updating selectors for the real directory beyond the best guess.
