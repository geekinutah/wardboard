# T-085: Update OpenCode model test pin to arch-llama/qwen3.8-27b

**Milestone:** — (agent infra, off-roadmap)
**Depends on:** T-065 (done)
**Spec refs:** none (agent workflow). AGENTS.md § Roles, handoffs, and reporting; `docs/agents/protocol.md` (model choice belongs to the harness/user).

## Goal
Update `scripts/opencode-model.test.mjs` so `PIN` matches Mike's commit `129f482` (`arch-llama/qwen3.8-27b`), restoring `node --test scripts/` and `./scripts/verify.sh` on `main`.

## Scope
May change:
- `scripts/opencode-model.test.mjs`

Must not change:
- `.opencode/agents/**`, `docs/agents/README.md`, `scripts/verify.sh`, other `scripts/*.test.mjs`, anything else

New dependencies allowed: none.

## Acceptance criteria
Application unit tests do not apply: configuration/structural test update with no application behavior. Executable structural tests run in the gate plus a mutation replace them.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests pass | `node --test scripts/opencode-model.test.mjs` | `# fail 0`, all 8 tests in `opencode-model.test.mjs` pass |
| 2 | All script tests pass | `node --test scripts/` | `# fail 0` |
| 3 | Only scoped file changed | `git diff --name-only origin/main...HEAD` | `scripts/opencode-model.test.mjs` |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0, `verify: all steps passed` |

## Unit tests to write (structural, in `scripts/opencode-model.test.mjs`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `every opencode adapter pins arch-llama/qwen3.8-27b` | Each of the three adapter frontmatters (`.opencode/agents/{controller,implementer,verifier}.md`) has `model: arch-llama/qwen3.8-27b` | pin missing, duplicated, or wrong model |
| `opencode controller forbids model overrides` | `.opencode/agents/controller.md` names `arch-llama/qwen3.8-27b` and forbids overrides/switching | wrong pin or missing rule |
| `readme opencode model section matches the pin` | `### Model choice (OpenCode)` in `docs/agents/README.md` names `arch-llama/qwen3.8-27b` | README out of sync with `PIN` |
| `readme repo-wide model sentence names the opencode exception` | Line-5 paragraph in `docs/agents/README.md` names `arch-llama/qwen3.8-27b` | README intro out of sync with `PIN` |

## Edge cases (each needs a check)
- Mutation check (verifier): in a disposable copy, change `model: arch-llama/qwen3.8-27b` in `.opencode/agents/implementer.md` to `model: lmstudio/qwen3.8-27b-splash` and confirm `node --test scripts/opencode-model.test.mjs` fails.

## Human checks
none

## Out of scope
- Changing `.opencode/agents/*.md`, `docs/agents/README.md`, or any other harness's model guidance.
