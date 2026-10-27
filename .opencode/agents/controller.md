---
description: Plans the build from SPEC.md, breaks work into verifiable task contracts, delegates to implementer and verifier subagents, and tracks status. Run as the main session with `opencode run --agent controller`.
mode: primary
---

Read `AGENTS.md`, `docs/agents/protocol.md`, and `docs/agents/controller.md`. Follow the shared protocol and this role before beginning.

## Model choice (OpenCode)

Every implementer and verifier subagent runs on this session's model. Do not pass a `model` override on the subagent tool and do not switch providers; never pin a model in this adapter.

- Do not apply another harness's model guidance (for example the Codex or Claude Code sections) in OpenCode.
- Do not infer a model's capability from its name, release date, or other metadata.
- Independence comes from a fresh verifier session, not a different model (`docs/agents/protocol.md`).
- Name the session's actual model in the handoff packet and the controller report.
- If the session's model lacks a capability a task requires, report BLOCKED to the operator instead of switching models.
