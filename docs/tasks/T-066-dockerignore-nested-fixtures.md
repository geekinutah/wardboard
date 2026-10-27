# T-066: Keep nested fixtures out of the Docker image

**Milestone:** 1 — Foundations (follow-up to T-006; promoted from B-015)
**Depends on:** T-006 (done), T-007 (done), T-021 (done)
**Spec refs:** SPEC.md §15 (fixtures are fictional and stay out of production); AGENTS.md § Security rules; T-006 contract (the image contains no `fixtures/` directory)

## Goal
The Docker image contains no `fixtures/` directory at any depth, so `./scripts/docker-smoke.sh` passes again and the `docker-smoke` CI job on GitHub Actions turns green.

Background: `.dockerignore` lists `fixtures/`, which Docker matches only at the repository root (the anonymized LCR PDFs). T-007 later added `packages/core/src/fixtures/` (the fictional TypeScript ward). The runtime stage of `docker/Dockerfile` copies `packages/core/src`, so the image ships it and the smoke test's final step fails: `docker smoke: FAILED — image contains fixtures: app/packages/core/src/fixtures/`. The `docker-smoke` CI job has failed on every push to main since T-006 merged. Only test files import the core fixtures (`packages/core/test/**`); no production code does.

## Design decisions (binding)
- Add the line `**/fixtures/` to `.dockerignore`, directly after the existing `fixtures/` line. Keep `fixtures/` and every other existing entry unchanged.
- Do not move the core fixtures, change `packages/core/package.json`, the Dockerfile, or the smoke script. Do not loosen the smoke script's fixtures check.
- Add one new test to the `.dockerignore` describe block in `scripts/docker.test.mjs`. Change no existing test.

## Scope
May change:
- `.dockerignore` (one added line)
- `scripts/docker.test.mjs` (one new test in the `.dockerignore` describe block; no existing test changed)

Must not change:
- `docker/**`, `scripts/docker-smoke.sh`, `packages/**`, `apps/**`, `scripts/verify.sh`, `.github/**`, `docs/**` (the controller owns STATUS and evidence), anything else

New dependencies allowed: none.

## Acceptance criteria

Application unit tests do not apply: configuration-only change with no application behavior. The structural test, the real Docker smoke run and a mutation replace them. Docker must be available locally (`docker info` succeeds); if it isn't, report BLOCKED. Don't skip checks 3–5.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural test passes | `node --test scripts/docker.test.mjs` | `# fail 0`; the new test is listed as passing |
| 2 | Red before green | run check 1 with the new test added but before editing `.dockerignore` | the new test fails with a message naming `**/fixtures/`; record the output |
| 3 | Smoke passes end to end | `./scripts/docker-smoke.sh; echo exit=$?` | `    no fixtures/ in the image`, `docker smoke: OK`, `exit=0` |
| 4 | Smoke failed before the fix | `./scripts/docker-smoke.sh; echo exit=$?` on the unchanged base (e.g. a temporary detached worktree at the base commit) | `docker smoke: FAILED — image contains fixtures: app/packages/core/src/fixtures/...`, non-zero exit; record it |
| 5 | Mutation | in a disposable copy of the candidate, delete the `**/fixtures/` line; run check 1 and check 3 | the new test fails, and the smoke fails at the fixtures step; record both; remove the copy afterwards |
| 6 | Only scoped files changed | `git diff --stat origin/main...HEAD` | exactly `.dockerignore` (1 insertion) and `scripts/docker.test.mjs` |
| 7 | Quality gate | `./scripts/verify.sh > /tmp/t066-verify.log 2>&1; echo exit=$?` (or a scratch path of your choice) | `exit=0`, log ends with `verify: all steps passed` |
| 8 | CI on the task branch | push the **task branch only** (`git push origin HEAD:t-066-dockerignore-nested-fixtures`; never push `main`), then `gh run list --branch t-066-dockerignore-nested-fixtures --limit 1` and `gh run view <id> --json jobs --jq '.jobs[] \| "\(.name) \(.conclusion)"'` once it finishes | `verify success` and `docker-smoke success`. If `gh` is unavailable or unauthenticated, report this check as not run with the reason; don't claim it |

Run at most one `docker-smoke.sh` or `verify.sh` at a time in a worktree.

## Unit tests to write (structural, in `scripts/docker.test.mjs`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `dockerignore excludes fixtures directories at any depth` | The non-comment, trimmed entries of `.dockerignore` include `**/fixtures/` (or the equivalent `**/fixtures`), and no later line re-includes them with a `!` pattern matching `fixtures` | the nested pattern missing (only root `fixtures/` listed, as on main today), or a later `!**/fixtures/...` exception undoing it |

## Edge cases (each needs a check)
- Root `fixtures/` (the LCR PDFs) stays excluded: the existing `dockerignore keeps fixtures, data and env out` test still passes unchanged (check 1).
- The image still builds and serves the web shell without the core fixtures in the build context: check 3's earlier smoke steps (health, `/` with identity, `/` without identity → 401, non-root, `/data` survives restart) all pass.
- A negation re-including fixtures is caught (the new test's second clause).

## Human checks
none. CI's `docker-smoke` job on main turning green after merge is checked by the controller.

## Out of scope
- Moving `packages/core/src/fixtures/` out of `src`, or changing the `./fixtures` package export.
- Adding the Docker smoke to `verify.sh`, or any change to how controllers watch CI (that's B-018).
- Any other Docker, compose or smoke-script change.
