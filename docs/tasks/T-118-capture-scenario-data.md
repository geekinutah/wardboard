# T-118: Clear data between GUI capture scenarios

**Milestone:** — (test infrastructure, off-roadmap)
**Depends on:** none
**Spec refs:** `docs/gui-verification.md` pipeline step 1; backlog B-075. Mike, 2026-11-01: clear data between scenarios. A multi-step scenario is self-contained.

## Goal

Each GUI capture scenario starts from a clean fictional fixture ward (or an empty data directory, when that scenario already requires no Current). Tags, proposals, photos, notes, and edits from any other scenario are absent. The steps and screenshots inside one scenario share that scenario's data, and the scenario creates whatever it shows.

## Design decisions (binding)

- A **scenario** is one Playwright `test()` in `apps/web/e2e/gui/**/*.capture.ts`. `phone-search-dugout.capture.ts` has two tests, so it is two scenarios. Do not merge them. A test that takes several screenshots is one scenario: `import-settings.capture.ts` previews, reviews, and replaces on one server.
- **One server per test, including each browser project.** `apps/web/e2e/gui/capture-test.ts` extends Playwright's `test` with an auto fixture scoped to the test. The fixture calls `startCheckoutServer({ seed })`, overrides `baseURL` with that server's URL, and stops the server in teardown (the existing `stop()` deletes the data directory). `seed` defaults to true. `test.use({ captureSeed: false })` starts an unseeded server.
- **Workers stay parallel.** `gui:capture` still runs through `scripts/e2e-slot.pl` with 6 workers. Do not reset one shared database between tests. One worker's reset would wipe another worker's open scenario. Do not lower the worker count.
- **Capture mode starts no shared server.** When `WARDBOARD_GUI_CAPTURE=1`, `global-setup.ts` still deletes old `gui-artifacts` images and does not call `startCheckoutServer` or set `WARDBOARD_E2E_BASE_URL`. The ordinary e2e suite is unchanged: one shared seeded server from global setup.
- **Every capture file** imports `test` from `./capture-test.ts`. It may still import `expect`, `Page`, and other types from `@playwright/test`. It must not import `test` from `@playwright/test` and must not call `startCheckoutServer`.
- **Private servers move onto the fixture.** These files delete their `beforeAll` / `afterAll` server and use root-relative navigation (`/settings`, not `` `${server.url}/settings` ``):
  - `photo-bundle.capture.ts`, `import-settings.capture.ts`, `import-guidance.capture.ts` — seeded, the default.
  - `first-import.capture.ts`, `member-list-import.capture.ts`, `import-review.capture.ts` — `test.use({ captureSeed: false })`.
- **Self-contained.** A scenario creates every tag, proposal, photo, note, and edit it shows. If `gui:capture` fails because a scenario was relying on another scenario's leftovers, set that data up inside the failing scenario. Do not weaken an assertion to hide a leak.
- **Specs stay shared.** `apps/web/e2e/**/*.spec.ts` other than the new isolation spec keep today's one server. Do not import the capture fixture from them.

## Scope

May change:

- `apps/web/e2e/gui/capture-test.ts` (new)
- `apps/web/e2e/gui/**/*.capture.ts` (the `test` import; the six files above also drop their private server)
- `apps/web/e2e/global-setup.ts` (capture mode does not start the shared server)
- `apps/web/e2e/capture-isolation.spec.ts` (new)
- `scripts/capture-scenarios.test.mjs` (new)
- `docs/gui-verification.md` (pipeline step 1 only: each capture scenario has its own server, steps inside that scenario share it, and scenarios do not see each other's data)

Must not change:

- `apps/web/src/**`, `apps/server/**`, `packages/**`
- `apps/web/e2e/**/*.spec.ts` except the new `capture-isolation.spec.ts`
- `apps/web/e2e/playwright.config.ts`, `scripts/verify.sh`, `scripts/e2e-slot.pl`
- anything else

New dependencies allowed: none

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Capture files use the per-test fixture | `node --test scripts/capture-scenarios.test.mjs` | exits 0. Every `apps/web/e2e/gui/**/*.capture.ts` imports `test` from `./capture-test.ts`, and none import `test` from `@playwright/test` or call `startCheckoutServer` |
| 2 | Scenarios do not share data | `cd apps/web && ../../scripts/e2e-slot.pl ./node_modules/.bin/playwright test -c e2e/playwright.config.ts e2e/capture-isolation.spec.ts` | exits 0. The web build already exists. Desktop passes. The other three projects skip with `Capture isolation runs on desktop-chromium only` |
| 3 | Existing shots still run | `pnpm --filter web run gui:capture` | exits 0 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0, and its `node --test scripts/` step includes `capture-scenarios.test.mjs` passing |

Run 2, 3, and 4 one at a time. The shell starts in the shared checkout. `cd` to this task's worktree first. Playwright outside pnpm needs `PATH="$PWD/node_modules/.bin:$PATH"`, or run `./node_modules/.bin/playwright` from `apps/web`.

## Unit tests to write

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `capture files take test from the per-scenario fixture` | Every capture file imports `test` from `./capture-test.ts` and does not import `test` from `@playwright/test` or call `startCheckoutServer` | One file goes back to `import { test } from '@playwright/test'`, so it uses the shared server |
| `a scenario keeps the tag it just created` | On desktop, one test sends `createTag` for `Leak marker capture` over the page WebSocket and the subscribed snapshot contains that tag | The fixture stopped the server before the read, or `createTag` never ran |
| `the next scenario starts from the fixture seed` | The following serial test's snapshot has no tag named `Leak marker capture` and does include member `Ada Fictional` | The fixture reused the previous test's server |
| `an unseeded scenario has no Current` | With `captureSeed: false`, `/` shows heading `Set up WardBoard` and the text `Ada Fictional` is absent | The unseeded option was ignored and the fixture ward was seeded |

## Edge cases (each needs a test)

- The next scenario starts clean even though the previous scenario created a ward-wide tag. Covered by `the next scenario starts from the fixture seed`.
- Steps inside one scenario share data. Covered by `a scenario keeps the tag it just created`.
- A scenario that requires no Current still gets an empty data directory. Covered by `an unseeded scenario has no Current`.
- A capture file that bypasses the fixture fails the structural test. Covered by `capture files take test from the per-scenario fixture`.

The isolation spec uses `test.describe.configure({ mode: 'serial' })` for the two seeded tests, so the second runs after the first in one worker. Skip the other projects with the exact reason `Capture isolation runs on desktop-chromium only`. The unseeded test is its own `test.describe` with `test.use({ captureSeed: false })`.

## Red evidence

Write `scripts/capture-scenarios.test.mjs` and `e2e/capture-isolation.spec.ts` before `capture-test.ts` gives each test its own server. Record both failures:

- `node --test scripts/capture-scenarios.test.mjs` exits non-zero because existing capture files still import `test` from `@playwright/test`.
- The isolation spec, still pointed at the shared global server (import `test` from `@playwright/test`), fails `the next scenario starts from the fixture seed` because `Leak marker capture` is still in the snapshot. An import error is not this red.

## Human checks

none

## Out of scope

- Per-test servers for the ordinary `*.spec.ts` suite
- Resetting only tags, or clearing between screenshots inside one `test()`
- Product UI, server, or core changes
- B-073, B-074, B-076, B-077
