# B-020: Gate structural tests miss an early `exit 0` and `set +e` in the smoke

**Priority:** P2  
**Area:** tooling / quality gate  
**State:** candidate  
**Found:** 2026-10-26, T-067 round 1 verifier  
**Promoted to:** —

## Finding

- `verify.sh runs the docker smoke as an unconditional final step` (scripts/docker.test.mjs) does not detect an `exit 0` or `return` placed before the smoke step or anywhere earlier in `verify.sh`; the gate then reports success without running later steps (verifier mutations b5, b5b passed with `fail 0`).
- `set +e` inside `scripts/docker-smoke.sh` is not detected by any test.
- In `docker-smoke.sh exits non-zero … daemon is unreachable`, the restricted fake PATH lacks `date`, so the "no `build` invocation" assertion is never exercised (the stderr-prefix assertion still makes the test meaningful).

## Risk

A deliberate or careless early exit silently skips gate steps, including the Docker smoke. Low likelihood (a blunt, visible edit), high impact on gate trust.

## Direction

Assert `verify.sh` has no `exit`/`return` outside `on_exit`, or that every `step` line is reached (e.g. run verify.sh with stubbed commands via a test-only override and check all step banners print). Assert `docker-smoke.sh` keeps `set -euo pipefail` and never `set +e`. Symlink `date` into the daemon test's fake bin.

## Evidence

- T-067 verifier report (`docs/tasks/evidence/T-067.md`), ruling 3 and notes.
