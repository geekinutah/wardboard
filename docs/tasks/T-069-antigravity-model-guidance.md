# T-069: Antigravity model guidance names Gemini 4 Argon, not "pro"

**Milestone:** — (agent infra, off-roadmap)
**Depends on:** none
**Spec refs:** none (agent workflow). AGENTS.md § Roles, handoffs, and reporting; `docs/agents/protocol.md` (model choice belongs to the harness/user).

## Goal
The Google Antigravity section of `docs/agents/README.md` names the two subagent models by their real names: **Gemini Flash** (`gemini-3.8-flash`) for routine work and **Gemini 4 Argon** (`gemini-4-argon`) for escalation. It explains that the `invoke_subagent` `Model` values (`'flash'`, `'pro'`) are only the harness's tier aliases, not model names. Google no longer offers a "Pro" model, so the docs must never present `'pro'` as one. A structural test in the quality gate keeps it that way.

Background: Mike noticed that Google no longer offers a Pro model and that Gemini 4 Argon replaces it. The current text reads "pass `Model` explicitly (`'flash'` or `'pro'`)", "Escalate to `'pro'` (Gemini 4 Argon …)" and "escalate the verifier to `'pro'`". Those lines treat the alias as the model, and a controller (this one, in its previous report) then refers to "pro" models. On 2026-10-27 the installed `invoke_subagent` tool still accepts only `inherit | flash_lite | flash | pro`, so `'pro'` is still the value that selects the larger tier.

Model names re-checked on 2026-10-27, per Mike's request: `gemini-4-argon` and `gemini-3.8-flash` are current model IDs. `gemini-4-argon-high` (Argon at high thinking level) remains the controller recommendation. No name changes beyond the Argon wording below.

## Design decisions (binding)
- Rewrite `### Model choice (Google Antigravity)` in `docs/agents/README.md`. In substance, the new text must say:
  1. For every implementer and verifier handoff, choose the **model** from task complexity and verification risk. There are two tiers: **Gemini Flash (`gemini-3.8-flash`)** and **Gemini 4 Argon (`gemini-4-argon`)**.
  2. Default to Gemini Flash for well-specified, routine, bounded tasks.
  3. Escalate to Gemini 4 Argon for multi-step code reasoning, security-sensitive work, concurrency/race-condition logic, cross-cutting architectural changes, and correction rounds. Escalate the verifier to Gemini 4 Argon on its own risk assessment (complex verification logic, security invariants, subtle races).
  4. `invoke_subagent`'s `Model` values are harness **tier aliases, not model names**. Currently `'flash'` selects Gemini Flash and `'pro'` selects Gemini 4 Argon. There is no Gemini Pro model. If the installed tool exposes a different value for Argon, use that value.
  5. Always pass `Model` explicitly. Never `'inherit'`.
  6. In the handoff packet and controller report, name the model (e.g. "Gemini 4 Argon (`Model: 'pro'`)"), not just the alias.
  7. If no exposed value maps to the intended model, use a supported one, report the actual model and the limitation, and do not claim the escalation happened.
  8. Gemini 4 Argon (`gemini-4-argon-high`) is recommended for the controller.

  Keep the existing final paragraph about source read-only discipline unchanged.
- In the same `## Google Antigravity` section, change the controller-recommendation sentence near the top from "Gemini 4 (`gemini-4-argon-high`) is recommended…" to "Gemini 4 Argon (`gemini-4-argon-high`) is recommended…". Nothing else in that sentence changes.
- Every line in the Antigravity section that contains `'pro'` must also contain `Gemini 4 Argon` or the word `alias`.
- New structural test `scripts/antigravity-model.test.mjs` (`node:test`, `node:assert/strict`, no dependencies). It runs in the existing `node --test scripts/` gate step. It defines its own bounded section extractor. Do not import `opencode-model.test.mjs`, because importing a test file re-registers its tests.

## Scope
May change:
- `docs/agents/README.md` (the `## Google Antigravity` section only: the controller-recommendation sentence and the `### Model choice (Google Antigravity)` subsection)
- `scripts/antigravity-model.test.mjs` (new)

Must not change:
- other README sections (including Codex, OpenCode and the repo-wide line-5 sentence), `AGENTS.md`, `docs/agents/{controller,implementer,verifier,protocol}.md`, `.claude/**`, `.codex/**`, `.grok/**`, `.opencode/**`, `scripts/verify.sh`, other `scripts/*.test.mjs`, anything else

New dependencies allowed: none.

## Acceptance criteria

Application unit tests do not apply, because this is a documentation-only change with no application behavior. Executable structural tests in the gate, plus mutations, replace them.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests pass | `node --test scripts/antigravity-model.test.mjs` | `# fail 0`; every test listed below passes |
| 2 | Alias-as-model wording gone | `awk '/^## Google Antigravity$/{f=1;next} /^## /{f=0} f' docs/agents/README.md \| grep -v "no Gemini Pro model" \| grep -nE "Escalate to \`'pro'\`\|verifier to \`'pro'\`\|\`'flash'\` or \`'pro'\`\|Gemini 4 \(\|Gemini[ -]?[0-9.]* ?Pro\b"` | no output (exit 1) |
| 3 | Every `'pro'` line explains itself | `awk '/^## Google Antigravity$/{f=1;next} /^## /{f=0} f' docs/agents/README.md \| grep "'pro'" \| grep -vE "Gemini 4 Argon\|alias"` | no output (exit 1); and `… \| grep -c "'pro'"` is ≥ 1 |
| 4 | Existing OpenCode guard still passes | `node --test scripts/opencode-model.test.mjs` | `# fail 0` |
| 5 | Only scoped files changed | `git diff --stat origin/main...HEAD` | exactly `docs/agents/README.md` and `scripts/antigravity-model.test.mjs`; `git diff origin/main...HEAD -- docs/agents/README.md` shows hunks only inside `## Google Antigravity` |
| 6 | Mutation | In a disposable copy, apply each mutation, run check 1, and revert before the next: (a) restore the old `### Model choice (Google Antigravity)` subsection from `origin/main`; (b) replace `Gemini 4 Argon` with `Gemini Pro` in the escalation bullet; (c) delete the tier-alias sentence (point 4); (d) change the controller sentence back to `Gemini 4 (`; (e) replace `Never` with `You may use` in the `'inherit'` instruction; (f) add `Escalate to Claude Opus` to the subsection | each mutation makes at least one named test fail (record the output); the unmutated copy passes |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0, `verify: all steps passed` |

## Unit tests to write (structural, in `scripts/antigravity-model.test.mjs`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `antigravity model section names both models by id` | `### Model choice (Google Antigravity)` contains `Gemini Flash`, `gemini-3.8-flash`, `Gemini 4 Argon` and `gemini-4-argon` | a model or its ID is dropped or misspelled |
| `escalation targets Gemini 4 Argon, not an alias` | The subsection contains an escalation instruction whose target is `Gemini 4 Argon` (e.g. regex `/[Ee]scalate[^.\n]*Gemini 4 Argon/`), and has no `/[Ee]scalate[^.\n]*\`'pro'\`/` | old "Escalate to `'pro'`" text restored |
| `model values are documented as tier aliases` | The subsection says the `Model` values are aliases (contains `alias`), maps `'pro'` to `Gemini 4 Argon` on one line, and says there is no Gemini Pro model | alias explanation deleted, or `'pro'` mapped to something else |
| `no Gemini Pro model is presented` | Apart from the single "no Gemini Pro model" disclaimer line, the whole `## Google Antigravity` section has no match for `/Gemini[ -]?[\d.]*\s?Pro\b/i` or `/\bpro model\b/i` | docs reintroduce a Pro model name |
| `every 'pro' mention is explained` | Every line in `## Google Antigravity` containing `'pro'` also contains `Gemini 4 Argon` or `alias`, and at least one such line exists | a bare `'pro'` reappears, or every mention is removed |
| `explicit Model, never inherit` | The subsection requires an explicit `Model` and contains a prohibition on `'inherit'` (e.g. `/[Nn]ever[^.\n]*'inherit'/`) | the inherit prohibition is weakened or deleted |
| `handoff names the model, not just the alias` | The subsection tells the controller to name the model in both the handoff packet and the controller report | instruction dropped |
| `controller recommendation names Gemini 4 Argon` | The `## Google Antigravity` section contains `Gemini 4 Argon (\`gemini-4-argon-high\`)` and no `Gemini 4 (` | old "Gemini 4 (" wording left |
| `antigravity section names no other vendor's model` | The `## Google Antigravity` section has no word-boundary, case-insensitive match for `gpt-`, `astra`, `\bsol\b`, `terra`, `qwen`, `claude`, `sonnet`, `opus` | borrowed guidance from another harness |
| `read-only discipline paragraph preserved` | The subsection still contains `Source read-only discipline during verification` | final paragraph lost in the rewrite |

## Edge cases (each needs a check)
- Section extractors are bounded by the next heading of the same or higher level, so text in other sections (e.g. Codex `gpt-6.1-sol`) can neither satisfy nor fail a check. Cover this with an assertion that the extracted Antigravity section does not contain `## Other harnesses`.
- A missing heading fails with a clear `section not found` message, not a crash or a vacuous pass.
- Tolerate CRLF line endings. The README is LF today, but a Windows checkout may use `\r\n`, so the extractor must not miss the exact heading match because of a trailing `\r`.

## Human checks
- Start an Antigravity controller session on a small task. Confirm that its handoff packets and report say "Gemini Flash" / "Gemini 4 Argon" (with the `Model` alias in parentheses), never a "Pro" model, and that every `invoke_subagent` call passes an explicit `Model`.

## Out of scope
- Model guidance for Claude Code, Codex, Grok or OpenCode.
- `docs/agents/controller.md`, `protocol.md` or other role docs.
- Any change to the harness's `invoke_subagent` enum (not in this repo).
