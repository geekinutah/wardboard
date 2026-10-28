# T-091: Machine-wide Playwright slot pool

**Milestone:** — (test infrastructure, off-roadmap)
**Depends on:** none
**Spec refs:** AGENTS.md "Parallel work", "Commands" (`./scripts/verify.sh` must pass) and "Testing rules" item 6; `docs/agents/controller.md` § Parallelism ("The gates must be concurrency-safe"); backlog B-045.

## Goal
Concurrent e2e runs in separate worktrees stop failing from CPU contention. Every Playwright run goes through a Perl wrapper that takes one of 2 machine-wide slots and runs Playwright with 6 workers, so the whole machine never runs more than 12 Playwright workers. A third run waits for a free slot instead of overloading the machine.

## Background
See `docs/tasks/backlog/B-045-parallel-e2e-contention.md`. Today `apps/web/e2e/playwright.config.ts` sets no `workers`, so each run uses Playwright's default of half the logical cores (8 on a 16-core Mac). Two concurrent gates run about 16 headless browsers, and timing-sensitive specs fail (`editing.spec.ts:107`, `:134`, `out-of-unit.spec.ts:3`, `proposals.spec.ts:14`). Each spec passes when run alone.

## Design decisions (binding)
- **One file holds all the logic:** `scripts/e2e-slot.pl`, executable, `#!/usr/bin/env perl`, core Perl modules only (`Fcntl` and the like). Usage: `scripts/e2e-slot.pl <command> [args...]`. It runs `<command> [args...] --workers=<W>`.
- **Fixed sizes:** 2 slots (`S`) of 6 workers (`W`). Callers cannot ask for a different size. The environment variables `WARDBOARD_E2E_SLOTS` and `WARDBOARD_E2E_WORKERS` override `S` and `W` (for tests and other machines). Each must be a positive integer, otherwise the wrapper exits 2 with a message naming the variable and does not run the command.
- **Lock directory:** `/tmp/wardboard-e2e-slots`, overridable with `WARDBOARD_E2E_SLOT_DIR`. Do not derive it from `$TMPDIR` or the checkout path: agent harnesses give each session its own `$TMPDIR`, and every worktree and session on the machine must share one pool. The wrapper creates the directory if missing. Another wrapper creating it at the same moment is not an error.
- **Slot files:** `slot-0` through `slot-<S-1>` in the lock directory, opened read/write and created if missing, never truncated and never deleted. The lock is the `flock` on the open file; the contents don't matter. (Deleting a slot file would let two runs hold "the same" slot on different files.)
- **Acquire:** try every slot with `flock(LOCK_EX | LOCK_NB)`. Keep the first one that succeeds and close the others. If every slot is taken, print one line to stderr, `e2e-slot: all <S> slots busy, waiting`, and then try them all again once a second until one is free. Never block on one particular slot.
- **Run:** after acquiring, print `e2e-slot: slot <i> acquired, workers=<W>` to stderr and `exec` the command (the wrapper's process becomes the command, no child process). The slot's file descriptor must survive `exec` (Perl marks descriptors above `$^F` close-on-exec, so raise `$^F` before opening the slot files), so the command itself holds the lock and the OS releases it when the command exits or is killed. If `exec` fails, print the error and exit 127.
- **Worker flag:** the wrapper appends `--workers=<W>`. If the caller's arguments already contain `--workers`, `--workers=…`, `-j` or `-j…`, exit 2 with a message and do not run the command. With no command, print usage and exit 2.
- **Callers:** in `apps/web/package.json`, `test:e2e:playwright` becomes `pnpm run build && ../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts`. `gui:capture` becomes `pnpm run build && WARDBOARD_GUI_CAPTURE=1 ../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts`. The build stays outside the slot. No other script changes.
- **No other gate changes:** `playwright.config.ts`, `global-setup.ts`, `checkout-server.ts`, the specs and `scripts/verify.sh`'s steps stay as they are. No timeouts are raised and `retries: 0` stays.
- **Docs:** fix the concurrency comment at the top of `scripts/verify.sh` (it says the gate writes only inside the checkout; the e2e step now also uses the shared slot directory, and concurrent e2e steps queue for 2 slots). In `docs/gui-verification.md` pipeline step 1, say that captures share the machine-wide slot pool, and that ad-hoc Playwright runs should go through `scripts/e2e-slot.pl` too (with an example, e.g. `cd apps/web && ../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts e2e/editing.spec.ts`).

## Scope
May change:
- `scripts/e2e-slot.pl` (new)
- `scripts/e2e-slot.test.mjs` (new)
- `apps/web/package.json` (only the `test:e2e:playwright` and `gui:capture` scripts)
- `scripts/verify.sh` (only the header comment)
- `docs/gui-verification.md` (only pipeline step 1, plus the ad-hoc-run note)

Must not change:
- `apps/web/e2e/**`, `apps/web/src/**`, `apps/server/**`, `packages/**`
- any step or command in `scripts/verify.sh`
- anything else

New dependencies allowed: none (Perl core modules only; Perl ships with macOS and the `ubuntu-latest` CI image)

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Wrapper tests | `node --test scripts/e2e-slot.test.mjs` | every test in the table below passes, 0 failures |
| 2 | All script tests still pass | `node --test scripts/` | 0 failures |
| 3 | Lint | `pnpm run lint` | exits 0 |
| 4 | Scope | `git diff --name-only <base>..HEAD` | only paths listed under "May change" |
| 5 | Solo e2e uses one slot | `pnpm --filter web run test:e2e:playwright` (no other run active) | exits 0; output contains `e2e-slot: slot 0 acquired, workers=6` (or slot 1 if another session holds slot 0; say which) and Playwright reports `using 6 workers` |
| 6 | Concurrent e2e queues and passes (the B-045 proof) | In three separate worktrees on the candidate, start `pnpm --filter web run test:e2e:playwright` at the same time. Repeat the round twice. | In each round all three exit 0. Two runs print `slot … acquired` at once; the third prints `e2e-slot: all 2 slots busy, waiting` and acquires only after one of the first two exits. Record the trimmed output and timestamps of each run. If a spec fails, report the failure and output; do not raise timeouts or add retries |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 with `verify: all steps passed` |

AC6 needs the three worktrees and enough time for six e2e runs. Remove the extra worktrees afterwards and record that in the report.

## Unit tests to write
In `scripts/e2e-slot.test.mjs` with `node:test`, following `scripts/verify-hook.test.mjs`. Every test uses its own `mkdtemp` slot directory via `WARDBOARD_E2E_SLOT_DIR`, so tests never touch the real pool. The command under the wrapper is a small fake written by the test (e.g. a `node -e` script) that prints its pid and arguments, then waits until the test tells it to exit or kills it. Wait on printed output (the fake's ready line, the wrapper's stderr lines), never on fixed sleeps.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `runs the command with --workers appended` | the fake receives its original arguments followed by `--workers=6` by default, and `--workers=3` with `WARDBOARD_E2E_WORKERS=3` | flag missing, wrong default, override ignored, arguments reordered |
| `execs instead of spawning a child` | the pid the fake prints equals the pid of the process the test spawned | the wrapper forks and waits, leaving a parent process that holds the lock |
| `the command holds the slot lock` | while the fake runs, a separate process (e.g. `perl -MFcntl=:flock` from the test) cannot take a non-blocking `flock` on that slot file | descriptor closed on `exec` (`$^F` not raised), so the lock is dropped while the command runs |
| `S runs hold S different slots` | with `WARDBOARD_E2E_SLOTS=2`, two concurrent wrappers both start and report different slot numbers | always taking slot 0, or two runs sharing a slot |
| `a run waits while every slot is busy` | with `WARDBOARD_E2E_SLOTS=1`, a second wrapper prints `e2e-slot: all 1 slots busy, waiting` and its fake has not started | ignoring a failed `flock` and running anyway |
| `a waiting run starts when a slot frees` | after the first fake exits normally, the waiting wrapper's fake starts | waiting forever, or blocking on one slot instead of retrying all |
| `a killed holder frees its slot` | after SIGKILL to the first fake, the waiting wrapper's fake starts | the lock held somewhere that survives the kill (a lingering parent, a lock file used as a marker) |
| `takes a free slot when another is busy` | with `S=2` and slot 0 held by the test, the wrapper starts at once on slot 1 without the waiting line | blocking on slot 0 rather than trying the others |
| `creates the directory and slot files and keeps them` | starting from a missing directory, the directory and `slot-0`…`slot-<S-1>` exist afterwards, and remain after the fake exits | not creating the directory, or deleting slot files on exit |
| `existing slot files are reused untouched` | a slot file with existing contents keeps them after a run | truncating the slot file on open |
| `refuses invalid sizes` | `WARDBOARD_E2E_SLOTS` or `WARDBOARD_E2E_WORKERS` set to `0`, `-1` or `abc` exits 2 with a message naming the variable, and the fake never runs | accepting zero slots (hangs forever) or non-numbers |
| `refuses a caller-supplied worker count` | arguments containing `--workers 4`, `--workers=4`, `-j 4` or `-j4` exit 2 and the fake never runs | silently passing two worker flags |
| `usage error with no command` | no arguments exits 2 with a usage message | running nothing and exiting 0 |
| `reports a command that cannot run` | a nonexistent command exits 127 and releases the slot (a following run acquires it immediately) | exiting 0, or leaving the slot held |
| `e2e scripts go through the wrapper` | in `apps/web/package.json`, `test:e2e:playwright` and `gui:capture` both run `../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts`, after `pnpm run build` | a script that still calls `playwright test` directly, or takes the slot before building |

## Edge cases (each needs a test)
- Lock directory missing; two wrappers creating it at once is covered by `S runs hold S different slots` starting from a missing directory.
- Every slot busy; one of several busy.
- Holder exits normally; holder is killed with SIGKILL.
- Invalid `S` or `W` (zero, negative, non-numeric).
- Caller already passes a worker count, in each of the four spellings.
- No command; a command that does not exist.

## Human checks
none

## Out of scope
- Fixing timing in individual specs (e.g. `mouseDrag` fixed steps). If AC6 still fails, report it with output; don't change specs.
- Sharding, per-caller slot sizing, or a remote browser pool.
- Changing `playwright.config.ts` or any `scripts/verify.sh` step.
- Making the slot sizes depend on the core count.
