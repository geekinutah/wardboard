# T-065: OpenCode uses the session's model only

**Milestone:** — (agent infra, off-roadmap)
**Depends on:** T-064 (done)
**Spec refs:** none (agent workflow). AGENTS.md § Roles, handoffs, and reporting; `docs/agents/protocol.md` (model choice belongs to the harness/user).

## Goal
In the OpenCode harness, the controller never selects or passes a model for implementer or verifier handoffs: every role runs on the OpenCode session's own model (Mike's decision, 2026-10-26: in OpenCode he runs local Qwen3.8-27b only and has no other providers configured). The adapter and README say so, and a structural test in the quality gate keeps it that way.

Background: an OpenCode controller running Qwen3.8-27b, told by its adapter to "choose the model for each handoff… rather than inheriting", borrowed the Codex section's guidance and tried to hand T-017 to `openai/gpt-6.1-sol` and `openai/gpt-6.1-terra`, guessing relative strength from release timestamps. Those providers aren't configured in Mike's OpenCode, so the handoff would fail.

## Design decisions (binding)
- `.opencode/agents/controller.md` § "Model choice (OpenCode)" is replaced. New text must state, in substance:
  1. Every implementer and verifier subagent runs on this session's model. Do not pass a `model` override on the subagent tool and do not switch providers.
  2. Do not apply another harness's model guidance (e.g. the Codex or Claude Code sections) in OpenCode.
  3. Do not infer a model's capability from its name, release date or other metadata.
  4. Independence comes from a fresh verifier session, not a different model (consistent with `docs/agents/protocol.md`).
  5. Name the session's actual model in the handoff packet and controller report.
  6. If the session's model lacks a capability a task requires, report BLOCKED to the operator rather than switching models.
  It must no longer contain the phrases `pass it explicitly` or `rather than inheriting`.
- `docs/agents/README.md` § "### Model choice (OpenCode)" is rewritten to match (same six points, concise). Other harness sections are unchanged.
- No model is pinned anywhere: no `model:` key in any `.opencode/agents/*.md` frontmatter, and no committed `opencode.json`. Inheriting the session model is the mechanism.
- New structural test `scripts/opencode-model.test.mjs` (`node:test`, `node:assert/strict`, no dependencies), run by the existing `node --test scripts/` gate step.

## Scope
May change:
- `.opencode/agents/controller.md` (Model choice section only)
- `docs/agents/README.md` (the `### Model choice (OpenCode)` subsection only)
- `scripts/opencode-model.test.mjs` (new)

Must not change:
- `.opencode/agents/implementer.md`, `.opencode/agents/verifier.md`, `.claude/**`, `.codex/**`, `.grok/**`, other README sections, `docs/agents/{controller,implementer,verifier,protocol}.md`, `AGENTS.md`, `scripts/verify.sh`, anything else

New dependencies allowed: none.

## Acceptance criteria

Application unit tests do not apply: documentation/configuration-only change with no application behavior. Executable structural tests run in the gate plus a mutation replace them.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests pass | `node --test scripts/opencode-model.test.mjs` | `# fail 0`, every test listed below passes |
| 2 | Old wording gone from the adapter | `grep -nE 'pass it explicitly\|rather than inheriting' .opencode/agents/controller.md` | no output (exit 1) |
| 3 | No model pinned | `grep -nE '^model:' .opencode/agents/*.md; test -e opencode.json && echo PRESENT` | no output |
| 4 | Only scoped files changed | `git diff --stat origin/main...HEAD` | exactly the three scoped files |
| 5 | Mutation | in a disposable copy: (a) restore the old Model choice paragraph in `.opencode/agents/controller.md`; (b) add `model: openai/gpt-6.1-sol` to `.opencode/agents/implementer.md` frontmatter; (c) restore the old README OpenCode model paragraph. Run check 1 after each, reverting between | each mutation makes at least one named test fail (record output); unmutated copy passes |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0, `verify: all steps passed` |

## Unit tests to write (structural, in `scripts/opencode-model.test.mjs`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `opencode controller adapter uses the session model` | The `## Model choice (OpenCode)` section of `.opencode/agents/controller.md` exists, says subagents run on the session's model, forbids a `model` override, and forbids switching provider (assert on stable key phrases the implementer chooses and documents in the test) | section deleted, or reverted to "choose the model per handoff" |
| `opencode controller adapter does not invite model selection` | Section contains none of `pass it explicitly`, `rather than inheriting`, `based on the task`, `gpt-`, `astra`, `sol`, `terra` (word-boundary, case-insensitive for model names) | old text restored, or a specific foreign model named |
| `opencode controller adapter forbids borrowed guidance and metadata guessing` | Section tells the controller not to apply other harnesses' model guidance and not to infer capability from name/release metadata | either instruction missing |
| `opencode adapters pin no model` | No `.opencode/agents/*.md` frontmatter has a `model:` key; repo root has no `opencode.json` | a pinned model added |
| `readme opencode model section matches the adapter` | `### Model choice (OpenCode)` in `docs/agents/README.md` (bounded by the next heading) states session model only, no override, and contains neither `rather than silently inheriting` nor `explicit per-invocation override` | README left with the old guidance |
| `other harness model sections are untouched` | The README's `### Model choice (Codex)` still contains `gpt-6.1-sol`, and `### Model choice (Google Antigravity)` still exists | the rewrite clobbers neighboring sections |

## Edge cases (each needs a check)
- The section extractor is bounded by the next heading of the same or higher level, so text elsewhere in the file can't satisfy or fail a check (test fixtures or a helper test proving the boundary are welcome but not required).
- Tests fail with a clear message if a section is missing entirely (not a crash or vacuous pass).

## Human checks
- In OpenCode (Qwen3.8-27b session), run the controller on a small task and confirm the implementer and verifier subagents run on qwen3.8-27b and that no `model` override is passed.

## Out of scope
- Changing model guidance for Claude Code, Codex, Grok or Antigravity.
- OpenCode provider configuration, `opencode.json`, or the backlog item B-005.
