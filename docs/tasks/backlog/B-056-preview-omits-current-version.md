# B-056: Import preview JSON omits the current board version

**Priority:** P3
**Area:** import
**State:** candidate
**Found:** 2026-10-28, T-062 implementer
**Promoted to:** —

## Finding

`POST /api/import/preview` returns decisions, counts, and fingerprints, and does not return the current board version. `POST /api/import/replace` requires `expectedVersion`. A stale version is refused with `409` `{"error":"stale","currentVersion":N}` and writes nothing. The import guide tells a local operator to start from version `1` on a freshly seeded dev board, or to reuse `N` from that refusal.

## Risk

An operator with a board that is no longer version 1 learns the version only by a refused replace. The refusal writes nothing, so the data is safe, but the first attempt is a wasted round trip.

## Direction

A later contract can add `currentVersion` to the preview JSON. Do not change the T-058 response inside T-062 or T-059.

## Evidence

- `apps/server/src/import/http.ts` `previewJson`
- `docs/import/guide.md` on `t-062-import-guide` (the version paragraph)
- T-058 contract preview response, which lists the public fields and does not include `currentVersion`
