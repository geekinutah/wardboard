# AGENTS.md

Rules for every agent working in this repo: the controller, implementers, verifiers, and any human-launched session. The product spec is `SPEC.md`. This file is how we build it.

## The one rule

**No work is done until it is verified.** A task is verified only when:
1. Its acceptance criteria are written as commands with expected results.
2. Those commands were run and produced those results.
3. Unit tests that cover new application behavior exist, fail without the change, and pass with it. Documentation/configuration-only tasks instead require contract-defined executable structural checks and a mutation proving they detect a realistic defect. The full quality gate remains mandatory.

"It should work", "I believe this is correct", and "tests pass" without output are not verification.

## Repo layout

WardBoard is a web app for desktop browsers and mobile browsers (phones), plus a presentation mode for a laptop driving a TV.

```
packages/core/      Pure TypeScript domain logic: board model, planning operations, diff, rules, search, summary. No React, no I/O
packages/importer/  Deterministic PDF parsing, normalization, allow-list, identity reconciliation. No network
apps/server/        Node server: HTTP + WebSocket operation channel, SQLite, auth, photos, backup/restore
apps/web/           React web client: desktop canvas, phone layout, presentation mode
tools/collector/    Local collection tool run in the user's signed-in browser session
docker/             Container build and compose files
docs/design/        Visual reference: tokens, rules, and the UI artboards
docs/tasks/         Task plan, contracts, backlog index/items, and STATUS.md ledger
docs/agents/        Canonical roles, handoff protocol, and harness startup guide
.claude/agents/     Claude Code adapters (configuration and shared-role pointers)
.codex/agents/      Codex adapters (configuration and shared-role pointers)
.grok/agents/       Grok Build adapters (configuration and shared-role pointers)
.opencode/agents/    OpenCode adapters (configuration and shared-role pointers)
scripts/verify.sh   The single quality gate
SPEC.md             Product spec (source of truth for behavior)
HUMAN_BACKLOG.md    Work that needs Mike (decisions, Church guidance, accounts, hardware)
```

Put logic in `packages/core` whenever possible: moves, swaps and releases, dugout membership, position changes, the presidency release rule, second-calling detection, needs-approval rules, net diff against the baseline, removed-member and removed-position flags, oversight grouping and the accepted summary, search. Pure functions are cheap to unit test. Server and web code should be thin layers over `core`; the server applies `core` operations, it does not reimplement them.

## Work state and backlog

| Source | Purpose |
|---|---|
| `SPEC.md` | Product roadmap and intended behavior |
| `docs/tasks/BACKLOG.md` | Compact index of discovered candidate work |
| `docs/tasks/backlog/B-###-*.md` | Finding, risk, evidence, and advisory direction |
| `docs/tasks/T-###-*.md` | Approved executable task contracts |
| `docs/tasks/STATUS.md` | Execution state for contracted work |

### Controller work selection and promotion

These work-selection rules apply to every controller, including the canonical controller loop.

1. Pull latest (`git pull origin main`) before inspecting work state. Consult `SPEC.md`, `docs/tasks/STATUS.md`, and the backlog index. Load individual backlog files only as needed.
2. Follow Mike's requested work source: use a named task/backlog item when supplied; when continuing the roadmap, select the next unfinished milestone. Backlog priority alone does not authorize switching work or expanding scope.
3. Accept backlog work only within Mike's authorized scope. Mark the item and index `accepted`, then create one or more normal `T-###` contracts using `docs/tasks/_TEMPLATE.md`. Record their IDs in the item's **Promoted to** field and track execution in `STATUS.md`.
4. When claiming a new task (`in progress`), immediately commit and push `STATUS.md` (and any new contract) to `origin/main` before starting implementation to prevent concurrent controller collisions. Final states (`done`, `blocked`) may be pushed with task merges or in batches.
5. Run the existing verifiability gate and implementer/verifier loop for each contract. A backlog item's proposed direction is advisory, not an implementation contract.
6. Mark the item and index `resolved` only when all resulting tasks are verified complete. Use `declined` for an intentional decision not to pursue the item; keep index and item state synchronized.

### Discovered work and scope

Finding an issue does not expand the current task's scope.

- Implementers and verifiers report out-of-scope findings under **Notes / blockers**, with the finding, risk, evidence (file/line or command output), and suggested priority/direction. Do not fix them or edit the backlog independently.
- The controller owns backlog mutations: deduplicate against the index and relevant items, then update an existing item or allocate the next unused `B-###` ID using `docs/tasks/backlog/_TEMPLATE.md`. Keep the index compact and put details in the individual file.
- Preserve actionable discoveries without duplicating roadmap work already represented in `SPEC.md`. Capture does not authorize implementation; backlog work requires promotion to a normal task contract first.
- An adjacent verifier finding fails the current task only when it contradicts that task's acceptance criteria, applicable `SPEC.md` requirements for the task, or correctness of the changed behavior. Otherwise report a backlog candidate without blocking the task.
- If completing the current contract requires an out-of-scope change, follow the existing scope/blocker rules; do not silently absorb it.

## Commands

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Full quality gate | `./scripts/verify.sh` |
| All unit tests | `pnpm -r test` |
| One package's tests | `pnpm --filter <pkg> test` |
| Typecheck | `pnpm -r typecheck` |
| Lint | `pnpm -r lint` |
| Web e2e (Playwright: Chromium + WebKit) | `pnpm --filter web run test:e2e` (also run by `./scripts/verify.sh`) |
| GUI screenshots | `pnpm --filter web run gui:capture` (see `docs/gui-verification.md`) |

`./scripts/verify.sh` must pass before any task is reported done. Never skip, disable, or weaken it.

## Test stack

- `packages/core`, `packages/importer`: Vitest.
- `apps/server`: Vitest against a real SQLite database in a temporary directory and a real WebSocket server on an ephemeral port. No hand-rolled mocks of SQLite or the WebSocket library.
- `apps/web`: Vitest + Testing Library (jsdom).
- End-to-end: Playwright (headless) against a locally started server, at the desktop, phone, and TV viewports defined in `docs/gui-verification.md`. Desktop and TV run in Chromium; the phone viewport runs in both Chromium and WebKit (iPhone browsers use WebKit).
- Fixtures are fictional. Never use real member data in tests, fixtures, screenshots, or logs.

## Testing rules (mandatory)

1. **Every behavior change ships with unit tests** in the same task. No "tests in a follow-up task."
2. **Red before green.** Write the test first and run it to see it fail for the expected reason. Record that failing output in the task report.
3. **Test behavior, not implementation.** Assert on outputs and observable effects, not private internals.
4. **No hollow tests.** Forbidden: tests with no assertions, `expect(true)`, snapshot-only tests for logic, assertions that restate the mock, tests that catch and swallow errors.
5. **Never weaken tests to get green.** Do not delete, skip (`.skip`, `.only`, `xit`), loosen, or rewrite existing tests to pass. If an existing test is genuinely wrong per `SPEC.md`, stop and report it; do not change it.
6. **Deterministic.** Inject randomness (seeded RNG) and time (injectable clock). No sleeps, no network, no order-dependence.
7. **Cover the edges** named in the task contract: empty inputs, boundaries, error paths, and authorization failures.

## Things that cannot be unit tested

Some requirements are about feel: how dragging a card feels, whether zoom transitions are smooth, whether the TV view is readable from across the room. Agents must not claim to have verified these. Instead:
- Unit test everything underneath them (e.g. a drop resolves to the right operation; zoom level changes at the defined thresholds; presentation mode hides notes).
- Mark the remainder as a **human check** in the task report, with exact steps for Mike to try in a desktop browser, on a phone, or on the office TV.

## GUI verification (mandatory for UI-touching tasks)

Unit tests (Vitest/Testing Library) prove props, callbacks, and accessibility state are wired correctly. They do not prove a screen actually looks right — a control can pass an `aria-pressed` assertion while looking identical whether pressed or not; a button can pass every interaction test while rendering as a full-width bar. In a sibling project this exact failure slipped past implementer, verifier, and the full test suite because nothing in the loop ever rendered and looked at the screen.

The fix is `docs/gui-verification.md`: a scripted Playwright pipeline that starts the app with fictional data, drives real clicks, drags, taps and typing, and captures screenshots at the desktop, phone, and TV viewports, with no human interaction required. **Any task whose scope touches `apps/web/src/**`** requires it, for both the implementer (self-check before reporting PASS) and the verifier (independent check before marking the task done — see `docs/agents/verifier.md`'s check 8). A verifier that only re-runs the test suite for a UI task has not done its job. Compare against the matching artboard in `docs/design/`.

If a rendering defect is found that contradicts the task's acceptance criteria, applicable `SPEC.md` requirements for the task, or correctness of the changed behavior (overlap, clipping, horizontal scroll on a phone, a state change that isn't visible, color used as the only signal, touch targets under 44px), that's a real bug — cite file:line and the relevant SPEC.md section, and send it back through the normal implementer/verifier loop like any other FAIL. Don't escalate to Mike for these; escalate only when SPEC.md itself is genuinely ambiguous or silent on what's correct. Aesthetic taste calls with no SPEC.md or `docs/design/` basis are not bugs to file — see `docs/gui-verification.md`'s "what counts as a real finding" section.

## Scope discipline

- Change only files listed in the task contract's scope. If other files must change, stop and report why.
- Don't refactor, rename, or reformat outside scope.
- Don't add dependencies unless the contract allows it. Prefer free tiers; never add paid services.
- Follow `SPEC.md`. If the spec is ambiguous or seems wrong, stop and ask rather than guessing.

## Security rules

- Every HTTP route and WebSocket connection except the health check requires a signed-in session. Every route and message type gets a test proving an unauthenticated or revoked session is refused; admin-only actions get a test proving an Editor is refused.
- Never commit secrets. Use a gitignored `.env`.
- Never commit real member data, real photos, real PDFs, or anything harvested from Church systems. Fixtures are fictional.
- Imports and collectors keep only allow-listed fields (SPEC §15); discarded fields must not reach storage, logs, or backups.

## Parallel work

Parallelize by default. Tasks whose file scopes don't overlap, and that don't depend on each other, run at the same time, each in its own git worktree and branch from `main`. Serialize only when tasks share files or one needs the other's result. Each task is still independently verified, merged one at a time, and gated by `./scripts/verify.sh` on the integrated result. **This applies to the controller too**: never stage, commit, or merge directly in the shared main checkout while other controllers may be doing the same — a real git-index race there once silently folded one controller's staged files into another's unrelated commit. Do controller-side integration (cherry-picks, STATUS.md/BACKLOG.md bookkeeping, the integrated gate) in its own throwaway worktree and push straight from there; git's atomic, fast-forward-checked push is what actually prevents collisions, not care taken in a shared directory. See `docs/agents/controller.md` § Parallelism.

## Roles, handoffs, and reporting

Start with `docs/agents/README.md` for harness entry points (Claude Code, Codex, Grok Build, OpenCode, Google Antigravity). Canonical role behavior lives in `docs/agents/controller.md`, `implementer.md`, and `verifier.md`; all roles follow `docs/agents/protocol.md` for handoffs, capability requirements, and exact reporting formats. Harness adapters and dynamic delegation configurations contain pointers, not a second copy of the procedure. Model/provider selection belongs to the harness/user, not the canonical workflow.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

The controller delegates implementation and then independent verification. Switching roles inside the implementer’s existing session is not independent verification. Missing required capabilities are BLOCKED; never silently weaken the quality or GUI gates.
