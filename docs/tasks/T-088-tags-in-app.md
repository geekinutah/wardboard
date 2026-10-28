# T-088: Member and calling tags in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-087, T-039 (done), T-078 (done). All `done`.
- Promoted from B-042. Runs in parallel with T-089 and T-090, which share none of its files.

**Spec refs:** SPEC.md §6 (member tags are ward-wide and editable from any board; `needs_approval` is Admin-only, set from the member profile; calling tags and preferences belong to the board/proposal; preferences are not requirements; show matching affinities), §7 (shared data versus proposal-owned data), §12 (affinity scenario). Artboard 10 (`Tags.dc.html`).

### Integration conventions
The integration conventions of T-083 apply unchanged: minimal shared-file edits, existing tests unchanged, a new `shell/<name>.test.tsx` using the fake `WebSocketLike` + `SyncClient`, e2e against the checkout server on all four projects using real input, the GUI capture of `/`, and an unchanged phone layout. Per T-084, e2e tests edit only a Draft proposal they create (`apps/web/e2e/support/proposals.ts`), never `Spring adjustments` or Current. Tag names they create must be unique per project/repeat, because tags are ward-wide.

## Goal
- When a person is selected (the T-078 inspector), the panel shows T-039's `MemberTagsEditor` for them, wired to the server.
- At level 3 (group detail), a `Calling tags` panel lets the user pick one of the group's callings and shows T-039's `CallingTagsEditor` for it, wired to the server.

## Design decisions (binding)
- New `apps/web/src/shell/TagsWiring.tsx`, which exports `MemberTagsSection` and `CallingTagsPanel`.
- **`MemberTagsSection({ ward, memberId })`**, rendered by `PersonPanel.tsx` directly below `<PersonInspector>`. The PersonPanel edit is one import and one element.
  - `isAdmin` = `useMe()?.role === 'admin'`, the same source as `SettingsRoute.tsx`.
  - `onSetTags` → `client.updateMember(memberId, { tagIds })`.
  - `onCreateTag` → `client.createTag(name)`.
  - `onSetNeedsApproval` → `client.setNeedsApproval(memberId, value)`.
  - Member tags are ward-wide, so the section is editable on every board, including Current and Accepted (SPEC §7).
- **`CallingTagsPanel({ board, ward, callingGroupId })`**, rendered by `board-levels.tsx` after `<GroupDetail>` in the level-3 branch. That edit is one element. `BoardShell.tsx` is not changed.
  - A section with the heading `Calling tags` and a native `<select>` labelled `Calling`. It lists the group's enabled assignments in board order; the first is selected initially.
  - It renders `CallingTagsEditor` for the selected assignment:
    - `proposalName` = `useSync().proposal?.name` when the board is a Draft proposal, otherwise `null`. Current and Accepted proposals are therefore read-only.
    - `dugoutMemberIds` = core `dugout(board, ward)` member ids.
    - `onSetCallingTags` → `send('setCallingTags', { assignmentId, tagIds })`.
    - `onSetPreferences` → `send('setCallingPreferences', { assignmentId, tagIds })`.
    - Map the `OpOutcome` to `RequestResult` (committed → ok; rejected → `{ok:false, code, message}`).
  - Highlight: canvas highlights do not exist yet (see `EditingLayer.tsx:335`). `onHighlight(ids)` therefore shows, below the editor, `<p role="status">Matching: {names joined with ", "}</p>`. Names come from the ward, in the given order. It clears when the selected calling changes.
  - A group with no enabled assignments renders nothing.
- Styling goes in a new `apps/web/src/shell/tags-wiring.css`.

## Scope
May change:
- `apps/web/src/shell/TagsWiring.tsx` (new)
- `apps/web/src/shell/tags-wiring.css` (new)
- `apps/web/src/shell/tags-wiring.test.tsx` (new)
- `apps/web/src/shell/PersonPanel.tsx`: one import and one element
- `apps/web/src/shell/board-levels.tsx`: one import and one element
- `apps/web/e2e/tags-in-app.spec.ts` (new)
- `apps/web/e2e/gui/tags-in-app.capture.ts` (new)

Must not change: `BoardShell.tsx`, `SettingsRoute.tsx`, `features/**`, `sync/**`, server, packages, and existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/tags-wiring.test.tsx` | all pass |
| 2 | Scope and existing tests | `git diff origin/main --name-only` | only paths under "May change"; no existing `*.test.*` file listed |
| 3 | Browser | `pnpm --filter web run test:e2e` | exits 0, with `tags-in-app.spec.ts` passing on all four projects (confirm with `pnpm exec playwright test -c e2e/playwright.config.ts e2e/tags-in-app.spec.ts` from `apps/web`) |
| 4 | GUI | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/tags-in-app/` has the inspector with member tags (desktop, phone ×2, TV) and the level-3 Calling tags panel (desktop, TV), compared with artboard 10 |
| 5 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `selecting a person shows their member tags; removing one sends updateMember with the remaining tagIds` | wiring | the wrong member or the full list sent |
| `Create tag sends createTag then updateMember with the new id` | create flow | the tag is created but not attached |
| `admin sees the Needs approval switch and it sends setNeedsApproval; editor sees read-only text` | authorization in the UI | an Editor can toggle |
| `member tags are editable on Current` | shared data | wrongly read-only |
| `level 3 shows Calling tags with the group's callings; changing the select switches the editor` | panel | the wrong assignment |
| `adding a preference sends setCallingPreferences for the selected assignment` | op wiring | `setCallingTags` sent instead |
| `rejected op shows the editor's alert` | error path | swallowed |
| `Current and Accepted render the calling editor read-only` | board ownership | editing Current |
| `Highlight lists the matching dugout names` | affinity display | nothing visible |

`e2e/tags-in-app.spec.ts` (real server, its own Draft and its own unique tag name):
- Select a person, create and attach a tag, reload, and see it persist.
- At level 3, add a calling preference and see the dugout match line.

## Edge cases (each needs a test)
Covered above: Current and Accepted read-only for calling tags, Editor versus Admin, a rejected op. Also a group with no enabled assignments (no panel).

## Human checks
none

## Out of scope
- Tag library and deletion (T-089). Accepted view (T-090).
- Canvas-wide highlights.
- Phone tag screens.
