# B-044: `RequestResult` success type rejects a plain `{ ok: true }`

**Priority:** P3  
**Area:** web sync types  
**State:** candidate  
**Found:** 2026-10-28, T-039 and T-043 implementer notes  
**Promoted to:** —

## Finding

`RequestResult<T = Record<string, never>>` in `apps/web/src/sync/protocol.ts` makes `{ ok: true } & Record<string, never>` the success type, and a literal `{ ok: true }` is not assignable to it. Both T-039 (`features/tags/preview.tsx`, `features/tags/fixtures.ts` `okResult()`) and T-043 (`features/accepted/preview.tsx` and tests) use `as RequestResult` casts.

## Risk

Low. The casts can hide real type mismatches as the B-042 integration wires real callbacks.

## Direction

Default `T` to `{}` (or `object`) so `{ ok: true }` type-checks. Then remove the casts in the B-042 integration task.

## Evidence

- `apps/web/src/sync/protocol.ts` (`RequestResult`)
- docs/tasks/evidence/T-039.md, T-043.md (implementer notes)
