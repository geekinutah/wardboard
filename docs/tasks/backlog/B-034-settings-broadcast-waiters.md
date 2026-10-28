# B-034: Overlapping setShowNeedsApproval calls share one settings broadcast

**Priority:** P2
**Area:** web sync
**State:** candidate
**Found:** 2026-10-28, T-075 round-1 verifier
**Promoted to:** —

## Finding

`setShowNeedsApproval` is answered by a settings broadcast whose `requestId` is empty (`apps/server/src/ws/channel.ts` `broadcastSettings`). The client settles every in-flight settings waiter when that frame arrives (`apps/web/src/sync/client.ts` `settleReply` and `applySettings`). Two overlapping calls can both resolve `{ ok: true }` before the second request is accepted or rejected.

## Risk

A caller that fires two setting changes without waiting can treat a refused or not-yet-applied change as saved. The T-075 acceptance cases are single-request, and the shell does not send overlapping calls today.

## Direction

Settle only the oldest settings waiter for each empty-requestId broadcast. Leave the server broadcast shape unchanged.

## Evidence

- T-075 verifier note, candidate `b7c29fc`, integrated as `3bf043c`
- `apps/web/src/sync/client.ts` `settleReply` and the `requestId === ''` branch in `applySettings`
- `apps/server/src/ws/channel.ts` `broadcastSettings` sends `{ type: 'settings', requestId: '', showNeedsApproval }`
