# B-027: `useBaseline` stays null after a dropped in-flight fetch

**Priority:** P2  
**Area:** web sync  
**State:** resolved  
**Found:** 2026-10-27, T-071 verifier  
**Promoted to:** T-030

## Finding

`useBaseline` (`apps/web/src/sync/react.tsx`, effect around lines 210–219) records a `null` fetch result as loaded. If the connection drops while `fetchBoard` is in flight (`client.ts` `rejectPending` settles it as `null`), the hook stays `null` after reconnect until `baselineBoardId` changes — even when the same proposal snapshot returns.

## Risk

Level views would render with `baseline: null` (no `+ Proposed` markers, no diff counts) after a brief network drop, until the user switches boards.

## Direction

Retry when the connection becomes live again, or do not mark a null result as loaded. T-030 is the first consumer of the hook.

## Evidence

- `docs/tasks/evidence/T-071.md`, verifier Notes / blockers
