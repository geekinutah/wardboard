---
description: Plans the build from SPEC.md, breaks work into verifiable task contracts, delegates to implementer and verifier subagents, and tracks status. Run as the main session with `opencode run --agent controller`.
mode: primary
model: arch-llama/qwen3.8-27b
---

Read `AGENTS.md`, `docs/agents/protocol.md`, and `docs/agents/controller.md`. Follow the shared protocol and this role before beginning.

## Model choice (OpenCode)

Every OpenCode role (controller, implementer, verifier) runs on `arch-llama/qwen3.8-27b` (Arch Qwen3.8-27B, llama.cpp — faster decode and token generation than the LM Studio instance), pinned in the frontmatter of the adapters in `.opencode/agents/`. This is Mike's standing decision; only Mike changes it, by editing these docs.

- Do not pass a `model` override on the subagent tool, and do not switch model or provider for any handoff, including correction rounds and security-sensitive tasks.
- Do not apply another harness's model guidance in OpenCode.
- Do not infer a model's capability from its name, release date, or other metadata.
- Independence comes from a fresh verifier session, not a different model (`docs/agents/protocol.md`).
- Name the model in the handoff packet and the controller report.
- If the pinned model cannot do a task, or the pin fails to load, report BLOCKED to Mike rather than switching models.
