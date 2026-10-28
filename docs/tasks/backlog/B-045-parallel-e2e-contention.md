# B-045: e2e drag tests fail when two worktrees run Playwright at once

**Priority:** P2  
**Area:** web e2e / quality gate  
**State:** candidate  
**Found:** 2026-10-28, T-086 implementer round 1  
**Promoted to:** —

## Finding

`apps/web/e2e/editing.spec.ts:107` and `:134` (desktop-chromium drag tests) failed during a full `./scripts/verify.sh` while another worktree's Playwright run was active. Run alone, `playwright test e2e/editing.spec.ts --project=desktop-chromium` passed 4/4.

## Risk

AGENTS.md says parallel worktree gates must be concurrency-safe. Load-sensitive drag tests make integrated gates fail at random when controllers run in parallel.

## Direction

Reproduce with two concurrent gates. Check whether the drag tests depend on timing (fixed-step mouse moves, animation frames), and make them wait on observable state instead. Do not raise timeouts.

## Evidence

- /private/tmp/claude-501/-Users-mwilson-git-wardboard/468ef6b0-a490-44b3-b076-a31bc1c8024a/scratchpad/verify-experiment.txt (T-086 diagnostic run; local, not durable)
- docs/tasks/evidence/T-086.md, round 1, note 3
