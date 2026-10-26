# T-064: OpenCode harness adapter and README section

**Milestone:** none — agent-workflow infrastructure documentation, outside the SPEC.md §16 roadmap. The repo is pre-T-001 (no application code, no quality gate yet).
**Depends on:** none. Touches no code and no `scripts/` (which T-001 owns).
**Spec refs:** none (agent-workflow documentation only; `SPEC.md` is not changed).

## Goal

Make OpenCode a first-class entry harness for the agent workflow, alongside Claude Code, Codex CLI, and Grok Build: a `## OpenCode` section in `docs/agents/README.md`, a `.opencode/agents/` adapter directory with the three roles, and `AGENTS.md` references — all pointing at the canonical role files, with no harness-specific behavior duplicated into the canonical docs.

## Scope

May change:
- `docs/agents/README.md`
- `AGENTS.md`
- `.opencode/agents/controller.md` (new file)
- `.opencode/agents/implementer.md` (new file)
- `.opencode/agents/verifier.md` (new file)

Must not change:
- anything else, in particular: the canonical role/protocol files (`docs/agents/protocol.md`, `controller.md`, `implementer.md`, `verifier.md`) — they are harness-agnostic by protocol; the `.claude/`, `.codex/`, `.grok/` adapters; `scripts/` (owned by T-001 and not yet present — do not create it); `SPEC.md`, `docs/tasks/PLAN.md`, `docs/tasks/STATUS.md` (the controller owns the ledger).

New dependencies allowed: none.

## Content requirements

Each item below is verified by the acceptance criteria.

1. `docs/agents/README.md` — a new `## OpenCode` section, placed **after `## Grok Build` and before `## Google Antigravity`**, containing:
   - How to start the main session from the repository root (`opencode`), a note that OpenCode ingests `AGENTS.md` natively at startup, and that `CLAUDE.md` is ignored when `AGENTS.md` exists (OpenCode does not expand `@` references in rule files; this repo's `AGENTS.md` contains none, so nothing is lost).
   - The standard main-session prompt acting as controller (the same packet text used in the Codex and Google Antigravity sections).
   - How to select the `controller` agent: Tab in the TUI (a `mode: primary` agent) or `opencode run --agent controller`; the controller must be the main session so coordination does not depend on nested delegation.
   - That the three adapters in `.opencode/agents/` point at the canonical files (same pointer convention as the Claude and Grok adapters; the file name is the agent name).
   - That the verifier adapter denies file mutation (`edit: deny`, which per the OpenCode docs gates `write`/`edit`/`apply_patch`) and further delegation, with the standing caveat that a verifier with shell access is not OS-enforced read-only — obey the shared candidate/mutation rules (same spirit as the Codex and Antigravity sections).
   - Model choice: no model pinned in the committed adapters; subagents inherit the invoking session's model unless the controller passes an explicit per-invocation override; name the actual model in the handoff packet and controller report; model choice must not weaken any gate.
   - A note that OpenCode has no per-agent `Stop` hook, so the `./scripts/verify-hook.sh` backstop has no committed equivalent (optionally mention a `.opencode/plugins/` plugin on `session.idle` as the closest mechanism); enforcement remains the implementer's own instructions (run the gate before reporting PASS) and the fresh verifier — the same treatment as the Antigravity section.
   - The standard evidence-record line ("Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.") and a link to the official OpenCode agents documentation.
   - One phrase added to the "Sandboxes that block the Playwright browser download" section noting that a sandboxed OpenCode session can hit the same block (same symptom, same preferred fix, same WebKit caveat).
2. `AGENTS.md`:
   - Repo layout code block: a `.opencode/agents/` line, aligned with the existing adapter lines, description "OpenCode adapters (configuration and shared-role pointers)".
   - "Roles, handoffs, and reporting" section: the harness entry points list reads `(Claude Code, Codex, Grok Build, OpenCode, Google Antigravity)`.
3. `.opencode/agents/controller.md` — frontmatter with `description` and `mode: primary`; body is the three standard pointer lines (read `AGENTS.md`, `docs/agents/protocol.md`, and `docs/agents/controller.md`; follow the shared protocol and this role before beginning); plus a "Model choice (OpenCode)" paragraph (choose per handoff via the subagent tool's `model` parameter; never pin a model in the adapter; do not silently inherit when an override is available).
4. `.opencode/agents/implementer.md` — frontmatter with `description` and `mode: subagent`; body is the three standard pointer lines.
5. `.opencode/agents/verifier.md` — frontmatter with `description`, `mode: subagent`, and a `permission:` block containing `edit: deny` and `task: deny` (the current OpenCode docs key for the delegation tool). The implementer must confirm the installed CLI version actually applies these (acceptance check 6); if the installed version uses a different key name for the delegation tool, use that key and record the version in the report. Body is the three standard pointer lines.

## Acceptance criteria

Application unit tests do not apply: this is documentation/configuration-only work with no application behavior change (the repo has no code yet — T-001 is not started, so `./scripts/verify.sh` does not exist and cannot run; recorded as the known pre-T-001 limitation, consistent with every prior commit in this repo, which is documentation-only. Once T-001 lands, these files are covered by the normal gate as part of the repo). Per AGENTS.md's documentation/configuration-only provision, executable structural checks plus a mutation replace unit tests.

| # | Check | Command (run from the candidate root) | Expected result |
|---|---|---|---|
| 1 | All five files exist | `for f in docs/agents/README.md AGENTS.md .opencode/agents/controller.md .opencode/agents/implementer.md .opencode/agents/verifier.md; do test -f "$f" \|\| echo "MISSING $f"; done` | no output |
| 2 | README OpenCode section exists at the required position with all required content | `awk '/^## OpenCode$/{f=1;next} /^## Google Antigravity$/{f=0} f' docs/agents/README.md > /tmp/t064-oc.md && for m in "docs/agents/controller.md" "docs/agents/implementer.md" "docs/agents/verifier.md" "opencode run --agent controller" "mode: primary" "mode: subagent" "edit: deny" "task: deny" "Stop" "evidence" "opencode.ai/docs/agents"; do grep -qF "$m" /tmp/t064-oc.md \|\| echo "MISSING: $m"; done` | no output (no MISSING lines); `/tmp/t064-oc.md` is non-empty |
| 3 | AGENTS.md references | `grep -n "\.opencode/agents/" AGENTS.md` and `grep -n "harness entry points" AGENTS.md` | the layout line is present (1 match); the entry-points list matches `Grok Build, OpenCode, Google Antigravity` |
| 4 | Adapter frontmatter and bodies | `for a in controller implementer verifier; do echo "== $a"; sed -n '1,/^---$/!b' .opencode/agents/$a.md >/dev/null 2>&1; awk 'NR>1 && /^---$/{exit} NR>1' .opencode/agents/$a.md; done` plus `grep -c "docs/agents/" .opencode/agents/$a.md` for each | controller: `description:` + `mode: primary`; implementer: `description:` + `mode: subagent`; verifier: `description:` + `mode: subagent` + `edit: deny` + `task: deny` (or the installed version's actual delegation key, with the version noted); every file body contains all three canonical pointer paths |
| 5 | Mutation (structural checks detect a realistic defect) | in a disposable copy of the exact candidate: (a) delete the verifier adapter's `permission:` block, re-run check 4 — must fail; (b) delete the `## OpenCode` section from the README copy, re-run check 2 — must fail; (c) remove the `.opencode/agents/` layout line from the AGENTS.md copy, re-run check 3 — must fail. Remove the disposable copy afterward. | each mutation makes its corresponding check print at least one failure line (record the actual output); the un-mutated candidate passes all of 1–4 |
| 6 | Live smoke against the installed OpenCode (validate an installation) | in the candidate checkout: `opencode --version`; then `opencode run --agent controller --prompt "<smoke prompt>"` and `opencode run --agent verifier --prompt "<smoke prompt>"`, where the smoke prompt asks the agent to (i) state its agent name, (ii) confirm whether AGENTS.md project rules are in its context, (iii) list the tools available to it. If the installed CLI rejects `--agent <custom>` or cannot be driven non-interactively for one of these, use the closest available path and record that verbatim. Add `--auto` only if a permission prompt would otherwise stall; record any flags used. | recorded real output shows: all three custom agents load; AGENTS.md is ingested; the controller has the delegation tool; the verifier has no file-mutation tools (write/edit/apply_patch) and no delegation tool (or the recorded actual key/tool name if the installed version differs from the docs); `opencode --version` recorded in the report |

## Unit tests to write

Not applicable — documentation/configuration-only work; the executable structural checks and mutation in the acceptance criteria apply instead (see note above; there is no application code to unit test in this pre-T-001 repo).

## Edge cases (each needs a check)

- A fresh reader starting in a clean clone sees OpenCode as a first-class option in both `AGENTS.md` and the README (checks 1–3).
- The harness list in `AGENTS.md` and the section order in the README stay consistent (check 3).
- The Playwright sandbox guidance still reaches OpenCode users (covered by content requirement 1's added phrase; verified by check 2's section extraction including it).

## Human checks

- Mike: start `opencode` in the repository root; confirm Tab cycles to the `controller` primary agent and the `@` autocomplete lists `implementer`/`verifier`; give the controller one small real task and confirm it delegates to a fresh verifier child session (navigate with `<Leader>+Down`, return with `<Up>`).
- If Mike uses a sandboxed/cloud OpenCode session: confirm the Playwright-download block section's symptom and fix apply there.

## Out of scope

- Canonical role/protocol files; other harness adapters (`.claude/`, `.codex/`, `.grok/`); `scripts/` (T-001); a committed `.opencode/plugins/` plugin (documented as an option only); a project `opencode.json` (markdown discovery is the convention); `SPEC.md`, `PLAN.md`, `STATUS.md`; any application code.
