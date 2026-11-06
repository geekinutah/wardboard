# T-119: Admin photo-collection job

**Milestone:** 8 — Directory photos from Settings
**Depends on:** T-061 (directory photo collector), T-098 (photo bundle import). Both done.
**Spec refs:** SPEC.md §14 (match preview before import; no Church credentials stored; individual portraits only), §15 (the user signs in in the browser; the app does not ask for, store, or log passwords, cookies, or session state; staging stays out of backups and is deleted when the handoff finishes or the run is cancelled), §11 (every route except health requires a session; admin-only actions refuse an Editor), §16 milestone 8. PLAN.md Milestone 8 row T-119.

## Goal
An Admin can start one directory-photo collection on the server. The job calls the existing `collect()` against `<dataDir>/collector-staging`, reports progress, waits while the user signs in, and on success returns the same sanitized bundle review the file upload already returns. Tests supply `collect()`; they do not open the Church directory or a browser.

## Scope
May change:
- `apps/server/src/photo-collection/` (new)
- `apps/server/test/photo-collection/` (new)
- `apps/server/src/server.ts` (route dispatch, `StartServerOptions`, `close`)
- `apps/server/src/photos/bundle.ts` (extract the existing validate-then-store path so the job can call it; HTTP responses of `POST /api/photos/bundle` stay the same)
- `apps/server/src/photos/index.ts` (re-export only if the new module needs it)
- `apps/server/dev/dev-server.ts` and `apps/server/test/dev/dev-server.test.ts` (wire the real collector into `pnpm dev` only)
- `apps/server/package.json` and `pnpm-lock.yaml` (`@wardboard/collector` as a devDependency of `@wardboard/server` only)
- `tools/collector/package.json` (`exports`)
- `tools/collector/src/index.ts` (new barrel)
- `tools/collector/test/exports.test.ts` (new)

Must not change:
- `docker/Dockerfile`, `docker/compose.yaml`, and anything else under `docker/`
- `apps/server/src/main.ts` (the container entry must not import the collector)
- `apps/web/**`, `packages/**`, `SPEC.md`, `docs/tasks/**` other than this contract's own file (the controller owns STATUS)
- `tools/collector/src/collect.ts`, `tools/collector/src/staging.ts`, and `tools/collector/src/config.ts` (call them; do not change their behavior)
- the Playwright install or the image filter that keeps the collector out of the runtime image

New dependencies allowed: `@wardboard/collector` as a devDependency of `@wardboard/server` only. No production dependency, and no other new packages.

## Design decisions (binding)

### 1. Collector export
`tools/collector/src/index.ts` exports `collect`, `CollectOptions`, `CollectResult`, `loadConfig`, and `DirectoryConfig` from the existing modules. `tools/collector/package.json` sets `"exports": { ".": "./src/index.ts" }`.

### 2. Injected collector
`StartServerOptions` gains an optional `photoCollector`:

```ts
photoCollector?: {
  collect: (
    options: CollectOptions,
  ) => Promise<CollectResult>;
  config: DirectoryConfig;
};
```

Copy those two type shapes into the server (structural). Production server sources under `apps/server/src/**` must not import `@wardboard/collector`. When `photoCollector` is omitted, the server still boots. `POST /api/admin/photo-collection` then returns `503` `{"error":"collector_unavailable"}` and does not create a staging directory. `GET` still reports idle.

Job state lives in the `startServer` closure, not in a module global. Two servers in one process have separate jobs.

The job calls `collect` with:
- `stagingDir`: `path.join(dataDir, 'collector-staging')`
- `config`: `photoCollector.config`
- `mode`: `'new'`
- `browser`: `{ headless: false }`
- `signal`: an `AbortController` owned by the job
- `now`: the server clock
- `log`: records the latest progress line (counts and fixed text only)
- `waitForSignIn`: sets status to `needs-sign-in`, sets progress to the message, and settles when continue is called or the signal aborts

`POST` start does not wait for `collect` to finish.

### 3. Routes
All four require the existing session gate (unknown login `403`, no identity `401`). The handler then requires `role === 'admin'`; an Editor is `403` `{"error":"forbidden"}`. Every response sets `content-type: application/json`, `cache-control: no-store`, and `x-content-type-options: nosniff`.

POST routes use the same origin rule as backup restore: `Origin` must equal the app origin or the listen origin. Missing or foreign `Origin` is `403` `{"error":"forbidden"}`. GET does not check `Origin`.

| Route | Methods | Success |
|---|---|---|
| `/api/admin/photo-collection` | `GET`, `POST`. Anything else `405` with `allow: GET, POST` and `{"error":"method_not_allowed"}` | below |
| `/api/admin/photo-collection/continue` | `POST` only. Else `405`, `allow: POST` | `200` `{"status":"running"}` |
| `/api/admin/photo-collection/cancel` | `POST` only. Else `405`, `allow: POST` | `200` `{"status":"idle"}` |

`GET` returns `200` and one of:

```ts
{ status: 'idle'; progress: '' }
{ status: 'running'; progress: string }
{ status: 'needs-sign-in'; progress: string }
{ status: 'review'; progress: string; bundle: PhotoBundleResponse }
{ status: 'failed'; progress: string; message: string }
```

`progress` is the latest `log` line, or the `waitForSignIn` message while waiting. It is `''` when nothing has been logged.

`POST /api/admin/photo-collection`:
- `503` `{"error":"collector_unavailable"}` when no collector was injected.
- `409` `{"error":"already_running"}` when status is `running` or `needs-sign-in`. The in-flight job is left alone.
- From `idle`, `review`, or `failed`: replace the previous job. Prepare staging (below), start `collect`, and return `200` `{"status":"running"}`. Do not wait for the Church site.

`POST .../continue` while status is not `needs-sign-in` is `409` `{"error":"not_waiting"}`.

`POST .../cancel` while status is `idle` is `409` `{"error":"not_running"}`. From `running` or `needs-sign-in`, abort the signal, reject the pending `waitForSignIn`, wait until that `collect` settles, delete staging, then return idle. From `review` or `failed`, delete staging if it is still present and return idle. Stored photos are not deleted.

`running.close()` aborts an in-flight job the same way, deletes staging, and then performs today's close. It resolves only after that cleanup.

### 4. Staging directory
The directory is exactly `<dataDir>/collector-staging`. Create it with mode `0700` (`mkdir` then `chmod`, because umask would otherwise widen `mkdir`). It is a sibling of `photos/`, never inside it.

Before creating it, `lstat` any existing path:
- A symlink, or anything that is not a real directory, is left untouched. The start returns `500` `{"error":"staging_unavailable"}` and does not call `collect`.
- A real directory is removed with `fs.rm` on that path only, then recreated mode `0700`.

`collect` writes `<stagingDir>/wardboard-collector/bundle/` (its existing layout). After `collect` settles, for every terminal outcome, remove the staging directory with `fs.rm` on that same path when it is a real directory. Never remove `photos/`, the database, or a symlink's target.

### 5. Review payload
On `collect` status `done`, read `wardboard-collector/bundle/manifest.json` and each portrait file whose name is the manifest `file`. A portrait `file` must match `^[0-9a-f]{64}\.(?:jpg|png)$` and `path.resolve` must stay inside that bundle directory. Build the existing `PhotoBundleRequest` (`manifest` plus base64 `files`) and pass it through the same validate-then-store function `POST /api/photos/bundle` uses. That function stores nothing until every file validates and sanitizes.

Success stores the sanitized portraits, deletes staging, and sets `review` with that `PhotoBundleResponse`. No image bytes, names, or cookies are added to the server `log` callback. Progress lines may be logged.

Any other `collect` status (`cancelled`, `unsupported_layout`, `refused`, `failed`) sets `failed` with `message` equal to `result.message`, then deletes staging. A thrown error sets `failed` with `message` `Collection failed.` A `done` result whose bundle is missing or rejected sets `failed` with `message` `The collected bundle could not be read.` In that case no new photo is stored.

### 6. Dev server
`startDevServer` accepts an optional `loadCollector`. The default dynamically imports `@wardboard/collector`, calls `loadConfig` on `<repo>/tools/collector/config/directory.json`, and passes `{ collect, config }` into `startServer`. `browser.headless` stays the job's `false`. If the loader throws, the dev server still starts and photo collection is unavailable (`503`). Tests of this wiring pass a fake loader or a throwing loader. They must not call the real `collect`.

`insideGitRepository` still refuses a staging directory inside this checkout. `<repo>/data/dev` is inside the checkout, so a real `pnpm dev` collection fails with the collector's existing git message. Do not weaken that check. The container has no collector and no display; do not change that.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Job behavior | `pnpm --filter @wardboard/server test -- test/photo-collection/job.test.ts` | all tests in that file pass |
| 2 | Dev wiring | `pnpm --filter @wardboard/server test -- test/dev/dev-server.test.ts` | all tests in that file pass, including the new loader tests |
| 3 | Collector export | `pnpm --filter @wardboard/collector test -- test/exports.test.ts` | all tests in that file pass |
| 4 | Bundle route unchanged | `pnpm --filter @wardboard/server test -- test/photos/bundle.test.ts` | all tests in that file pass |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

Vitest's CLI does not filter on the text after `--`. Run each file by its path, as written above. The quality gate is the proof that the whole suite still passes.

## Unit tests to write

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `signed-out photo collection is unauthenticated` | `GET` and `POST` on all three paths with a null identity return `401` `{"error":"unauthenticated"}` | a route mounted before the session gate |
| `an unknown login is forbidden` | a login that was never invited gets `403` on `GET` | the handler skipping `access.resolve` |
| `an editor is forbidden on every photo-collection route` | editor `GET`, `POST`, continue, and cancel return `403` `{"error":"forbidden"}` and `collect` is not called | treating any signed-in user as admin |
| `admin POST without origin is forbidden` | missing `Origin` and a foreign `Origin` on start, continue, and cancel return `403`; `GET` without `Origin` returns `200` idle | copying the origin check onto `GET`, or omitting it on `POST` |
| `listen origin and app origin are both accepted` | admin `POST` with either origin starts the job | allowing only one of the two origins |
| `wrong method is rejected` | `PUT` on the collection path is `405` with `allow: GET, POST`; `GET` on continue is `405` with `allow: POST` | a single allow list for every path |
| `no injected collector is unavailable and creates nothing` | `POST` is `503` `{"error":"collector_unavailable"}`, `GET` is idle, and `collector-staging` does not exist | importing Playwright when the option is omitted |
| `start calls collect once with a visible browser and the staging directory` | one call, `mode: 'new'`, `browser.headless === false`, `stagingDir` is `<dataDir>/collector-staging`, and that directory's mode is `0700` | `headless: true`, or staging under `photos/` |
| `POST start returns while sign-in is still pending` | the response is `200` `{"status":"running"}` while `waitForSignIn` is unresolved | awaiting `collect` before responding |
| `GET reports the progress line and then needs-sign-in` | after `log`, `GET` progress is that line and status is `running`; after `waitForSignIn`, status is `needs-sign-in` and progress is the sign-in message | dropping `log`, or leaving status at `running` while waiting |
| `continue releases only the current wait` | the first continue returns `200` `{"status":"running"}`; a second `waitForSignIn` makes `GET` `needs-sign-in` again; continue while running is `409` `{"error":"not_waiting"}` | resolving every future wait at once |
| `a second start while waiting is refused` | `409` `{"error":"already_running"}` and `collect` was called once | starting a second browser |
| `a finished bundle is sanitized into the review payload and staging is removed` | `GET` is `review` with the portrait name, `duplicateName`, empty `missing`, and `skippedHousehold`; `GET /api/photos/<photoRef>` returns the image; `collector-staging` is gone; the server log never contains the portrait name | returning the raw bundle, or leaving staging in the data dir |
| `an invalid done bundle stores nothing` | status `failed`, message `The collected bundle could not be read.`, no new file under `photos/`, staging gone | storing the file before validation |
| `collector refusal becomes failed and keeps a sibling file` | `refused` with the collector's git message is `failed` with that message; a file planted beside staging remains | deleting `dataDir` |
| `cancel aborts the wait and deletes staging` | cancel returns idle, the signal is aborted, `waitForSignIn` rejects, and staging is gone | leaving the wait pending |
| `cancel of a review returns idle and keeps stored photos` | after `review`, cancel is idle and the photo ref still loads | deleting `photos/` on cancel |
| `starting again after review runs a new collection` | a second start is not `409`, and the next `GET` can reach a new `review` | treating `review` as still running |
| `close aborts the job and deletes staging` | `server.close()` resolves with staging gone and the signal aborted | close ignoring the job |
| `a symlink staging path is not removed or collected` | `POST` is `500` `{"error":"staging_unavailable"}`, the symlink remains, its target remains, and `collect` is not called | `rm` following the symlink |
| `a backup omits collector staging` | a file inside `collector-staging` is absent from `createBackup` entries, while the sqlite entry is present | archiving the whole data directory |
| `two servers do not share a job` | starting server A leaves server B's `GET` idle | a module-level job |

Dev server file:

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `dev server passes the loaded collector into the job` | a fake `loadCollector` is what `POST` invokes, with `headless: false` | `startDevServer` ignoring the loader |
| `a collector that fails to load leaves the dev server up` | a throwing loader still serves `GET /api/health`, and `POST` photo collection is `503` | crashing `pnpm dev` when the package is absent |

Collector file:

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the package export exposes collect and loadConfig` | importing `@wardboard/collector` yields both functions, and `loadConfig` of `config/directory.json` returns `layoutVersion` `directory-v2` | an export map that points nowhere, or a barrel that drops `collect` |

## Edge cases (each needs a test)
- No identity, unknown login, Editor, missing origin, foreign origin.
- Collector option omitted.
- Second start while `needs-sign-in`.
- Continue while `running`.
- Cancel while `idle` (`409`).
- Two `waitForSignIn` calls in one run (expired sign-in).
- `collect` returns `done` with an unreadable bundle.
- `collect` returns `refused`.
- `collect` throws (`message` is exactly `Collection failed.`).
- Staging path is a symlink.
- `server.close()` during `needs-sign-in`.
- Backup while staging holds a file.
- Restarting after `review`.

The thrown-error and idle-cancel cases are required tests even though they are not separate rows above. Name them `a thrown collector becomes a fixed failure message` and `cancel while idle is refused`.

## Human checks
none for this task. Do not sign in to the Church directory, and do not ask for credentials. A real window is a later check, after the Settings action exists, and only on a machine whose data directory is outside any Git checkout. The Docker image still has no collector and no display.

## Out of scope
- The Settings button, match screen, and file-picker disclosure (T-120).
- The import guide (T-121).
- Putting Playwright or the collector into the Docker image, or opening a window from the container.
- Changing `insideGitRepository`, resume mode, or the command-line collector.
- Name matching, including children under 11. They stay unmatched because they are not ward members; the existing match screen does that later.
- Deleting photos that a review already stored.
