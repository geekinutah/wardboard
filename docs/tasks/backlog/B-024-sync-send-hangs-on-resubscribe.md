# B-024: Sync send can hang when the subscription changes

**Priority:** P2  
**Area:** web sync  
**State:** candidate  
**Found:** 2026-10-27, T-029 verifier  
**Promoted to:** —

## Finding

`SyncClient.send` stays pending if `open()` switches boards before that request's `committed` message arrives. `applyCommitted` returns immediately when `boardId` is not the current subscription, and it does not resolve the waiter.

## Risk

The shell does not call `open()` yet, and the server only broadcasts a commit to connections still subscribed to that board. The next board-switching UI can leave an operation promise unresolved after a fast tab change.

## Direction

When a task owns board switching, resolve or reject pending ops whose board is no longer the subscription. Do not weaken the T-029 rule that a commit for another board does not change the visible board.

## Evidence

- `apps/web/src/sync/client.ts` `applyCommitted` (early return when `boardId` differs)
- `docs/tasks/evidence/T-029.md`
