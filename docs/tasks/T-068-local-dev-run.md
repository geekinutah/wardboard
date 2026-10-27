# T-068: Local dev run with the fictional ward

**Milestone:** 3 — Server and collaboration (developer tooling, off-plan)
**Depends on:** T-022 (`databasePath`, `initialAdminLogin`), T-023 (`openStore`, `seedFixture` in `@wardboard/server/dev`). Both must be `done`.
**Spec refs:**
- SPEC.md §9: prototype and test with fictional data only.
- SPEC.md §10: identity comes from Tailscale in production. The fixture provider exists for tests and is selected only in code, never by env or config (T-021 binding decision).
- `docs/gui-verification.md` step 1: the capture server is seeded from the fictional fixture ward.

## Goal
1. `pnpm dev` builds the web client and starts WardBoard on `127.0.0.1`. It uses a persistent, gitignored data directory seeded once with the fictional fixture ward, and signs everyone in as a fictional admin, so Mike can open the printed URL and poke around.
2. The e2e/GUI checkout server seeds the same fixture data instead of the current no-op seam.

## Design decisions (binding)
- **`apps/server/dev/seed-data-dir.ts`** exports `seedFixtureDataDir(dataDir: string): 'seeded' | 'existing'`. It:
  1. Creates `dataDir` if missing.
  2. Opens `databasePath(dataDir)` with `openDatabase` and runs `migrate`.
  3. Opens a store with a real clock. If `loadCurrent()` is null it calls `seedFixture(store)` and returns `'seeded'`; otherwise it returns `'existing'` and writes nothing.
  4. Closes the database.

  `apps/server/dev/index.ts` re-exports it.
- **`apps/server/dev/dev-server.ts`** exports `startDevServer(options: { dataDir: string; port: number; webDir: string; reset?: boolean }): Promise<RunningServer & { seeded: 'seeded' | 'existing' }>`. It:
  1. If `reset` is set, removes `dataDir` with `rm -rf` semantics, but only when the exported `isSafeResetPath(dataDir)` passes: the resolved path is exactly `<repo>/data/dev`, or strictly inside the OS temp dir. Anything else throws without deleting.
  2. Calls `seedFixtureDataDir(dataDir)`.
  3. Calls `startServer` with host **always** `127.0.0.1`, `baseUrl: 'http://127.0.0.1'`, the given port and webDir, `initialAdminLogin: 'dev-admin@example.test'`, and `identityProvider: fixtureIdentityProvider({ login: 'dev-admin@example.test', displayName: 'Dev Admin' })`.

  When the file is run directly, it reads `--reset` and `WARDBOARD_DEV_PORT` (default `5180`, an integer from 1 to 65535, anything else exits 1 with a message). It uses `<repo>/data/dev` (already gitignored by `data/`) and `apps/web/dist`, exits 1 with a "run the build first" message when `apps/web/dist/index.html` is missing, and prints `WardBoard dev: <url> (fictional data, signed in as Dev Admin)`. It stops cleanly on SIGINT/SIGTERM.
- **Root `package.json`**: add the script `"dev": "pnpm --filter @wardboard/web run build && node apps/server/dev/dev-server.ts"`. Extra args pass through: `pnpm dev -- --reset`.
- **`apps/web/e2e/checkout-server.ts`**: the `seedFixtureWard(dataDir)` seam calls `seedFixtureDataDir(dataDir)` from `@wardboard/server/dev`. Nothing else in the file changes.
- **Docs**:
  - `README.md` gets a short "Run locally with fictional data" section: `pnpm dev`, the URL, `--reset`, and a note that the dev server signs everyone in as a fictional admin and must never be exposed beyond localhost.
  - In `docs/gui-verification.md`, replace the sentence "Seeding the fictional fixture ward is a no-op seam until the board model exists." with "The capture server is seeded with the fictional fixture ward (T-068)."
- `apps/server/src/**` and `main.ts` must not import `../dev` (T-023's structural test already enforces this).

## Scope
May change:
- `apps/server/dev/seed-data-dir.ts`, `apps/server/dev/dev-server.ts` (new), `apps/server/dev/index.ts` (export line)
- `apps/server/test/dev/**` (new)
- `apps/web/e2e/checkout-server.ts` (seam body and import only)
- root `package.json` (the `dev` script only)
- `README.md` (new section), `docs/gui-verification.md` (the one sentence)

Must not change:
- `apps/server/src/**`, `packages/**`, `apps/web/src/**`, other `apps/web/e2e/**` files, `docker/**`, `scripts/**`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Seed and dev server tests | `pnpm --filter @wardboard/server exec vitest run test/dev` | all pass |
| 2 | Dev server starts from the root script | `pnpm dev` (in a separate shell, then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5180/` and `curl -s http://127.0.0.1:5180/api/health`; stop with Ctrl-C) | prints the `WardBoard dev:` line; `200`; `{"status":"ok"}` |
| 3 | e2e still green with seeding | `pnpm --filter web run test:e2e` | all projects pass |
| 4 | Dev data is not tracked | `git check-ignore data/dev/wardboard.sqlite` | prints the path (exit 0) |
| 5 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
`apps/server/test/dev/dev-server.test.ts`: temp data dirs, port 0, and a temp `webDir` containing `index.html`.
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `first seed writes the fixture ward; second is existing` | `'seeded'`, then `'existing'`; member count equals `FIXTURE_MEMBER_NAMES.length`; one proposal, still exactly one after the second call | reseeding duplicates or throws `already_initialized` |
| `dev server serves the app as the fictional admin` | `GET /` → 200 with no identity headers | fixture identity not injected, or admin not bootstrapped (403) |
| `dev server binds loopback only` | `RunningServer.url` starts with `http://127.0.0.1:` | host taken from env/options |
| `reset wipes and reseeds a temp data dir` | add a proposal via the store, restart with `reset: true` → back to one proposal, `seeded: 'seeded'` | reset ignored |
| `reset guard accepts only data/dev or the temp dir` | pure exported `isSafeResetPath(dataDir)` (resolves the path, including `..` and symlinks of existing parents): `<repo>/data/dev` and `<os.tmpdir()>/x` → true; `<repo>`, `<repo>/data`, `/`, `<os.tmpdir()>` itself, `<os.tmpdir()>/../elsewhere`, `<repo>/data/dev-other` → false; `startDevServer` with `reset: true` on an unsafe path throws and the path still exists | deletes arbitrary directories; prefix match without a separator |

## Edge cases (each needs a test)
Already covered above: an existing data dir, reset, and an unsafe reset path. Add one more: `WARDBOARD_DEV_PORT` parsing. Put it in a pure `parseDevPort` exported from `dev-server.ts`: `undefined` → 5180, `'0'`/`'70000'`/`'abc'` → error.

## Human checks
- Mike runs `pnpm dev`, opens the printed URL in a desktop browser and on a phone (same machine only), and confirms the app loads. Until T-029 and the UI tasks land, the page shows only the shell and "Server: ok". The data is seeded but not yet visible.

## Out of scope
- Any UI showing the board.
- Vite HMR/watch mode.
- Running the dev server in Docker or over Tailscale.
