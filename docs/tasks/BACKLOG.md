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
| B-010 | P1 | core model | resolved | Extra overseers of the priests quorum and duplicate oversight entries accepted |
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
| B-021 | P2 | core tests | candidate | Fixture proposals share every position/assignment id with their baseline, so id-vs-lineage bugs go undetected |
| B-022 | P2 | core diff | candidate | Diff list correspondence untested when a list's first position has a new lineage |
| B-023 | P2 | server schema | candidate | SQLite oversight rows are not unique per target |
| B-024 | P2 | web sync | candidate | `send` can hang if the subscription changes before its commit arrives |
| B-025 | P2 | server dev tooling | candidate | dev reset-guard test asserts on the checkout root, so it fails if the checkout lives inside the OS temp dir |
| B-026 | P2 | web e2e harness | candidate | Phone WebKit smoke can crash in browser teardown (`NSInternalInconsistencyException`); rerun passed |
| B-027 | P2 | web sync | accepted | `useBaseline` stays null after a dropped in-flight fetch until the baseline id changes |
| B-028 | P2 | design tokens | candidate | removed summary CSS uses raw artboard hex colors without tokens |
| B-029 | P2 | design tokens | candidate | artboard 9 removed-card date and hint line absent from shipped RemovedCard |
| B-030 | P1 | core rules / import / UI | accepted | Members with out-of-unit callings are unavailable for ward callings, but nothing shows or enforces it |
| B-031 | P1 | web dnd / integration | resolved | Needs-approval drop onto a full list sends approvePlacement with a client-invented position id |
| B-032 | P2 | web dnd | candidate | DnD polish: can't-drop hover state, touch-action on phones, null-label lockout, technical alert text |
| B-033 | P2 | design tokens | candidate | summary page copy grammar: singular forms for collapsed row and divergence heading |
| B-034 | P2 | web sync | candidate | overlapping setShowNeedsApproval calls can all resolve ok on one empty-requestId settings broadcast |
| B-035 | P2 | web shell | candidate | A collaborator's new proposal tab can wrap the header and shift the board mid-drag |
| B-036 | P2 | web canvas / phone layout | candidate | The canvas viewport blocks page scrolling on phones |
| B-037 | P3 | web shell / search | candidate | Desktop editing UX polish from T-077 |
| B-038 | P1 | web e2e | resolved | Concurrent e2e specs mutate the shared fixture proposal `Spring adjustments` |
| B-039 | P3 | web presentation / core model | candidate | Presentation footer lacks ward name and baseline date (Board model has no capture time) |
| B-040 | P2 | web settings / phone layout | candidate | Settings user-row actions overflow on phones with no scroll cue |
| B-041 | P3 | web shell | candidate | Returning from Settings resets board tab, zoom and camera |
| B-042 | P1 | server / web sync / shell | accepted | Tags editor and Accepted view have no server/sync path in the app (no `deleteTag` message, no client methods) |
| B-043 | P3 | server proposals | candidate | The server accepts two proposals with the same name |
| B-044 | P3 | web sync types | candidate | `RequestResult` success type rejects a plain `{ ok: true }`; callers cast |
| B-045 | P2 | web e2e / gate | candidate | e2e drag tests fail when two worktrees run Playwright at once |
