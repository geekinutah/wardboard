# AGENTS.md

Rules for every agent working in this repo: the controller, implementers, verifiers, and any human-launched session. The product spec is `SPEC.md`. This file is how we build it.

## The one rule

**No work is done until it is verified.** A task is verified only when:
1. Its acceptance criteria are written as commands with expected results.
2. Those commands were run and produced those results.
3. Unit tests that cover new application behavior exist, fail without the change, and pass with it. Documentation/configuration-only tasks instead require contract-defined executable structural checks and a mutation proving they detect a realistic defect. The full quality gate remains mandatory.

"It should work", "I believe this is correct", and "tests pass" without output are not verification.

## Repo layout

```
apps/mobile/        Expo app (iOS, web, TV)
apps/api/           Cloudflare Worker (Hono) + D1 migrations
packages/core/      Pure TypeScript domain logic, no React, no I/O
docs/tasks/         Task contracts, backlog index/items, and STATUS.md ledger
docs/agents/        Canonical roles, handoff protocol, and harness startup guide
.claude/agents/     Claude Code adapters (configuration and shared-role pointers)
.codex/agents/      Codex adapters (configuration and shared-role pointers)
.grok/agents/       Grok Build adapters (configuration and shared-role pointers)
scripts/verify.sh   The single quality gate
SPEC.md             Product spec (source of truth for behavior)
HUMAN_BACKLOG.md    Work that needs Mike (accounts, stores, hardware, parked secrets)
```

Put logic in `packages/core` whenever possible: the shuffled deck, task state transitions (done, archive, recurring), sync merge and conflict resolution, validation. Pure functions are cheap to unit test. UI and Worker code should be thin layers over `core`.

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
| Web e2e (Playwright/Chromium) | `pnpm --filter mobile run test:e2e` (also run by `./scripts/verify.sh` after `export:web`) |

`./scripts/verify.sh` must pass before any task is reported done. Never skip, disable, or weaken it.

**Gate Python.** The gate needs Python 3.11+ (`tomllib`) whose reverse lookups do not stall. Homebrew's framework `Python.app` can take about 35 s per `socket.getfqdn('127.0.0.1')` (B-153). `scripts/gate-python.sh` picks the interpreter: `$WARDBOARD_PYTHON`, else `~/.venvs/wardboard-gate/bin/python3` (override the directory with `WARDBOARD_GATE_VENV`), else `python3` on PATH. It fails fast with the setup command if the choice is too old or stalls. One-time setup per machine (no packages needed): `uv venv --python 3.14 ~/.venvs/wardboard-gate`. `./scripts/verify.sh` puts the choice first on PATH as `python3` for its own run only; nobody's default interpreter or shell profile changes.

## Test stack

- `packages/core`: Vitest.
- `apps/api`: Vitest with `@cloudflare/vitest-pool-workers` (real D1/KV bindings in tests, no hand-rolled mocks of Cloudflare APIs).
- `apps/mobile`: Jest (jest-expo preset) + React Native Testing Library.
- End-to-end: Playwright (Chromium only, headless) against the web export; `./scripts/verify.sh` runs it after `export:web`.

## Testing rules (mandatory)

1. **Every behavior change ships with unit tests** in the same task. No "tests in a follow-up task."
2. **Red before green.** Write the test first and run it to see it fail for the expected reason. Record that failing output in the task report.
3. **Test behavior, not implementation.** Assert on outputs and observable effects, not private internals.
4. **No hollow tests.** Forbidden: tests with no assertions, `expect(true)`, snapshot-only tests for logic, assertions that restate the mock, tests that catch and swallow errors.
5. **Never weaken tests to get green.** Do not delete, skip (`.skip`, `.only`, `xit`), loosen, or rewrite existing tests to pass. If an existing test is genuinely wrong per `SPEC.md`, stop and report it; do not change it.
6. **Deterministic.** Inject randomness (seeded RNG) and time (injectable clock). No sleeps, no network, no order-dependence.
7. **Cover the edges** named in the task contract: empty inputs, boundaries, error paths, and authorization failures.

## Things that cannot be unit tested

Some requirements are about feel: "pressing the button feels great", animation smoothness, sound design. Agents must not claim to have verified these. Instead:
- Unit test everything underneath them (e.g. the press state machine handles rapid presses without queuing; sound and haptics respect settings).
- Mark the remainder as a **human check** in the task report, with exact steps for Mike to try on a device.

## GUI verification (mandatory for UI-touching tasks)

Unit tests (Jest/RNTL) prove props, callbacks, and accessibility state are wired correctly. They do not prove a screen actually looks right — a control can pass an `accessibilityState={{selected}}` assertion while looking visually identical whether selected or not; a button can pass every interaction test while rendering as a full-width bar that looks like a navigation header. This happened for real in Milestone 2 (the Tasks screen's category selector) and slipped past implementer, verifier, and the full test suite because nothing in the loop ever rendered and looked at the screen.

The fix is not a human in the loop — it's `docs/gui-verification.md`: a working, scripted pipeline (iOS Simulator + `idb` for real taps/typed text + `ffmpeg`/BlackHole for audio + screenshot/video capture) that any agent can drive from the command line, no GUI window or human interaction required. **Any task whose scope touches `apps/mobile/app/**` or `apps/mobile/src/components/**` requires this**, for both the implementer (self-check before reporting PASS) and the verifier (independent check before marking the task done — see `docs/agents/verifier.md`'s check 8). A verifier that only re-runs the test suite for a UI task has not done its job.

If a rendering defect is found that contradicts the task’s acceptance criteria, applicable `SPEC.md` requirements for the task, or correctness of the changed behavior (stretched/mis-styled controls, missing safe-area insets, invisible state changes, overlap, clipping), that's a real bug — cite file:line and the relevant SPEC.md section, and send it back through the normal implementer/verifier loop like any other FAIL. Don't escalate to Mike for these; escalate only when SPEC.md itself is genuinely ambiguous or silent on what's correct. Aesthetic taste calls with no SPEC.md basis (spacing you'd personally choose differently, color preference) are not bugs to file — see `docs/gui-verification.md`'s "what counts as a real finding" section.

## Scope discipline

- Change only files listed in the task contract's scope. If other files must change, stop and report why.
- Don't refactor, rename, or reformat outside scope.
- Don't add dependencies unless the contract allows it. Prefer free tiers; never add paid services.
- Follow `SPEC.md`. If the spec is ambiguous or seems wrong, stop and ask rather than guessing.

## Security rules

- Every API query is scoped to the session's `account_id` via the Worker's auth middleware. Every endpoint gets a test proving another account's token can't read or modify data.
- Never commit secrets. Use `wrangler secret` and `.dev.vars` (gitignored).

## Parallel work

Parallelize by default. Tasks whose file scopes don't overlap, and that don't depend on each other, run at the same time, each in its own git worktree and branch from `main`. Serialize only when tasks share files or one needs the other's result. Each task is still independently verified, merged one at a time, and gated by `./scripts/verify.sh` on the integrated result. **This applies to the controller too**: never stage, commit, or merge directly in the shared main checkout while other controllers may be doing the same — a real git-index race there once silently folded one controller's staged files into another's unrelated commit. Do controller-side integration (cherry-picks, STATUS.md/BACKLOG.md bookkeeping, the integrated gate) in its own throwaway worktree and push straight from there; git's atomic, fast-forward-checked push is what actually prevents collisions, not care taken in a shared directory. See `docs/agents/controller.md` § Parallelism.

## Roles, handoffs, and reporting

Start with `docs/agents/README.md` for harness entry points (Claude Code, Codex, Grok Build, Google Antigravity). Canonical role behavior lives in `docs/agents/controller.md`, `implementer.md`, and `verifier.md`; all roles follow `docs/agents/protocol.md` for handoffs, capability requirements, and exact reporting formats. Harness adapters and dynamic delegation configurations contain pointers, not a second copy of the procedure. Model/provider selection belongs to the harness/user, not the canonical workflow.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

The controller delegates implementation and then independent verification. Switching roles inside the implementer’s existing session is not independent verification. Missing required capabilities are BLOCKED; never silently weaken the quality or GUI gates.
