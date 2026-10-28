# T-084: e2e specs edit their own proposals, not the shared fixture

**Milestone:** 4 — Desktop board (test harness)
**Depends on:** none (T-079 and T-080 are merged; the e2e suite on `main` is the starting point).
**Spec refs:** AGENTS.md "Testing rules" item 6 (deterministic) and "Commands" (`./scripts/verify.sh` must pass). Backlog B-038.

## Goal
`./scripts/verify.sh` stops failing at random. Today about one full e2e run in three fails on desktop-chromium. Every Playwright project runs `board-shell.spec.ts:71` (add a position) and `board-views.spec.ts:3` (change an oversight) against the one shared fixture proposal, `Spring adjustments`, at the same time, so one browser's edit makes another's stale.

After this task, every e2e test that edits a board does it on a Draft proposal that the test created itself and gave a unique name. Concurrent projects and repeats then never write to the same board.

## Background (measured on `main` 1b5b5d8, 2026-10-28)
- In alternating runs, `main` without T-080 failed 3 of 9 runs and `main` with T-080 failed 2 of 8. The failures were `board-shell.spec.ts:71` (`addPositionUntilCommitted` waits for the vacancy label to change after a stale rejection, and times out when the competing edit didn't change vacancies) and `board-views.spec.ts:3` (expected "Second Counselor", received "Overseen by First Counselor").
- `apps/web/e2e/editing.spec.ts:44-73` already shows the right pattern: `createProposal(page, name)` sends `createProposal` with `source: {kind: 'current'}` over its own WebSocket and waits for `proposalCreated`. The tests then open that tab.
- See `docs/tasks/backlog/B-038-e2e-shared-proposal-mutation.md` and `docs/tasks/evidence/T-080.md`.

## Design decisions (binding)
- **Shared helper:** add a new file `apps/web/e2e/support/proposals.ts` that exports `createProposal(page, name)` with the same behavior as `editing.spec.ts`'s version, and `uniqueProposalName(prefix, testInfo)`. The name must include `testInfo.project.name`, `testInfo.repeatEachIndex` and `testInfo.retry`, so it is unique across projects, repeats and retries. `editing.spec.ts` may switch to importing the helper; if it does, its tests must stay otherwise unchanged.
- **`board-shell.spec.ts:71`:** create its own proposal, open its tab, and do the zoom and add-position steps there. The position title must also be unique per repeat, because `addOutcome` treats any existing `Vacant, <title>` article as committed. Rename the test title only to replace "the fixture proposal" with "its own proposal". Keep every assertion about Current, zoom, the add, and the committed result. The stale-retry helper may stay. Removing it is allowed only if it is no longer reachable, and the reason must be in the report.
- **`board-views.spec.ts:3`:** create its own proposal and open it, before and after the reload. Before choosing Second Counselor, add one assertion of the starting overseer that the fresh proposal shows, so the test proves the change.
- **Audit:** read every `apps/web/e2e/*.spec.ts`. List in the report each test that sends a board-changing operation to the checkout server, and the board it targets. Any other spec that edits `Spring adjustments` or Current gets the same fix, within scope. Read-only specs that only open `Spring adjustments` (`summary-mode`, `phone-shell`, `presentation`, `summary`) stay as they are.
- **Retries:** `retries: 0` and `forbidOnly: true` in `playwright.config.ts` stay. No timeouts are raised to hide the race.

## Scope
May change:
- `apps/web/e2e/support/proposals.ts` (new)
- `apps/web/e2e/board-shell.spec.ts`
- `apps/web/e2e/board-views.spec.ts`
- `apps/web/e2e/editing.spec.ts` (only to import the shared helper instead of its local copy)
- any other `apps/web/e2e/*.spec.ts` the audit finds editing a shared board (name it and give the evidence in the report)

Must not change:
- `apps/web/e2e/playwright.config.ts`, `checkout-server.ts`, `global-setup.ts`, `e2e/gui/**`
- `apps/web/src/**`, `apps/server/**`, `packages/**`, `scripts/**`

New dependencies allowed: none

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | No spec edits the shared fixture | `grep -n "Spring adjustments" apps/web/e2e/board-shell.spec.ts apps/web/e2e/board-views.spec.ts` | no output (exit 1) |
| 2 | Stress, red on base | in a worktree at the base commit: `pnpm --filter web run build && pnpm --filter web exec playwright test -c e2e/playwright.config.ts board-shell.spec.ts board-views.spec.ts --repeat-each=5 --workers=8` | at least one failure (record the output). If base doesn't fail in 3 tries, report that with the outputs; don't fake red |
| 3 | Stress, green on candidate | the same command on the candidate, 3 times | 3 of 3 exit 0, 40 passed each (2 tests × 4 projects × 5) |
| 4 | Full e2e, repeated | `pnpm --filter web run test:e2e` once, then `pnpm --filter web run test:e2e:playwright` 9 more times | 10 of 10 exit 0; record pass counts |
| 5 | Tests still assert behavior | `grep -c "expect" apps/web/e2e/board-shell.spec.ts apps/web/e2e/board-views.spec.ts` | each count is at least the base count (record both) |
| 6 | Gate | `./scripts/verify.sh` | exits 0 |

## Tests to write / structural checks
This task changes test harness code only, with no application behavior. So the evidence is the stress run (red on base, green on the candidate) plus these checks and mutations:

| Check | What it proves | A realistic defect it must catch |
|---|---|---|
| AC1 grep | the two racing specs no longer touch the shared proposal | a later edit that points the spec back at `Spring adjustments` |
| AC3 stress with `--repeat-each=5 --workers=8` | concurrent projects and repeats don't collide | a name that's unique per project but not per repeat |
| Mutation M1 (verifier): make `uniqueProposalName` ignore `repeatEachIndex` | the stress run fails or `createProposal` collides | proves AC3 exercises repeat uniqueness |
| Mutation M2 (verifier): make `board-shell`'s position title constant across repeats | the stress run passes for the wrong reason, or fails | the verifier states which; if it passes, AC3 needs strengthening and that is a FAIL |
| Mutation M3 (verifier): in board-views, choose the overseer the fresh proposal already has instead of Second Counselor | the test fails | proves the test detects a change that never happened |

## Edge cases (each needs coverage)
- Many proposal tabs in the header, from repeats: tabs must still be clickable. Playwright scrolls them into view; if the header wraps (B-035), the test must still pass at every viewport.
- A retry, or a server that already holds a proposal with that name: names include `retry`. If the server refuses duplicate names, the helper fails loudly with the server's message.
- Phone projects: keep whatever phone-only branching the specs already have.

## Human checks
none

## Out of scope
- Fixing B-035 (header wrap) or changing the app.
- GUI capture scenarios in `e2e/gui/**`, even if they edit the fixture. They aren't run by `./scripts/verify.sh`; list any you find in Notes.
- Changing Playwright config, workers, retries or timeouts.
