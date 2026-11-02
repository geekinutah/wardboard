# B-080: An unsupported directory layout is reported as one message

**Priority:** P2
**Area:** tools/collector
**State:** candidate
**Found:** 2026-11-01, Mike's first real collector run
**Promoted to:** —

## Finding

Every `LayoutMismatch` becomes the same line: `Unsupported directory layout (expected directory-v1). Nothing was imported.` The first check uses that line both when `householdList` does not appear within `elementMs` and when the list appears but `householdLink` matches nothing. Playwright's own error is deliberately not logged, so the terminal cannot say which of those happened, or whether the page was still a sign-in screen the `signedOut` selector does not recognize.

## Risk

The 2026-11-01 run is now known from the screen Mike was looking at: a visible household sidebar that the guessed selector did not match. The terminal line still could not say that. The next layout change would be just as opaque.

## Direction

Log one fixed phrase per cause, with no page text, URL, or selector match text. At least separate "household list did not appear in time" from "household list had no household links."

## Evidence

- `tools/collector/src/collect.ts`: `unsupportedLayout`, both `throw new LayoutMismatch()` sites before collection starts, and the catch that logs `Page did not load` only for other errors
- `docs/tasks/T-061-directory-photo-collector.md` progress rules: no URLs, selector match text, or error bodies
