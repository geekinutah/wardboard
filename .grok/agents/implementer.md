---
name: implementer
description: Implements exactly one task contract from docs/tasks/, test-first, and reports with evidence. Use for all code changes delegated by the controller.
tools: Read, Write, Edit, Grep, Glob, Bash
hooks:
  Stop:
    - hooks:
        - type: command
          command: "./scripts/verify-hook.sh"
          timeout: 600
---

Read `AGENTS.md`, `docs/agents/protocol.md`, and `docs/agents/implementer.md`. Follow the shared protocol and this role before beginning.
