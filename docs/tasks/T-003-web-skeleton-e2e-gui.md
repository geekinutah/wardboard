# T-003: Web skeleton, e2e harness, and GUI capture pipeline

**Milestone:** 1 — Foundations
**Depends on:** T-001, T-002
**Spec refs:** SPEC.md §10 (responsive web app; desktop, phone, presentation on a TV), §16.1; `docs/gui-verification.md` (viewports, pipeline, artifact paths, concurrency); AGENTS.md (Test stack, GUI verification, Parallel work)

## Goal
`apps/web` is a Vite + React + TypeScript client (`@wardboard/web`, filterable as `web`) that renders a minimal app shell showing the server's health. It has Vitest + Testing Library unit tests, a headless Playwright e2e suite run by `./scripts/verify.sh`, and `pnpm --filter web run gui:capture` produces screenshots at the desktop, phone (Chromium and WebKit) and TV viewports from a checkout-scoped server. Every step is concurrency-safe across worktrees. Playwright browsers are installed by `./scripts/setup.sh`.

## Design decisions (binding for this task)
- **Shell (`apps/web/src/App.tsx` and `src/shell-skeleton/` or similar)**: a `<header>` containing the brand text `WardBoard`, and a `<main>` with a status line. The status line uses an injectable health client (prop or context; default calls `GET /api/health` on the same origin) and shows exactly one of: `Checking server…` (pending), `Server: ok` (200 with `{"status":"ok"}`), `Server unreachable` (network error, non-200, or unexpected body). Use real `<header>`/`<main>` landmarks; text must say the state (not color only). Apply only minimal layout CSS (ground `#F3F4F1`, ink `#18212B`, system font fallback); T-004 owns tokens and fonts. No horizontal scroll at 390px.
- **Unit tests**: Vitest + `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` in jsdom.
- **Build**: `vite build` into `apps/web/dist/` (already gitignored). Dev server is not used by tests.
- **Playwright** config at `apps/web/e2e/playwright.config.ts` with projects exactly matching `docs/gui-verification.md`: `desktop-chromium` (1440×900), `phone-chromium` and `phone-webkit` (390×844, `isMobile: true`, `hasTouch: true`, `deviceScaleFactor: 3`; for WebKit use the same settings), `tv-chromium` (1920×1080). Headless. Output under `apps/web/test-results/` (gitignored by root rule).
- **Checkout-scoped server**: a Playwright global setup (or a helper both e2e and capture use) builds nothing itself; it starts `@wardboard/server`'s `startServer` in-process with `port: 0`, `host: 127.0.0.1`, a fresh `mktemp`-style data dir, and `webDir` = `apps/web/dist`, then exposes the bound URL as `baseURL`. Global teardown closes the server and deletes the temp dir. No fixed ports anywhere. Add a clearly marked seeding seam (no-op for now) where later tasks seed the fictional fixture ward.
- **Scripts in `apps/web/package.json`**:
  - `test` — Vitest unit tests.
  - `build` — `vite build`.
  - `test:e2e:playwright` — builds, then runs `playwright test` excluding `e2e/gui/`.
  - `test:e2e` — ensures Playwright Chromium and WebKit are installed (`playwright install chromium webkit`), then runs `test:e2e:playwright`.
  - `gui:capture` — builds, then runs the scenarios in `e2e/gui/`, writing `apps/web/gui-artifacts/<scenario>/<viewport>-<browser>.png` (e.g. `shell/desktop-chromium.png`, `shell/phone-webkit.png`). Clears that scenario's old images first.
- **e2e smoke (`apps/web/e2e/smoke.spec.ts`)**, run in all four projects: page loads from the real server, header shows `WardBoard`, status line reaches `Server: ok`, and the document has no horizontal overflow (`document.documentElement.scrollWidth <= window.innerWidth`).
- **GUI capture scenario `shell`** (`apps/web/e2e/gui/shell.capture.ts` or `.spec.ts`): load `/`, wait for `Server: ok`, screenshot full page in all four projects.
- **`scripts/verify.sh`**: replace T-001's e2e extension point with a step named `ensure_playwright_browsers` (`pnpm --filter web exec playwright install chromium webkit`) followed by `pnpm --filter web run test:e2e:playwright`.
- **`scripts/setup.sh`**: replace T-001's extension point with the same Playwright browser install so a fresh clone is fully ready.
- **Docs**: update `docs/agents/README.md`'s "Sandboxes that block the Playwright browser download" section so its references to the verify step name and install command match (`ensure_playwright_browsers`, `playwright install chromium webkit`); change nothing else in that file. Update the **Status** note at the top of `docs/gui-verification.md` to say the pipeline exists (built by T-003); change nothing else there. Add a short "Web e2e and GUI capture" line to the README's Requirements and setup section.
- **CI**: Playwright browsers on Ubuntu need system deps — the CI step that runs setup may use `playwright install --with-deps chromium webkit` (via an env flag the setup script honors, e.g. `WARDBOARD_PLAYWRIGHT_WITH_DEPS=1`) so the same scripts work in CI.

## Scope
May change:
- `apps/web/` (new: everything)
- `scripts/verify.sh` (e2e step only), `scripts/setup.sh` (Playwright step only), `scripts/*.test.mjs` (only to test the setup flag, if added)
- `.github/workflows/ci.yml` (Playwright deps env/step only)
- `.gitignore` (append only, if anything beyond the existing `apps/web/gui-artifacts/` line is needed)
- `docs/agents/README.md` (Playwright sandbox section references only), `docs/gui-verification.md` (Status note only), `README.md` (one line in Requirements and setup)
- `pnpm-lock.yaml`

Must not change:
- `packages/**`, `apps/server/**`, `SPEC.md`, `AGENTS.md`, other docs, anything else

New dependencies allowed (`apps/web`): `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `@playwright/test`, `@wardboard/server` (`workspace:*`, devDependency for the e2e server), `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` (only if extending the root lint config for React).

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web test` | `App.test.tsx` (or equivalent) passes, covering the cases below |
| 2 | e2e in all four projects | `pnpm --filter web run test:e2e` | smoke passes in `desktop-chromium`, `phone-chromium`, `phone-webkit`, `tv-chromium` (4 passed) |
| 3 | GUI capture produces images | `pnpm --filter web run gui:capture && ls apps/web/gui-artifacts/shell/` | exits 0; lists `desktop-chromium.png`, `phone-chromium.png`, `phone-webkit.png`, `tv-chromium.png` |
| 4 | Screenshots look right | open each PNG with an image viewer | brand and `Server: ok` visible, nothing clipped, no horizontal scrollbar on phone images |
| 5 | Concurrent runs don't collide | run `pnpm --filter web run test:e2e` simultaneously in two worktrees of the candidate | both pass |
| 6 | Setup installs browsers | `./scripts/setup.sh` in a fresh clone | exits 0 and Chromium + WebKit are reported installed |
| 7 | Gate includes e2e | `./scripts/verify.sh` | exits 0; output shows the `ensure_playwright_browsers` step and Playwright results |
| 8 | Gate fails on broken e2e | in a disposable copy, change the brand text to `WardBored`, run `./scripts/verify.sh` | exits non-zero at the e2e step |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `shows the brand in a header landmark` | `getByRole('banner')` contains `WardBoard` | brand in a div |
| `shows Checking server while health is pending` | pending promise → `Checking server…` | no pending state |
| `shows Server: ok when health is ok` | resolved `{status:'ok'}` → `Server: ok` | state never updates |
| `shows Server unreachable on network error` | rejected client → `Server unreachable` | unhandled rejection / stays pending |
| `shows Server unreachable on a non-ok response or unexpected body` | 500, and 200 with `{"status":"down"}` → `Server unreachable` | treats any 200 as ok |
| `default health client calls /api/health` | with `fetch` stubbed at the global boundary, the default client requests `/api/health` and maps the response | wrong URL |
| e2e `smoke` | real server round trip at every viewport, no horizontal overflow | server not started, web not built, overflow at 390px |

## Edge cases (each needs a test)
- Health pending, ok, network error, non-200, unexpected JSON body.
- Phone viewport overflow check runs in WebKit as well as Chromium.

## Human checks
- On an iPhone on the tailnet (once T-063 exists), open WardBoard and confirm the shell renders without horizontal scroll — WebKit in Playwright is not a real iPhone. Deferred until deployment; record as pending.

## Out of scope
- Design tokens, fonts, components (T-004); any real board UI.
- Changes to `apps/server` (use its public `startServer` only). If the server API is insufficient, report BLOCKED.
- Docker (T-006).
