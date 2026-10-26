# B-005: OpenCode v2.1.4 CLI quirks vs current docs

**Priority:** P2  
**Area:** agent docs (OpenCode)  
**State:** candidate  
**Found:** 2026-10-25, T-064 implementer and verifier (independently)  
**Promoted to:** —

## Finding

Two discrepancies between installed OpenCode v2.1.4 and the current OpenCode documentation (opencode.ai/docs, updated 2026-10-24):

1. The docs describe `opencode agent list` / `opencode agent create` commands, but v2.1.4 has no `agent` subcommand (invoking it falls back to the root CLI help). The available static-discovery command is `opencode debug agents`.
2. `opencode debug agents` returns `[]` for a git **worktree** located under the macOS temp area (including opencode's own tmp path), while the *same* worktree under `/Users/...` lists all agents, and a plain (non-worktree) git repo under the same temp area also lists them. `opencode run --agent <name>` is unaffected — agents load fine from the temp-area worktree.

Also for the record (not a defect): `opencode run` takes its message positionally in v2.1.4 (`--prompt` is a root-level flag), and the permission key `task` normalizes to the `subagent` tool/action in this build.

## Risk

Low: a future verifier or operator running only `opencode debug agents` from a temp-area worktree could misread `[]` as "adapters not loaded" and fail a correct task; the docs/CLI mismatch may also cause confusion after an OpenCode upgrade.

## Direction

When the OpenCode section of `docs/agents/README.md` is next revised (or an OpenCode version adds the `agent` subcommand), note: run `opencode debug agents` from the repository checkout (not a temp-area worktree) for discovery, and pass the `run` message positionally.

## Evidence

- `docs/tasks/evidence/T-064.md` — round 1 implementer Notes (`--prompt` rejection, `debug agents` output) and verifier Notes (temp-area `[]` quirk, `agent` subcommand absence), with real command output.
