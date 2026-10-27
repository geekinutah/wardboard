# T-065: OpenCode always uses qwen3.8-27b-splash

**Milestone:** — (agent infra, off-roadmap)
**Depends on:** T-064 (done)
**Spec refs:** none (agent workflow). AGENTS.md § Roles, handoffs, and reporting; `docs/agents/protocol.md` (model choice belongs to the harness/user).

## Goal
In the OpenCode harness every role (controller, implementer, verifier) always runs on `lmstudio/qwen3.8-27b-splash`. The model is pinned in the committed OpenCode adapters' frontmatter, and the controller never selects, overrides or switches models. The adapter and README say so, and a structural test in the quality gate keeps it that way.

**Amended 2026-10-26 (before any candidate was verified):** Mike's decision: "It should just use qwen3.8-27b-splash ALWAYS, until I change the docs." This replaces the first version's "inherit the session's model" design. The model ID is the one recorded in `docs/tasks/evidence/T-064.md` (`lmstudio/qwen3.8-27b-splash`).

Background: an OpenCode controller running Qwen3.8-27b, told by its adapter to "choose the model for each handoff… rather than inheriting", borrowed the Codex section's guidance and tried to hand T-017 to `openai/gpt-6.1-sol` and `openai/gpt-6.1-terra`, guessing relative strength from release timestamps. Mike's OpenCode has no OpenAI provider configured, so that handoff would fail.

## Design decisions (binding)
- **Pin:** the YAML frontmatter of each of `.opencode/agents/controller.md`, `.opencode/agents/implementer.md` and `.opencode/agents/verifier.md` gains exactly one line `model: lmstudio/qwen3.8-27b-splash`. Keep every other frontmatter key and the body unchanged (except the controller's Model choice section, below). No committed `opencode.json`/`opencode.jsonc`.
- `.opencode/agents/controller.md` § "## Model choice (OpenCode)" is replaced. New text must state, in substance:
  1. Every OpenCode role runs on `lmstudio/qwen3.8-27b-splash`, pinned in the adapters' frontmatter. This is Mike's standing decision; only Mike changes it, by editing these docs.
  2. Do not pass a `model` override on the subagent tool, and do not switch model or provider for any handoff, including correction rounds and security-sensitive tasks.
  3. Do not apply another harness's model guidance (e.g. the Codex or Claude Code sections) in OpenCode.
  4. Do not infer a model's capability from its name, release date or other metadata.
  5. Independence comes from a fresh verifier session, not a different model (consistent with `docs/agents/protocol.md`).
  6. Name the model in the handoff packet and controller report.
  7. If the pinned model cannot do a task, or the pin fails to load, report BLOCKED to Mike rather than switching models.
  It must no longer contain `pass it explicitly`, `rather than inheriting`, or `Never pin a model`.
- `docs/agents/README.md`:
  - The `### Model choice (OpenCode)` subsection is rewritten to match (all seven points, concise).
  - The repo-wide sentence on line 5, "Model settings remain unset in committed adapters", is amended to name the OpenCode exception (e.g. "…unset in committed adapters, except OpenCode, which pins `lmstudio/qwen3.8-27b-splash` (see Model choice (OpenCode))"). Nothing else in that paragraph changes.
  - Other harness sections are unchanged.
- New structural test `scripts/opencode-model.test.mjs` (`node:test`, `node:assert/strict`, no dependencies), run by the existing `node --test scripts/` gate step.

## Scope
May change:
- `.opencode/agents/controller.md` (frontmatter `model:` line and the Model choice section only)
- `.opencode/agents/implementer.md`, `.opencode/agents/verifier.md` (frontmatter `model:` line only)
- `docs/agents/README.md` (the line-5 sentence and the `### Model choice (OpenCode)` subsection only)
- `scripts/opencode-model.test.mjs` (new)

Must not change:
- `.claude/**`, `.codex/**`, `.grok/**`, other README sections, `docs/agents/{controller,implementer,verifier,protocol}.md`, `AGENTS.md`, `scripts/verify.sh`, other `scripts/*.test.mjs`, anything else

New dependencies allowed: none.

## Acceptance criteria

Application unit tests do not apply: documentation/configuration-only change with no application behavior. Executable structural tests run in the gate plus a mutation replace them.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests pass | `node --test scripts/opencode-model.test.mjs` | `# fail 0`, every test listed below passes |
| 2 | Old wording gone from the adapter | `grep -nE 'pass it explicitly\|rather than inheriting\|Never pin a model' .opencode/agents/controller.md` | no output (exit 1) |
| 3 | Every adapter pinned, exactly once | `for a in controller implementer verifier; do printf '%s ' $a; grep -c '^model: lmstudio/qwen3.8-27b-splash$' .opencode/agents/$a.md; done; ls opencode.json opencode.jsonc 2>/dev/null` | `controller 1`, `implementer 1`, `verifier 1`; no file listed |
| 4 | Only scoped files changed | `git diff --stat origin/main...HEAD` | exactly the five scoped files; the implementer/verifier adapter diffs are one added line each |
| 5 | Mutation | in a disposable copy: (a) restore the old Model choice paragraph in `.opencode/agents/controller.md`; (b) change the implementer adapter's pin to `model: openai/gpt-6.1-sol`; (c) delete the verifier adapter's `model:` line; (d) restore the old README OpenCode model paragraph. Run check 1 after each, reverting between | each mutation makes at least one named test fail (record output); unmutated copy passes |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0, `verify: all steps passed` |

## Unit tests to write (structural, in `scripts/opencode-model.test.mjs`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `every opencode adapter pins qwen3.8-27b-splash` | Each of the three adapter frontmatters (between the first two `---` lines) has exactly one `model:` key whose value is `lmstudio/qwen3.8-27b-splash` | pin missing, duplicated, wrong model, or placed in the body instead of the frontmatter |
| `opencode controller forbids model overrides` | The `## Model choice (OpenCode)` section names `lmstudio/qwen3.8-27b-splash`, forbids a `model` override on the subagent tool, and forbids switching model/provider (assert on stable key phrases the implementer chooses and documents in the test) | section deleted, or reverted to "choose the model per handoff" |
| `opencode controller does not invite model selection` | Section contains none of `pass it explicitly`, `rather than inheriting`, `Never pin a model`, `based on the task`, and names no other model (`gpt-`, `astra`, `sol`, `terra`, `gemma`, `claude`, `sonnet`, `opus`; word-boundary, case-insensitive) | old text restored, or another model named |
| `opencode controller forbids borrowed guidance and metadata guessing` | Section tells the controller not to apply other harnesses' model guidance, not to infer capability from name/release metadata, and to report BLOCKED instead of switching | any of those instructions missing |
| `readme opencode model section matches the pin` | `### Model choice (OpenCode)` in `docs/agents/README.md` (bounded by the next heading) names `lmstudio/qwen3.8-27b-splash`, forbids overrides, and contains neither `rather than silently inheriting` nor `explicit per-invocation override` nor `No model is pinned` | README left with the old guidance |
| `readme repo-wide model sentence names the opencode exception` | The paragraph containing `Model settings remain unset in committed adapters` also names OpenCode and `lmstudio/qwen3.8-27b-splash` | the README still claims no adapter pins a model |
| `other harness model sections are untouched` | The README's `### Model choice (Codex)` still contains `gpt-6.1-sol`; `### Model choice (Google Antigravity)` still exists; no `.claude/agents/*.md`, `.grok/agents/*.md` frontmatter or `.codex/agents/*.toml` gains a `model` key | the change leaks into other harnesses |

## Edge cases (each needs a check)
- Section and frontmatter extractors are bounded (next heading of same or higher level; the closing `---`), so text elsewhere can't satisfy or fail a check.
- Tests fail with a clear message if a section or frontmatter block is missing (no crash, no vacuous pass).

## Human checks
- In OpenCode, select the controller and run it on a small task. Confirm the controller, implementer and verifier all report `lmstudio/qwen3.8-27b-splash`, and that no `model` override is passed on the subagent tool.

## Out of scope
- Changing model guidance for Claude Code, Codex, Grok or Antigravity.
- OpenCode provider configuration, `opencode.json`, or the backlog item B-005.
