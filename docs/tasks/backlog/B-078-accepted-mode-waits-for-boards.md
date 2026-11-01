# B-078: The accepted-mode e2e waits for someone else to broadcast boards

**Priority:** P3
**Area:** web e2e
**State:** candidate
**Found:** 2026-11-01, T-118 verification
**Promoted to:** —

## Finding

`apps/web/e2e/accepted-mode.spec.ts` opens a socket in `addOneCalling` and waits for `{ type: 'boards' }` without sending `listBoards`. The server answers `listBoards` only to the sender. `broadcastBoards` reaches every open socket after another client publishes a proposal or import. On the shared e2e server the wait can succeed because some other client broadcasts `boards`. Run alone, the wait can sit until the test times out.

## Risk

Low while the suite runs in parallel on one server. The spec can fail when it is the only mutator, which is the same hang T-118 removed from `accepted-mode.capture.ts`.

## Direction

Send `listBoards` on open, as `apps/web/e2e/gui/accepted-mode.capture.ts` now does. Do not treat that capture change as unfinished T-118 work.

## Evidence

- `apps/web/e2e/accepted-mode.spec.ts` `addOneCalling`, the `type === 'boards'` branch.
- `apps/server/src/ws/channel.ts` answers `listBoards` to the sender and broadcasts `boards` after a publish.
- T-118 implementer and independent verifier, round 1. `gui:capture` passed `accepted-mode` on all four projects after the capture sent `listBoards`.
