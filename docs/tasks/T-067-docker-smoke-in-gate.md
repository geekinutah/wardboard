# T-067: Run the Docker smoke test in the quality gate

**Milestone:** 1 — Foundations (follow-up to T-001/T-006; promoted from B-018)
**Depends on:** T-066 (must be **done and merged** first: until then the smoke fails on main and this gate would be red everywhere)
**Spec refs:** AGENTS.md § Commands ("`./scripts/verify.sh` must pass before any task is reported done. Never skip, disable, or weaken it"); T-006 contract (Docker smoke)

## Goal
`./scripts/verify.sh` runs `./scripts/docker-smoke.sh` as its final step, so every implementer, verifier, Stop hook and integrated gate proves the shipped image still builds, starts and passes the smoke checks. A machine without a working Docker daemon fails the gate loudly; it never skips the step.

Background (B-018): the `docker-smoke` CI job was red on main for a day after T-006 merged and no controller noticed, because only CI ran the smoke. Mike chose this option (2026-10-26) over controller CI-watching. Measured cost: ~21 s per run locally with a warm build cache, ~35–40 s in CI.

## Design decisions (binding)
- **verify.sh:** add a final step after the e2e step: `step "docker smoke: ./scripts/docker-smoke.sh"` then `./scripts/docker-smoke.sh`. Unconditional: no `if`, no `||`, no environment variable or flag that skips or softens it. Update the header comment's concurrency note to say the smoke uses unique image/container/volume names and an ephemeral loopback port, so concurrent gates in separate worktrees don't collide.
- **docker-smoke.sh daemon precheck:** after the existing "docker CLI not found" check, add a check that `docker info` succeeds (output discarded). If it fails, print to stderr a single clear message starting `docker smoke: Docker daemon is not reachable` that says to start OrbStack/Docker (or, in a sandbox, to grant Docker access) and that the gate cannot pass without it, then exit 1. Change nothing else in the smoke script.
- **CI:** remove the now-redundant `docker-smoke` job from `.github/workflows/ci.yml`; the `verify` job runs the smoke via `verify.sh` on `ubuntu-latest`, which has Docker. Change nothing else in the workflow.
- **Docs:** `README.md`'s quick-start comment for `./scripts/verify.sh` names the Docker smoke step and that a running Docker (OrbStack on macOS) is required. `docs/agents/README.md` gains a short subsection (next to the existing Playwright sandbox guidance) saying the gate needs a reachable Docker daemon; an environment without one reports the gate BLOCKED and must not skip, stub or work around the step.

## Scope
May change:
- `scripts/verify.sh` (the new final step and the header concurrency comment only)
- `scripts/docker-smoke.sh` (the daemon precheck only)
- `.github/workflows/ci.yml` (delete the `docker-smoke` job only)
- `scripts/docker.test.mjs`, `scripts/ci-workflow.test.mjs` (new tests only; no existing test changed or removed)
- `README.md` (the quick-start `verify.sh` comment line only)
- `docs/agents/README.md` (the new Docker-gate subsection only)

Must not change:
- `docker/**`, `.dockerignore`, `packages/**`, `apps/**`, `scripts/verify-hook.sh`, `scripts/setup.sh`, `scripts/env-check.mjs`, `docs/tasks/**`, anything else

New dependencies allowed: none.

## Acceptance criteria

Application unit tests do not apply: gate/CI/docs configuration with no application behavior. Script-level tests (`node:test`), real runs and mutations replace them. Docker must be available (`docker info` succeeds); otherwise report BLOCKED.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Script tests pass | `node --test scripts/` | `# fail 0`; the new tests below are listed as passing |
| 2 | Red before green | run the new tests before the script/CI edits | each new test fails for the expected reason; record output |
| 3 | Gate runs the smoke and passes | `./scripts/verify.sh > <log> 2>&1; echo exit=$?` | `exit=0`; the log contains `==> [verify] docker smoke: ./scripts/docker-smoke.sh`, then `docker smoke: OK`, then `verify: all steps passed` (in that order) |
| 4 | Gate fails when the smoke fails | in a disposable copy of the candidate, delete `**/fixtures/` from `.dockerignore` (re-introducing B-015) and run `./scripts/verify.sh; echo exit=$?` | non-zero exit; output ends with `verify: FAILED at step "docker smoke: ./scripts/docker-smoke.sh"`; remove the copy afterwards |
| 5 | Daemon unreachable fails clearly | covered by the new test `docker-smoke.sh exits non-zero with a clear message when the docker daemon is unreachable` (check 1); additionally run `DOCKER_HOST=unix:///nonexistent.sock ./scripts/docker-smoke.sh; echo exit=$?` | message starts `docker smoke: Docker daemon is not reachable`; `exit=1`; no build attempted |
| 6 | Concurrent gates don't collide | from two separate worktrees of the candidate, start `./scripts/docker-smoke.sh` in both at the same time | both print `docker smoke: OK` and exit 0; afterwards `docker ps -a --filter name=wardboard-smoke -q` and `docker volume ls --filter name=wardboard-smoke -q` print nothing |
| 7 | Mutation of the structural checks | in a disposable copy: (a) wrap the verify.sh smoke line in `if command -v docker …; then … fi`; (b) append `\|\| true` to it; (c) delete the step; (d) delete the daemon precheck from docker-smoke.sh. Run check 1 after each, reverting between | each makes at least one new test fail; record output |
| 8 | Only scoped files changed | `git diff --stat origin/main...HEAD` | only the files in scope |
| 9 | CI green on the task branch | push the **task branch only** (`git push origin HEAD:<task-branch>`; never `main`), then `gh run view <id> --json jobs --jq '.jobs[] \| "\(.name) \(.conclusion)"'` | a single `verify success` job (no `docker-smoke` job); its log shows `docker smoke: OK`. If `gh` is unavailable, report not run with the reason |

## Unit tests to write
| Test name | File | Behavior it proves | A bug that would make it fail |
|---|---|---|---|
| `verify.sh runs the docker smoke as an unconditional final step` | `scripts/docker.test.mjs` | The last `step "…"` in verify.sh is the docker smoke step, it is followed by a line that is exactly `./scripts/docker-smoke.sh`, and that line is not inside an `if`/`case`/function, has no `\|\|`, `&&`, `;` or trailing `&`, and verify.sh references no `SKIP`/`NO_DOCKER`-style variable | step missing, guarded, softened with `\|\| true`, backgrounded, or made skippable |
| `docker-smoke.sh exits non-zero with a clear message when the docker daemon is unreachable` | `scripts/docker.test.mjs` | With a fake `docker` on PATH whose `info` subcommand exits 1 (and which records every invocation to a temp file), the script exits non-zero, stderr starts with `docker smoke: Docker daemon is not reachable`, and the fake recorded no `build` call | precheck missing (build attempted) or message unclear |
| `ci workflow runs the docker smoke only through verify.sh` | `scripts/ci-workflow.test.mjs` | The workflow has no job named `docker-smoke` and no other direct call of `docker-smoke.sh`; the `verify` job still runs `./scripts/verify.sh` | duplicate job left in, or the smoke moved out of the gate into CI only |

## Edge cases (each needs a check)
- Docker CLI missing: existing test `docker-smoke.sh exits non-zero with a clear message when docker is missing` still passes unchanged.
- Daemon down vs CLI missing produce different, specific messages (new test + existing test).
- Concurrent runs in two worktrees (check 6).
- The Stop hook (`scripts/verify-hook.sh`) needs no change: it runs `verify.sh`, so it inherits the step; existing verify-hook tests still pass (check 1).

## Human checks
- On the Mac Studio with OrbStack stopped, run `./scripts/verify.sh` and confirm it fails at the docker smoke step with the "daemon is not reachable" message rather than hanging.

## Out of scope
- Changing `setup.sh`'s non-fatal Docker hint or `env-check.mjs`.
- Speeding up the Docker build, pruning build cache, or B-013.
- Controller CI-watching guidance (not chosen).
