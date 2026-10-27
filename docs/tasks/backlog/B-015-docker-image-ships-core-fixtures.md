# B-015: Docker image ships `packages/core/src/fixtures/`; docker smoke fails on main

**Priority:** P1  
**Area:** docker  
**State:** accepted  
**Found:** 2026-10-26, T-021 round 1 (implementer and verifier, independently)  
**Promoted to:** T-066

## Finding

T-007 (48f9627) added `packages/core/src/fixtures/{index,ward}.ts`. The Dockerfile copies `packages/core/src`, and `.dockerignore`'s `fixtures/` entry matches only a root-level directory, so the image contains the fictional fixture ward. `scripts/docker-smoke.sh` fails its final "image contains no fixtures" step on main (410cb06) for that reason, with or without T-021.

## Risk

T-006 requires an image with no fixtures. The smoke test is red on main, so it can no longer catch real Docker regressions (T-021's Docker changes had to be judged by reading past the failure). `verify.sh` does not run the smoke, so nothing flags it. The data is fictional, so there is no privacy exposure.

## Direction

Check whether any production code imports `src/fixtures/`. If not, `**/fixtures/` in `.dockerignore` may suffice; otherwise move core fixtures out of `src` (e.g. `packages/core/fixtures/` or a test-only export). Do not weaken the smoke check. Consider whether the Docker smoke should run in CI.

## Evidence

- T-021 evidence (`docs/tasks/evidence/T-021.md`): `docker smoke: FAILED — image contains fixtures: app/packages/core/src/fixtures/` on both candidate 47c8d1c and base 410cb06.
- `.dockerignore` line 11: `fixtures/`
