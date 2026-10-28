# B-031: Needs-approval drop onto a full list sends an approval for a client-invented position id

**Priority:** P1  
**Area:** web dnd / integration  
**State:** accepted  
**Found:** 2026-10-28, T-035 implementer and verifier (round 1)  
**Promoted to:** T-077

## Finding

`preflight` in `apps/web/src/features/dnd/resolve.ts` computes the `approvePlacement` position ids from a client-side trial run of the operation. When `addToList` targets a list with no vacancy, core creates a new position. The id the client invents won't match the id the server assigns, so once the board is wired to the server, the follow-up `approvePlacement` would fail or approve the wrong position.

## Risk

After integration, approving a needs-approval member dropped onto a full list silently fails. The proposal then can't be accepted, and the UI gives no clear reason. In the standalone preview it works, because the preview applies ops with the same context.

## Direction

Handle this in the integration task that mounts `DndSurface` with the sync client. Options: send `approvePlacement` after the server's `addToList` result and re-resolve the member's new position there; or add a server-side combined place-and-approve operation.

## Evidence

- `apps/web/src/features/dnd/resolve.ts` (`dropIds` / `dropContext`, `preflight`)
- `docs/tasks/evidence/T-035.md` (implementer and verifier notes)
