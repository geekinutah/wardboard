# B-038: Concurrent e2e specs mutate the shared fixture proposal `Spring adjustments`

**Priority:** P2  
**Area:** web e2e  
**State:** candidate  
**Found:** 2026-10-28 (T-079 implementer)  
**Promoted to:** —

## Finding

`apps/web/e2e/board-shell.spec.ts` and `apps/web/e2e/board-views.spec.ts` both mutate the shared fixture proposal `Spring adjustments` against the single checkout server while Playwright runs the 4 viewport projects in parallel.

## Risk

When two Playwright workers send operations to `Spring adjustments` at the same instant, one worker can receive a stale-version rejection (`board-shell.spec.ts:65`'s `addPositionUntilCommitted` retry then polls for `vacancyLabel` to change, which times out if the colliding operation was `board-views.spec.ts`'s `setOversight` that does not change vacancy counts) or observe intermediate board state from the other worker, causing intermittent e2e flakiness.

## Direction

Follow the pattern in `apps/web/e2e/editing.spec.ts`: have each mutating test create its own isolated proposal tab (e.g., via `createProposal` or the Start proposal UI) instead of mutating the shared `Spring adjustments` fixture tab.

## Evidence

- `apps/web/e2e/board-shell.spec.ts` (adds a position on `Spring adjustments`)
- `apps/web/e2e/board-views.spec.ts` (changes oversight on `Spring adjustments`)
- `apps/web/e2e/editing.spec.ts` (creates a fresh proposal per test to avoid cross-worker collisions)
