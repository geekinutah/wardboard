# Agent protocol

`AGENTS.md` governs every role. Roles define behavior; harness adapters define discovery and tool configuration. Do not hard-code model names, providers, tool APIs, or permission bypasses in the canonical roles. The controller owns contracts, execution status, and backlog mutation; implementers own scoped changes; fresh verifiers independently assess the candidate.

## Handoff

For every implementation, verification, or correction round, supply this packet explicitly. Do not assume shared conversation or a shared filesystem:

- **Role and task:** role file, protocol path, task ID/path, and full contract text, plus access to AGENTS.md and SPEC.md.
- **Checkout:** repository identity, branch, absolute checkout path (or instructions to obtain it).
- **Revisions:** base commit and exact candidate commit. If work is uncommitted, supply a complete patch including added files with its hash, the base commit, and a changed-file manifest. The recipient must reconstruct/confirm the same candidate before running checks.
- **Round:** current implementer/verifier round (maximum three), dependencies and their verified status.
- **Evidence:** implementer report, prior verifier findings, actual command output and artifact paths, and any human checks. Transfer artifacts when they are not accessible in the recipient's environment.
- **Blockers and capabilities:** outstanding questions, scope limits, available delegation/command/image-viewing capabilities, platform tools and permissions, harness/version and model when available (otherwise say unknown).

The controller waits for implementation to finish before handing its frozen candidate to a fresh verifier. If the candidate changes, verification must cover the new revision. Never call a role switch or self-review in the implementer's existing session independent verification.

Native delegation is optional; independence is not. Without native delegation, prepare the packet and have the operator launch a separate fresh implementer/verifier session in their chosen harness. Keep the task awaiting that handoff rather than claiming completion. Cross-harness or cross-provider verification is this same explicit handoff; the repository does not automatically route requests between providers.

## Capabilities and evidence

Each recipient checks capabilities before promising results. Required command execution, dependencies, permissions, platform tools, or image viewing missing means BLOCKED with the specific unavailable check. Follow `docs/gui-verification.md` unchanged for UI scope; a text-only screenshot path or passing component tests does not satisfy visual inspection. Do not replace the iOS gate with a weaker check without an explicit contract/process change.

Keep candidate source and tests read-only during verification. Commands may create build artifacts and evidence; mutations need a disposable copy or temporary worktree, preserving uncommitted candidate content when applicable. Record status before/after and cleanup. Tool allowlists and omitted editor tools are not a security sandbox, especially when shell execution is available. Respect actual harness permissions; do not disable safeguards to meet a gate. Agents must run at most one `./scripts/verify.sh` or `pnpm --filter mobile run test:e2e` per worktree at a time to prevent port collisions and export races (and `apps/mobile/scripts/run-e2e.mjs` enforces a per-checkout `.e2e.lock` backstop to serialize or reject concurrent web e2e runs in the same worktree).

Every report includes real, trimmed output and links/paths to larger evidence. State not-run checks and their reasons; never invent output. PASS requires all mandatory checks. FAIL means an observed defect or failed check; BLOCKED means required work/checks cannot be completed. Human checks remain explicitly pending and must never be described as executed. Controller status follows these results, including the three-round limit, and never marks blocked verification done.

## Implementer report

Use exactly these sections (use “not applicable” with a reason where appropriate):

```text
## Result: PASS | FAIL | BLOCKED
## Task: <task id>
## Changes: <files changed, one line each>
## Tests added: <test names and behavior, or structural checks for docs/config>
## Red evidence: <actual failing output before the change, trimmed>
## Verification: <candidate identity; each acceptance command and actual output; GUI evidence when required>
## Human checks: <steps, or "none">
## Notes / blockers: <missing capabilities; out-of-scope findings with risk, evidence, suggested priority/direction>
```

## Verifier report

```text
## Result: PASS | FAIL | BLOCKED
## Task: <task id>
## Candidate: <checkout, base/candidate revision or patch hash, round>
## Commands run: <each acceptance command and full gate; trimmed actual output>
## Mutation check: <disposable location, realistic defect, check that failed, status/cleanup evidence>
## GUI verification: <screens/states, inspected screenshots, findings; or not applicable with reason>
## Findings: <problems with file:line and required correction, or "none">
## Human checks: <remaining steps, or "none">
## Notes / blockers: <missing capabilities; unrelated backlog candidates with risk, evidence, priority/direction>
```

## Controller report

```text
## Result: PASS | FAIL | BLOCKED
## Task: <task id(s) and execution states>
## Changes: <summary and candidate identity>
## Verification: <independent verifier result, evidence paths, integrated gate when required>
## Human checks: <remaining steps, or "none">
## Notes / blockers: <rounds, handoffs pending, backlog updates, unresolved questions>
```

## Evidence record

The controller owns the task's evidence file (`docs/tasks/evidence/T-###.md`). It contains every implementer report and every verifier report in round order. Output may be trimmed, with paths to larger artifacts.

Every round is recorded, including FAIL and BLOCKED verifier results. The controller appends each verifier report **before** acting on it.

Each verifier report starts with exactly one level-1 heading:
`# Independent verification, round <N> (<harness>, <model or "unknown">): <PASS|FAIL|BLOCKED>`

A task may be marked `done` only if the **last** verification heading in its evidence file is PASS, the round matches the ledger, and the task ID matches.

```evidence-example
# Independent verification, round 1 (Codex, gpt-6.1-sol): PASS
## Result: PASS
## Task: T-181
## Candidate: a1b2c3d
## Commands run:
none
## Mutation check:
I made a realistic bug and the test failed.
## GUI verification:
none
## Findings:
none
## Human checks:
none
## Notes / blockers:
none
```
