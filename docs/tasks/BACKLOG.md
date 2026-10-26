# Engineering backlog

Durable intake for bugs, architecture findings, review observations, and improvement ideas that are worth preserving but are **not yet executable task contracts**.

`STATUS.md` remains the execution ledger for work that has been promoted into a `T-###` contract. Detailed backlog items live in `docs/tasks/backlog/`; this index is intentionally compact so agents can discover candidate work without loading every finding into context.

```
observation / review finding
        ↓
      B-###        ← BACKLOG.md + backlog/B-###-*.md
        ↓ triage / design / acceptance
      T-###        ← docs/tasks/T-###-*.md
        ↓
    STATUS.md
        ↓
       done
```

## Rules

- A backlog item means **"preserve and consider this"**, not **"implement this exact solution."**
- Keep the finding and risk durable; keep the proposed direction lightweight.
- Do not duplicate normal roadmap work already represented clearly in `SPEC.md`.
- When an item is accepted for implementation, create one or more normal `T-###` task contracts and record them in the item's **Promoted to** field.
- Once every resulting task is complete, change the backlog item and index state to `resolved`. Use `declined` if the team intentionally decides not to pursue it.
- Valid states: `candidate`, `accepted`, `resolved`, `declined`.
- Keep this index synchronized with the individual backlog-item files.

## Index

| ID | Priority | Area | State | Finding |
|---|---|---|---|---|
| B-001 | P2 | tooling | candidate | TypeScript pinned to 6.0.3 until typescript-eslint supports TS 7 |
| B-002 | P2 | core tests | candidate | assertNever fallback test survives removal of the fallback |
| B-003 | P2 | tooling | candidate | env-check Node hint can contradict `engines.node` |
| B-004 | P2 | server | candidate | `parseConfig` strips only one trailing slash from the base URL |
| B-005 | P2 | agent docs (OpenCode) | candidate | OpenCode v2.1.4: no `agent` subcommand (docs say yes); `debug agents` returns `[]` in a temp-area worktree |
