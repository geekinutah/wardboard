# B-079: The live directory does not match the directory-v1 selectors

**Priority:** P1
**Area:** tools/collector
**State:** candidate
**Found:** 2026-11-01, Mike's first real collector run
**Promoted to:** —

## Finding

`pnpm --filter @wardboard/collector run collect -- --staging ~/wardboard-staging` opened the directory, Mike signed in and pressed Enter, and the run stopped with `Unsupported directory layout (expected directory-v1). Nothing was imported.` and exit 1.

The browser was already signed in. The page on screen was Ward Directory and Map: a household sidebar (search, an "All Households" filter, and an alphabetical list) beside a map, with Directory, Organizations, and Missionary along the bottom. The address was the directory host plus a ward path, not the site root the collector opens. It was not a sign-in screen.

`config/directory.json` says its selectors are an unverified guess. After Enter, the collector does not read the visible list. It waits up to 10 seconds for `[data-testid='household-list']`, then for links under that list whose href contains `/household/`. This screen does not use that structure, so the wait failed. A recognized sign-in page would have asked Mike to sign in again instead.

The failure happens before any work directory is created, so this run left no bundle and nothing to clean up. The screenshot itself is not stored in the repo.

## Risk

The directory photo route cannot run against the live directory. Direct portrait upload in the app is unaffected.

## Direction

`config/directory.json` is now `directory-v2`. It matches the map by URL shape: `/households/` links, `/members/` links, `/photos/members/` portraits, and `/photos/households/` for the household photo. Styled-component class names are not used. A real run still has to succeed before this item is resolved. Do not commit page HTML, screenshots, or member data.

## Evidence

- Mike's run on 2026-11-01, exit code 1, message as above
- Mike's confirmation the same day that the screen at Enter was the signed-in Ward Directory and Map, with a household sidebar and a map. Names and the map are intentionally not recorded here.
- `tools/collector/config/directory.json` (`_note`, `layoutVersion`)
- `tools/collector/src/collect.ts` (`waitForPage`, the household-list check, and `total === 0`)
- `docs/tasks/T-061-directory-photo-collector.md` human check, which names this message as the selector-update outcome
