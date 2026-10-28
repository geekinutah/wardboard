# T-089: Tag library on the Settings page

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-087, T-039 (done), T-080 (done), T-086 (done). All `done`.
- Promoted from B-042. Runs in parallel with T-088 and T-090, which share none of its files.

**Spec refs:** SPEC.md §6: deleting a tag removes it from all members and calling preferences in Current and every proposal, without notices. Deletion requires a confirmation that shows how many members and calling preferences use it. `needs_approval` is not a tag. SPEC §12 has the tag-deletion scenario. Artboard 10 (`Tags.dc.html`, library and delete dialog) and artboard `Settings.dc.html`.

### Integration conventions
The T-083 integration conventions apply: existing tests unchanged, the fake `WebSocketLike` + `SyncClient` pattern, e2e against the checkout server on all four projects with real input, the GUI capture, and an unchanged phone layout. Tags are ward-wide, so e2e tests create and delete only tags they create, with names unique per project/repeat. They never delete a seeded tag.

## Goal
The Settings page (`/settings`) has a **Tags** section with T-039's `TagLibrary`, wired to the server. Its delete confirmation shows the server's usage counts from `getTagUsage`. Delete is not enabled until those counts arrive.

## Design decisions (binding)
- **`TagLibrary` change** (`features/tags/TagLibrary.tsx`; this is the one feature edit allowed):
  - `usageOf` becomes `(tagId) => TagUsage | null`.
  - A new optional prop `onDeleteRequested?: (tagId: TagId) => void` is called once when the delete dialog opens.
  - While `usageOf` returns null, the dialog body reads `Counting where it's used…`, and `Delete tag` is `disabled`. Cancel and Escape still work.
  - Existing `TagLibrary.test.tsx` tests stay unchanged and keep passing, because returning a `TagUsage` behaves as before.
  - New behavior gets new tests in a new file, `features/tags/TagLibrary.usage.test.tsx`.
- **New `apps/web/src/shell/TagLibrarySection.tsx`**, rendered by `SettingsRoute.tsx` as a section with the heading `Tags` after the existing sections. The `SettingsRoute.tsx` edit is one import and one element. It is visible to Editors and Admins.
  - `ward` comes from `useSync().ward`. Until the ward arrives, show `Loading tags…`.
  - `onCreateTag` → `client.createTag(name)`. `onDeleteTag` → `client.deleteTag(tagId)`.
  - `onDeleteRequested(id)` → `client.getTagUsage(id)`. On ok, the result is stored per tag id, so `usageOf(id)` returns it.
  - On refusal, store the failure. The dialog then shows `Couldn't count where it's used: {message}` (render this through `usageOf` returning null, plus an extra `role="alert"` line from the section) and Delete stays disabled.
  - Cached usage is dropped whenever a `ward` push arrives (the ward object changes). The next dialog open then refetches.
  - The ward push after a delete updates the table through the existing sync state. No extra local state is needed for rows.
- Styling uses the existing `settings-route.css` classes where they fit. New rules go in a new `apps/web/src/shell/tag-library-section.css`.

### Round 2 amendments (binding; they replace conflicting text above)
- **Counts never get stuck.** While a delete dialog is open, its tag's usage must eventually show counts or an error. A `ward` push that arrives while a `getTagUsage` request is in flight must not leave the dialog counting forever. Either refetch after the push for the open dialog's tag, or keep the in-flight reply and invalidate only afterwards; either way, at most one request is outstanding per tag. Cached usage for other tags is still dropped on a ward push.
- **Refusals show in the dialog.** `TagLibrary` gains an optional prop `usageErrorOf?: (tagId: TagId) => string | null`. When it returns a message, the dialog body shows `Couldn't count where it's used: {message}` in a `role="alert"` element in place of the counting text, and `Delete tag` stays disabled. The section-level fixed toast is removed. Existing `TagLibrary.test.tsx` stays unchanged and passing.
- **Placement in the cards column.** `features/settings/SettingsPage.tsx` gains an optional prop `extra?: ReactNode`, rendered after the last card inside the same main cards column (`.wb-settings-main`), with no other change. `SettingsRoute.tsx` passes `<TagLibrarySection />` as `extra` instead of rendering it as a sibling. On desktop the Tags card then sits directly below the Backup card, left-aligned with the other cards, with no viewport-height gap. Existing settings tests stay unchanged and passing.
- **Scope additions:** `apps/web/src/features/settings/SettingsPage.tsx` (the `extra` prop only), `apps/web/src/features/settings/SettingsPage.extra.test.tsx` (new). `SettingsRoute.tsx` may change only how `TagLibrarySection` is mounted.
- **New tests:**
  - `tag-library-section.test.tsx` › `a ward push while getTagUsage is in flight still ends with counts and Delete enabled` (deterministic: send the ward push before the tagUsage reply).
  - `TagLibrary.usage.test.tsx` › `usageErrorOf message replaces the counting text and Delete stays disabled`.
  - `SettingsPage.extra.test.tsx` › `extra renders inside the main column after the last card`.
- **Stability evidence:** run `pnpm exec playwright test -c e2e/playwright.config.ts e2e/tag-library.spec.ts --repeat-each=5` from `apps/web`; it must pass every repeat on all four projects.

## Scope
May change:
- `apps/web/src/features/tags/TagLibrary.tsx`
- `apps/web/src/features/tags/TagLibrary.usage.test.tsx` (new)
- `apps/web/src/shell/TagLibrarySection.tsx` (new)
- `apps/web/src/shell/tag-library-section.css` (new)
- `apps/web/src/shell/tag-library-section.test.tsx` (new)
- `apps/web/src/shell/SettingsRoute.tsx`: one import and one element
- `apps/web/e2e/tag-library.spec.ts` (new)
- `apps/web/e2e/gui/tag-library.capture.ts` (new)

Must not change: existing tests (including `TagLibrary.test.tsx` and `settings-route.test.tsx`), `BoardShell.tsx`, `PersonPanel.tsx`, `board-levels.tsx`, other `features/**`, `sync/**`, server, and packages.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/tag-library-section.test.tsx src/features/tags` | all pass, including the unchanged `TagLibrary.test.tsx` |
| 2 | Scope and existing tests | `git diff origin/main --name-only` | only paths under "May change"; no pre-existing `*.test.*` file listed |
| 3 | Browser | `pnpm --filter web run test:e2e` | exits 0, with `tag-library.spec.ts` passing on all four projects (confirm with `pnpm exec playwright test -c e2e/playwright.config.ts e2e/tag-library.spec.ts`) |
| 4 | GUI | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/tag-library/` has the Settings Tags section and the delete dialog with counts (desktop, phone ×2), compared with artboard 10 |
| 5 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File › test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `TagLibrary.usage.test.tsx` › `null usage: counting text and Delete disabled; Cancel works` | pending state | deleting without counts |
| `TagLibrary.usage.test.tsx` › `onDeleteRequested called once per dialog open with the tag id` | fetch trigger | a fetch loop or no fetch |
| `tag-library-section.test.tsx` › `Settings shows the Tags section with ward tags and member counts` | mount | missing section |
| `tag-library-section.test.tsx` › `opening delete sends getTagUsage; the tagUsage reply fills the counts and enables Delete` | wiring | stale or hard-coded counts |
| `tag-library-section.test.tsx` › `Delete tag sends deleteTag; tagDeleted plus ward push removes the row` | delete path | a row lingers |
| `tag-library-section.test.tsx` › `usage refusal shows the alert and Delete stays disabled` | error path | deleting without confirmation counts |
| `tag-library-section.test.tsx` › `a ward push clears cached usage so the next open refetches` | freshness | stale counts after a delete elsewhere |
| `tag-library-section.test.tsx` › `editor sees and can use the library` | authorization | admin-only gate |

`e2e/tag-library.spec.ts`: create a uniquely named tag in Settings, attach it to one person through the API helper or the inspector, open delete, see `Removes it from 1 person`, delete it, and confirm the row is gone after a reload.

## Edge cases (each needs a test)
Covered above: pending counts, refusal, freshness after a ward push, Editor access.

## Human checks
none

## Out of scope
- Tag rename UI.
- Member and calling tag editing in the board (T-088).
- Accepted view (T-090).
