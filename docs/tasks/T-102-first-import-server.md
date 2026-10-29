# T-102: The first import creates Current on the server

**Milestone:** 6 — Import and photos
**Depends on:** T-058 (import replace on the server). Done.
- Promoted from B-061. Mike decided on 2026-10-29: "if there is no current, we should default to an import workflow." This task is the server half. T-103 (the web half) depends on it.
- Runs in parallel with T-098 (photo bundle import, another controller). T-098 does not edit any file listed here; this task must not edit `apps/server/src/photos/**`, `apps/server/src/server.ts` or anything in `apps/web/`.

**Spec refs:** SPEC.md §8 (import is a deliberate, previewed, explicitly confirmed and atomic replacement of Current; a failed import leaves the previous state intact; import supplies the ward's calling structure, including standard and custom callings and vacancies; namesakes are never silently merged). §15 (allow-list; discarded fields never reach storage, logs or backups). §10 (the server is authoritative; committed changes are broadcast to every open client).

## Goal
On a data directory with no Current board, `POST /api/import/preview` returns a normal preview, and `POST /api/import/replace` with `expectedVersion: 0` creates the ward's first Current from the three reports in one transaction and broadcasts it to every connected client. Everything else about import stays as it is.

## Design decisions (binding)
- **Empty Current.** Add a pure `emptyCurrentBoard(id: BoardId): Board` in `apps/server/src/import/` (new file `empty.ts`, re-exported from `import/index.ts`). It returns `kind: 'current'`, `version: 0`, and no board groups, calling groups, assignments, positions, placements, oversight, approvals or dugout inclusions. It must pass `createBoard` with an empty ward.
- **Planning without a Current.** In `http.ts`, when `store.loadCurrent()` is null, plan against `emptyCurrentBoard(...)` and `store.loadWard()`, with no previous fingerprints. The planner already creates the board groups, calling groups and assignments that the rows need. For the preview, use a fixed id that is never stored. For the replace, use a fresh id from `input.ids`.
- **Replace without a Current.** `expectedVersion` must be `0`. Any other value returns 409 `{ "error": "stale", "currentVersion": 0 }`. With 0, run `applyImport` as today, then write the result with `store.initialize({ ward, current, importVersion })` instead of `replaceCurrent`. Note that `initialize` stamps `importedAt` from the store clock. If `initialize` refuses with `already_initialized` (another first import won the race), return 409 `stale` with the `currentVersion` of the Current that now exists. Any other refusal returns 400 `bad_request`, as today. On success: `channel.publishImport()`, the same log line, and the same 200 body as an ordinary replace.
- **With a Current**, nothing changes. A replace with `expectedVersion: 0` against an existing Current is refused `stale` by the existing check.
- The routes stay Admin-only, origin-checked and size-limited as today. Logs never include report contents or names, as today.
- **SPEC.md.** Append this sentence to §8, after the "Replace atomically" list: `**CONFIRMED (2026-10-29):** When there is no Current board, WardBoard opens the import workflow, and the first import creates Current from the three reports.` No other SPEC change.

## Scope
May change:
- `apps/server/src/import/empty.ts` (new), `apps/server/src/import/index.ts` (re-export only), `apps/server/src/import/http.ts`
- `apps/server/test/import/first-import.test.ts` (new)
- `SPEC.md` (the one sentence above)

Must not change:
- every existing test file, `apps/server/src/import/plan.ts`, `apply.ts`, `apps/server/src/store/**`, `apps/server/src/ws/**`, `apps/server/src/server.ts`, `apps/server/src/photos/**`, `apps/web/**`, `packages/**`, `fixtures/**`, `scripts/**`
- anything else

If `plan.ts`, `apply.ts` or the store must change for an empty Current to work, stop and report BLOCKED with the reason.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit and route tests | `pnpm --filter @wardboard/server exec vitest run test/import` | every new test below passes, and the existing `plan.test.ts` and `routes.test.ts` pass unmodified |
| 2 | Mutation | in a disposable worktree at the candidate, make the no-Current replace path call `replaceCurrent` (as before), then run check 1 | `first replace creates Current and broadcasts it` fails; remove the worktree |
| 3 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`apps/server/test/import/first-import.test.ts` runs against a real SQLite database in a temporary directory that is migrated but has no Current. It uses a real server and WebSocket on an ephemeral port, the fictional PDFs in `fixtures/lcr-reports/`, and the helpers and patterns of `routes.test.ts` (copy them; don't edit that file).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `emptyCurrentBoard is a valid empty Current` | `createBoard(emptyCurrentBoard(id), emptyWard)` succeeds; version 0; every collection is empty | a board that fails validation |
| `preview without a Current returns a plan` | 200 with a preview whose `decisions` are all `new` (empty ward) and that plans positions; nothing is written (`loadCurrent()` is still null) | the old 400; writing on preview |
| `first replace creates Current and broadcasts it` | 200 with `importVersion` and `importedAt`; `loadCurrent()` returns a board at version 1 holding the reports' groups, assignments and placements, with a ward of the new members; a connected, signed-in client receives a `boards` message whose `current` is non-null | still calling `replaceCurrent`; no broadcast |
| `first replace needs expectedVersion 0` | `expectedVersion: 3` with no Current returns 409 `{ error: 'stale', currentVersion: 0 }`, and nothing is written | accepting any version |
| `a second first import is stale` | after one successful first import, a replace with `expectedVersion: 0` returns 409 `stale` with the new Current's version, and the stored Current is unchanged | overwriting Current |
| `first import keeps only allow-listed fields` | after the first replace, the database file and the captured log lines contain none of the fixture reports' phone numbers, emails or birth dates (pick three values from `fixtures/lcr-reports/README.md`'s description and the PDFs' text, as the T-056 leakage tests do) | storing a discarded field |
| `Editors are refused without a Current` | an Editor's preview and replace both return 403, and nothing is written | gating skipped on the new path |
| `with a Current, replace behaves as before` | a seeded Current plus `expectedVersion: 0` returns 409 `stale` with its version | the new path running when a Current exists |

## Edge cases (each needs a test)
Covered above: no Current on preview and replace, wrong expected version, two first imports, Editor, an existing Current, leakage.

## Human checks
none (T-103 carries the device check).

## Out of scope
- Any web change (T-103).
- Seeding handbook default groups or oversight on a first import. The first Current holds only what the reports supply (B-054 stays open).
- Changing `plan.ts`, `apply.ts`, the store or the channel.
