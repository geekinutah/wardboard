# T-104: `pnpm dev -- --empty` starts a dev server with no Current

**Milestone:** — (local development tooling, off-roadmap; supports the human checks for T-102/T-103)
**Depends on:** T-068 (local dev run), T-102 and T-103 (first import). All done.
- Requested by Mike on 2026-10-29: "Let's add an --empty option so I can test the workflow from ground up."
- Runs alongside T-098 (photo bundle import, another controller). T-098 does not touch `apps/server/dev/**`, `apps/server/test/dev/**` or `README.md`.

**Spec refs:** SPEC.md §8 (the 2026-10-29 sentence: with no Current, WardBoard opens the import workflow, and the first import creates Current). AGENTS.md security rules: fixtures are fictional; never commit real member data.

## Goal
`pnpm dev -- --empty` starts the local dev server over its own data directory `data/dev-empty/`, which is never seeded. Opening it shows the "Set up WardBoard" first-import page, so Mike can import the fictional fixture PDFs from the ground up. `pnpm dev -- --empty --reset` wipes that directory to start over. Plain `pnpm dev` and `pnpm dev -- --reset` behave exactly as today, and never touch `data/dev-empty/`.

## Design decisions (binding)
- **Arguments.** Export `parseDevArgs(argv: readonly string[]): { reset: boolean; empty: boolean }` from `dev-server.ts`. `main` uses it in place of `process.argv.slice(2).includes('--reset')`. Other arguments, including a literal `--`, are ignored as today.
- **Data directory.** With `empty`, `main` uses `<repo>/data/dev-empty`. Otherwise it uses `<repo>/data/dev`, as today. Both are under the gitignored `data/`.
- **No seeding.** `DevServerOptions` gains `seed?: boolean`, default `true`.
  - With `seed: false`, `startDevServer` does not call `seedFixtureDataDir`. It creates the directory if it is missing and starts the server, which migrates the database as it does today.
  - It never writes a Current board.
  - `DevRunningServer.seeded` becomes `SeededState | 'unseeded'`, and is `'unseeded'` when `seed` is false.
  - `seed-data-dir.ts` does not change.
- **Reset guard.** `isSafeResetPath` also accepts exactly `<repo>/data/dev-empty`, with the same `..`/symlink resolution. It still refuses `<repo>/data`, the repo root, `data/dev-other`, `data/dev-empty-x`, and everything else it refuses today.
- **Message.** With `empty`, print `WardBoard dev: <url> (empty: no Current yet, open it to run the first import; signed in as Dev Admin)`. Otherwise, print today's line unchanged.
- **README.** In "Run locally with fictional data", add one paragraph after the `--reset` sentence. It must say that `pnpm dev -- --empty` uses its own `data/dev-empty/` directory with no Current, opens the first-import workflow, and suggests the fictional reports in `fixtures/lcr-reports/`. It must also say that `pnpm dev -- --empty --reset` starts that directory over. No other README change.

## Scope
May change:
- `apps/server/dev/dev-server.ts`, `apps/server/dev/index.ts` (export `parseDevArgs` only)
- `apps/server/test/dev/dev-empty.test.ts` (new)
- `README.md` (the one paragraph)

Must not change:
- every existing test file (including `apps/server/test/dev/dev-server.test.ts`)
- `apps/server/dev/seed-data-dir.ts`, `seed-fixture.ts`, `apps/server/src/**`
- `package.json` (the `dev` script already forwards arguments)
- `apps/web/**`, `packages/**`, `fixtures/**`, `scripts/**`, `.gitignore`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter @wardboard/server exec vitest run test/dev` | every new test below passes; `dev-server.test.ts` passes unmodified |
| 2 | Real run | from the repo root, with `WARDBOARD_DEV_PORT` set to a free port: run `pnpm dev -- --empty --reset` in the background. Wait for the printed line. Then `curl -s http://127.0.0.1:$PORT/api/health`, and fetch `/` with `curl`. Stop it with SIGINT. | it prints the `empty:` line; health responds; afterwards `data/dev-empty/` exists and its database has no Current board (check with `node` and the store, or `sqlite3` if available); `data/dev/` is unchanged (compare `ls -la`/mtime before and after) |
| 3 | Mutation | in a disposable worktree at the candidate, make `startDevServer` ignore `seed` (always seed), then run check 1 | `an unseeded dev server has no Current` fails; remove the worktree |
| 4 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 5 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
In `apps/server/test/dev/dev-empty.test.ts`. Use temp data directories and a fake web dir, following the patterns in `dev-server.test.ts`: copy its helpers; don't edit that file.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `an unseeded dev server has no Current` | `startDevServer({ dataDir: tmp, port: 0, webDir, seed: false })` serves `/`; `seeded` is `'unseeded'`; after closing, the store's `loadCurrent()` is null and the ward has no members | seeding anyway |
| `an unseeded dev server stays unseeded on restart` | a second `seed: false` start on the same dir still has no Current | seeding on the second run |
| `reset with seed false wipes without reseeding` | a temp dir holding a fixture-seeded database, started with `reset: true, seed: false`, comes back with no Current | reseeding after reset |
| `seed defaults to true` | omitting `seed` seeds the fixture ward (`seeded === 'seeded'`, Current present) | default flipped |
| `parseDevArgs reads --empty and --reset` | `[]` → both false; `['--empty']`, `['--reset']`, `['--', '--empty', '--reset']`, and unknown args ignored | `--` breaking parsing; empty implying reset |
| `reset guard also accepts data/dev-empty only` | `data/dev-empty` → true; `data/dev-empty-x`, `data/dev-empty/../dev-other`, `data` → false; `data/dev` still true | prefix matching; allowing the parent |

## Edge cases (each needs a test)
Covered above: a restart, reset without reseeding, the default, the `--` separator, unknown arguments, reset-guard prefix and `..` paths.

## Human checks
- Run `pnpm dev -- --empty --reset` and open the printed URL in desktop Chrome. "Set up WardBoard" appears.
- Import the three PDFs from `fixtures/lcr-reports/`, resolve the identities, and create Current. Confirm it lands on the board.
- Run `pnpm dev` (without `--empty`) and confirm the usual fictional ward is still there.

## Out of scope
- Changing what a first import contains, or the import UI (see B-062, B-065).
- Any non-dev server behavior.
