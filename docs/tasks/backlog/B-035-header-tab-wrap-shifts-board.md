# B-035: A collaborator's new proposal tab can wrap the header and shift the board mid-drag

**Priority:** P2  
**Area:** web shell  
**State:** candidate  
**Found:** 2026-10-28, T-077 implementer and verifier  
**Promoted to:** —

## Finding

The desktop header's tab strip wraps (`apps/web/src/app.css` `.shell-header`/`.shell-tabs` use `flex-wrap: wrap`). When another user creates a proposal, the new tab can push the header to a second line (157 vs 205 px at TV), moving the board under a drag in progress. T-077's e2e tests hit this when run in parallel and use `followTarget()` to re-aim at the target.

## Risk

A drop can land on the wrong card, and every viewer sees the layout jump whenever a tab is added.

## Direction

Keep the header height fixed, e.g. tabs on one line that scroll sideways or collapse into a menu.

## Evidence

- `docs/tasks/evidence/T-077.md` (round 2 implementer and verifier notes); `apps/web/e2e/editing.spec.ts` `followTarget()`
