# B-052: Some e2e specs still fail intermittently under load

**Priority:** P2  
**Area:** web e2e  
**State:** candidate  
**Found:** 2026-10-28, T-091 implementer, verifiers and integrated gate  
**Promoted to:** —

## Finding

T-091 caps Playwright at 2 machine-wide slots of 6 workers, but runs from worktrees that didn't have the wrapper yet kept running unpooled while T-091 was verified. These single-test failures were seen. Each test passed in the other runs.

- `[phone-webkit] e2e/board-views.spec.ts:11`, twice:
  - Round-1 verifier AC6 round 3: 30 s test timeout at `secondCounselorRadio.click()`. An unpooled t-050 `verify.sh` and a t-051 e2e/build were running; 1-minute load 34.
  - Integrated gate run 1 on main + T-091: at :41 the overseer still read "Overseen by First Counselor" 5 s after Confirm. Outside load not monitored. The spec uses its own proposal (T-084), so this is not shared-state interference. The rerun passed.
- `[tv-chromium] e2e/canvas.spec.ts:88`: 30 s timeout waiting for the Canvas region (round-1 verifier AC6 round 2; load not monitored).
- `[desktop-chromium] e2e/gui/editing.capture.ts:52` (`dragOver`): `[data-dnd-ghost]` not visible 5 s after fixed-step mouse moves (implementer, 1 of 3 `gui:capture` runs).
- Before T-091: `editing.spec.ts:107`, `:134`, `out-of-unit.spec.ts:3`, `proposals.spec.ts:14` (see B-045).

## Risk

Intermittent gate failures cost rounds. board-views:11 on phone-webkit failing at the Confirm step, rather than only timing out, could be a WebKit-specific defect (lost click or rejected change) rather than load.

## Direction

Re-assess once every worktree runs e2e through `scripts/e2e-slot.pl`. If failures persist under the pool, investigate board-views:11 on phone-webkit first (repeat it with `--repeat-each` through the wrapper and look for a rejected operation or a missed tap). Replace fixed-step drags with waits on observable drag state. Don't raise timeouts or add retries.

## Evidence

- docs/tasks/evidence/T-091.md (round-1 implementer notes, round-1 verifier AC6, integration section)
- docs/tasks/backlog/B-045-parallel-e2e-contention.md
