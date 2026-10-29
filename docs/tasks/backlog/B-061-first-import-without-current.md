# B-061: The first import can't run when there is no Current board

**Priority:** P2  
**Area:** import / server  
**State:** accepted  
**Found:** 2026-10-29, controller while writing T-097  
**Promoted to:** T-102, T-103 (Mike, 2026-10-29: "if there is no current, we should default to an import workflow")

## Finding

`POST /api/import/preview` and `/replace` return 400 `bad_request` when the store has no Current board (`planCurrent` returns null). A fresh install that has never imported can therefore not do its first import from the app. T-097 shows "Import needs an existing Current board." in that case.

## Risk

The deployment milestone needs a fresh install to load its ward. Today that only works if Current is seeded some other way.

## Direction

Decide (Mike) how a fresh install gets its first Current: allow the import routes to plan against an empty Current with version 0, or seed an empty Current at first start. Then remove T-097's no-Current message.

## Evidence

- `apps/server/src/import/http.ts` `planCurrent` (`if (current === null) return null;`) and the 400 at the preview/replace handlers
- `docs/tasks/T-097-import-in-settings.md` Out of scope and Notes
