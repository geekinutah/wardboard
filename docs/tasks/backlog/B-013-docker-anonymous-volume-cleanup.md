# B-013: Docker Engine 29 anonymous-volume cleanup

**Priority:** P2  
**Area:** docker  
**State:** candidate  
**Found:** 2026-10-26, T-006 independent verification round 1 (also observed by the T-006 implementer during its first smoke run)  
**Promoted to:** —

## Finding

Docker Engine 29 no longer deletes *anonymous* volumes when a container is removed with a plain `docker rm`. The T-006 smoke script's probe container (created to inspect the image filesystem for `fixtures/`) inherits an anonymous `/data` volume from the image's `VOLUME /data` declaration, so its cleanup must use `docker rm -f -v` rather than `docker rm`. The candidate does this correctly (a comment explains why, at `scripts/docker-smoke.sh:28-31`), and both the implementer's re-runs and the verifier's runs left no orphans.

## Risk

Low and tooling-only: a future edit that "simplifies" the probe cleanup to a plain `docker rm` would silently leak an anonymous volume per smoke run (observed once pre-fix: orphan volume `d1532ed…`, labeled `com.docker.volume.anonymous`, removed manually). No user data is affected; the smoke always uses fresh volumes. Any future tooling that `docker create`s from this image (deployment helpers, T-063 runbook scripts) inherits the same behavior.

## Direction

Keep the explanatory comment at `scripts/docker-smoke.sh:28-31` intact when editing the cleanup, and apply the same `rm -f -v` rule to any new container-creation code (e.g. the T-063 runbook). No repo change is required now.

## Evidence

- `scripts/docker-smoke.sh:28-31` (T-006, `d1fac2c`): probe container removed with `docker rm -f -v` with a comment explaining the Engine 29 anonymous-volume behavior.
- T-006 implementer report, round 1, in `docs/tasks/evidence/T-006.md`: orphan anonymous volume from the first (pre-fix) run, removed manually.
- T-006 independent verification, round 1, in `docs/tasks/evidence/T-006.md`: verifier's independent smoke and mutation runs left no containers, volumes, or images; recorded the same Engine 29 behavior as the suggested backlog candidate.
