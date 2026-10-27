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
| B-006 | P2 | web e2e harness | candidate | e2e server teardown (data dir removal, port close) is not tested |
| B-007 | P2 | server | candidate | `removed_date` accepts impossible `YYYY-MM-DD` dates |
| B-008 | P2 | server | candidate | `baseline_board_id` does not require the target board's kind to be `baseline` |
| B-009 | P2 | task contracts | candidate | `test -- <name>` acceptance commands don't filter in Vitest |
| B-010 | P1 | core model | candidate | Extra overseers of the priests quorum and duplicate oversight entries accepted |
| B-011 | P2 | core model | candidate | `createProposal` keeps unknown `accepted` keys; baseline/board may share an id |
| B-012 | P1 | core model | candidate | No place for Current's import date or proposal reopen audit |
| B-013 | P2 | docker | candidate | Docker Engine 29 no longer deletes anonymous volumes on a plain `docker rm` |
| B-014 | P2 | core ordering | candidate | Structural calling order tie-break differs between derive and second-calling |
| B-015 | P1 | docker | resolved | Docker image ships `packages/core/src/fixtures/`; docker smoke fails on main |
| B-016 | P2 | server security | candidate | `authenticatedIdentities` WeakMap is exported mutable |
| B-017 | P2 | agent docs (OpenCode) | candidate | OpenCode model test doesn't pin the "fresh session, not a different model" wording |
| B-018 | P1 | agent process / CI | resolved | No controller watches CI; integrated gate skips the Docker smoke (CI red on main since T-006) |
| B-019 | P2 | core fixtures | candidate | Sunday School secretary has no leadership role, so a filled seat would not cascade |
| B-020 | P2 | tooling / quality gate | candidate | Gate structural tests miss an early `exit 0` and `set +e` in the smoke |
