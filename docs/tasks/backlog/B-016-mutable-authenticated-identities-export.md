# B-016: `authenticatedIdentities` WeakMap is exported mutable

**Priority:** P2  
**Area:** server security  
**State:** candidate  
**Found:** 2026-10-26, T-021 round 1 verifier  
**Promoted to:** —

## Finding

`apps/server/src/identity/index.ts` exports the `authenticatedIdentities` `WeakMap<IncomingMessage, Identity>`, re-exported from `src/index.ts`. Any server code can `set` an identity on a request, bypassing the provider. T-021's contract allowed this shape.

## Risk

A later route or handler could attach an identity without going through `authenticate`, weakening the "only src/identity decides identity" property. No current code does this.

## Direction

When T-022 or T-024 touches identity, export only `getAuthenticatedIdentity` and keep the map module-private; consider a structural test like T-021's isolation test.

## Evidence

- T-021 verifier note 4 (`docs/tasks/evidence/T-021.md`).
