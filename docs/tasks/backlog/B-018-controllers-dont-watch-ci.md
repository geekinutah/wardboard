# B-018: No controller watches CI, and the integrated gate skips the Docker smoke

**Priority:** P1  
**Area:** agent process / CI  
**State:** candidate  
**Found:** 2026-10-26, controller investigation of B-015  
**Promoted to:** —

## Finding

The GitHub Actions `docker-smoke` job has failed on every push to `main` since T-006 merged (20 of the last 40 runs on main; the `verify` job passed each time). No controller noticed: the controller loop's integrated gate is `./scripts/verify.sh`, which doesn't run `scripts/docker-smoke.sh`, and nothing in `docs/agents/controller.md` or `protocol.md` says to check CI results after pushing. The break came from merge order: T-006 branched before T-007 added `packages/core/src/fixtures/`, its own smoke passed, and the smoke was never rerun on the integrated result.

## Risk

Red CI becomes normal and hides real regressions. T-021 would have broken the container entirely (loopback guard vs `WARDBOARD_HOST=0.0.0.0`) and was only caught because its contract happened to name the Docker edits. Any check that lives only in CI is effectively unenforced.

## Direction

Options, not mutually exclusive:
- Controllers check `gh run list --branch main --limit 1` (and job conclusions) after each push to `main`, and treat a red job as a blocker to record and fix before claiming new work. Document it in `docs/agents/controller.md`.
- The integrated gate also runs `./scripts/docker-smoke.sh` when Docker is available and the merge touches `docker/`, `.dockerignore`, `scripts/docker-smoke.sh`, or any path the Dockerfile copies (`apps/server/src`, `packages/core/src`, `apps/web/**` via the build, package manifests, lockfile).
- Consider whether `verify.sh` should run the smoke (cost: a Docker build per gate) or whether CI plus the controller check is enough.

Needs Mike's decision on how much gate time to spend.

## Evidence

- `gh run list --branch main --limit 40`: 20 failure / 19 success; failing job is `docker-smoke`, `verify` succeeds.
- Merge times: 48f9627 T-007 at 07:13, bf1f9cc T-006 merge at 07:58 (2026-10-26).
- B-015, T-066.
