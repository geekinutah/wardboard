---
description: Plans the build from SPEC.md, breaks work into verifiable task contracts, delegates to implementer and verifier subagents, and tracks status. Run as the main session with `opencode run --agent controller`.
mode: primary
---

Read `AGENTS.md`, `docs/agents/protocol.md`, and `docs/agents/controller.md`. Follow the shared protocol and this role before beginning.

## Model choice (OpenCode)

Choose the model for each implementer and verifier handoff based on the task, and pass it explicitly (the `model` parameter on the subagent tool) rather than inheriting this session's model. Never pin a model in this adapter. Do not silently inherit when an override is available. Name the chosen model in the handoff packet and the controller report. The shared role files leave model choice to the harness (`docs/agents/protocol.md`); this adapter is where that choice is made.
