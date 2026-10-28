# T-039: Tags and affinities editor

**Milestone:** 4 — Desktop board
**Depends on:** T-020 (core tags and affinities), T-037 (person inspector), T-070 (preview harness). All `done`.
- Standalone over the T-070 preview harness, like T-042/T-044/T-045. No shell mounting and no sync wiring in this task. Mounting it in the inspector and wiring it to the server is a later integration task (see B-042: the server has no `deleteTag` message and the web sync client has no tag methods yet).
- Shares no files with in-flight T-074, T-078, T-081, T-084 or T-085.

**Spec refs:**
- SPEC.md §6 "Member context, tags, and restrictions": short tags; `needs_approval` is a neutral member property, **not a tag**, set or cleared **only by Admins** from the member profile; whether it shows on the TV is controlled by the Admin-only Show Needs approval setting.
- SPEC.md §6 "Calling tags and affinities": calling tags and preferred member tags belong to the board/proposal; preferences are not requirements and never block or rank; show matching affinities. Member tags are ward-wide shared data.
- SPEC.md §6: deleting a tag removes it from all members and calling preferences in Current and every proposal, without notices, after a confirmation showing how many members and calling preferences use it.
- SPEC.md §12: "Calling affinities display preferred member-tag matches without treating preferences as mandatory qualifications"; "Deleting a tag after confirmation removes it … `needs_approval` is unaffected by tag operations".
- Artboard 10 (`docs/design/ui-canvas/Tags.dc.html`). Tokens in `docs/design/README.md`. The artboard's library data has a `tv` field; ignore it. SPEC §6 says there are no per-tag visibility settings.

## Goal
- Three standalone components in `apps/web/src/features/tags/`, matching artboard 10:
  - `<MemberTagsEditor>` edits a member's ward-wide tags, plus the Admin-only Needs approval switch.
  - `<CallingTagsEditor>` edits one calling's tags and preferred member tags on a proposal board, and shows how many dugout members match a preference.
  - `<TagLibrary>` lists tags with usage, creates tags, and deletes a tag after a confirmation with counts.
- A preview at `/__preview/tags` shows all three, backed by core functions on local state.

## Design decisions (binding)

### Pure helpers: `apps/web/src/features/tags/tag-model.ts`
Use only core (`preferenceMatches`, `tagUsage`, model types). Do not reimplement core rules.
- `memberCountByTag(ward: Ward): Record<TagId, number>`: the number of members carrying each tag. Every ward tag has a key (0 when unused).
- `tagSuggestions(ward, carried: readonly TagId[], query: string): { suggestions: { id; name; members: number }[]; create: string | null }`:
  - `q` = `query.trim()`.
  - Suggestions are ward tags not in `carried` whose name contains `q` case-insensitively (all of them when `q` is empty), sorted by name (`localeCompare`, `en`, sensitivity `base`), at most 8.
  - `create` is `q` when `q` is non-empty and no ward tag has that name case-insensitively. Otherwise it is null.
- `dugoutMatches(board, ward, assignmentId, memberIds: readonly MemberId[]): MemberId[]`: the members of `memberIds`, in input order, for whom core `preferenceMatches` is non-empty.
- `deleteConfirmation(name: string, usage: TagUsage): { title: string; body: string }`:
  - `title` = `Delete “{name}”?` (curly quotes).
  - `body` = `Removes it from {m} {person|people} and from the preferences on {p} {calling|callings}` + (when `usage.callingTags > 0`: ` and the tags on {t} {calling|callings}`) + `. Nothing else changes.`
  - Singular when the count is 1. `0` uses the plural form.

### Shared result type
Callbacks return `Promise<RequestResult>` (import the type from `apps/web/src/sync/protocol.ts`; type-only import, no sync code). On `{ ok: false }`, the component shows the `message` in an element with `role="alert"` inside that component. It keeps the previous displayed state, since the props did not change. While a callback is pending, the control that started it is disabled.

### `<MemberTagsEditor member ward isAdmin onSetTags onCreateTag onSetNeedsApproval />`
- `onSetTags(tagIds: TagId[])`. `onCreateTag(name: string): Promise<RequestResult<{ tagId: TagId }>>`. `onSetNeedsApproval(value: boolean)`.
- Eyebrow `MEMBER TAGS · WARD-WIDE`, then `h2` = member name.
- One chip per carried tag, in `member.tagIds` order. Each has a remove button with accessible name `Remove tag {name}`, which calls `onSetTags` without that id.
- Combobox input, accessible name `Add a tag`, with a listbox of suggestions from `tagSuggestions`. Each option reads `{name}` + `{n} people` (`{n} person` when 1).
  - Picking an option (click or Enter on the active option; ArrowUp/ArrowDown move) calls `onSetTags([...carried, id])` and clears the input.
  - When `create` is non-null, the last option is `Create tag “{create}”`. Picking it calls `onCreateTag(create)`. On ok, it then calls `onSetTags([...carried, tagId])`.
  - Escape closes the list.
- Note line: `Member tags are shared: changes show in Current and every proposal.`
- Placement setting section, heading `Placement setting`:
  - Admin: a `role="switch"` button with accessible name `Needs approval` and `aria-checked` matching `member.needsApproval`. Toggling calls `onSetNeedsApproval(!current)`. Help text: `Every proposed placement must be approved by an Editor. Not a tag · shown on TV only if an Admin allows it.`
  - Editor (`isAdmin` false): no switch. The text `Needs approval: On` or `Needs approval: Off`, then `Only Admins can change this.`
- Every interactive control is at least 44 px tall.

### `<CallingTagsEditor board ward assignmentId proposalName dugoutMemberIds onSetCallingTags onSetPreferences onHighlight />`
- `proposalName: string | null`. Edit controls render only when `board.kind === 'proposal'` and `proposalName !== null`. Otherwise (Current, baselines, accepted) the tags and preferences render as read-only chips, with no add or remove controls and no footer.
- Eyebrow `CALLING · THIS PROPOSAL ONLY` (editable) or `CALLING` (read-only). `h2` = the assignment title. Subtitle `{root board group name} · {single|list}`, plus ` · {filled} of {total} filled` for lists. Positions and occupants come from the board.
- `Calling tags`: chips (`Remove calling tag {name}`), plus an `+ Tag` picker using `tagSuggestions` over `callingTagIds`, with no create option. Help: `Describe the calling itself.`
- `Prefers members tagged`: chips (`Remove preference {name}`), plus an `+ Preference` picker, same rules. Help: `Preferences, not requirements — a missing tag never blocks a placement.`
- When `dugoutMatches(...)` is non-empty: `{n} {person|people} in the dugout match a preference` and a `Highlight` button that calls `onHighlight(matches)`. When it is empty, nothing renders here.
- Editable footer: `Changes apply to {proposalName}. Current and other proposals keep their own calling tags.`
- Unknown `assignmentId` renders `Calling not found.` and no controls.

### `<TagLibrary ward usageOf onCreateTag onDeleteTag />`
- `usageOf(tagId): TagUsage`. `onDeleteTag(tagId): Promise<RequestResult>`.
- Heading `Tag library` and a `+ New tag` button. The button reveals an input (`New tag name`) with Save and Cancel. Save calls `onCreateTag(trimmed)`. An empty name, or a case-insensitive duplicate, shows an inline `role="alert"` (`Enter a tag name.` / `A tag named “{name}” already exists.`) and does not call back.
- Table with columns `Tag` and `Used`. Rows are sorted by name. `Used` is `memberCountByTag`. Each row has a `Delete {name}` button.
- Delete opens a modal `role="dialog"` labelled by its title, with copy from `deleteConfirmation(name, usageOf(id))`. Focus moves into the dialog. Escape and `Cancel` close it with no callback. `Delete tag` calls `onDeleteTag(id)` and closes on ok. On refusal, the dialog stays open with the alert.
- The library never shows or offers Needs approval.

### Preview: `features/tags/preview.tsx`
- Title `Tags and affinities`.
- Local React state holds `{ ward, boards: [current, proposal.baseline, proposal.board] }`, seeded from harness data. Callbacks apply core `createTag` (with `sequentialIds('preview-tag-')`), `setMemberTags`, `setCallingTags`, `setCallingPreferences`, `deleteTag` (over all three boards), and a `needsApproval` toggle via core ward construction. Each callback resolves `{ ok: true }`, or `{ ok: false, code, message }` from the core error.
- Renders `<MemberTagsEditor isAdmin>` for the first member, sorted by name, in the harness ward. It renders `<CallingTagsEditor>` for the first list assignment on the proposal board (`proposalName` = the harness proposal name, `dugoutMemberIds` = all members with no placements on the proposal board). It renders `<TagLibrary usageOf={(id) => tagUsage(ward, boards, id)}>`.
- Layout: three columns on desktop, stacked at ≤ 600 px with no horizontal scroll.

## Scope
May change:
- `apps/web/src/features/tags/**` (new)
- `apps/web/e2e/tags.spec.ts`, `apps/web/e2e/gui/tags.capture.ts` (new)

Must not change:
- Existing tests, `packages/**`, `apps/server/**`, `apps/web/src/sync/**` (type-only import allowed), `apps/web/src/design/**`, `apps/web/src/preview/**`, `apps/web/src/shell/**`, `App.tsx`, `main.tsx`, other `features/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Pure helpers | `pnpm --filter web exec vitest run src/features/tags/tag-model.test.ts` | every `tag-model.test.ts` test in the table passes |
| 2 | Components | `pnpm --filter web exec vitest run src/features/tags` | all pass |
| 3 | Existing tests untouched | `git diff origin/main --stat -- 'apps/web/src/**/*.test.ts' 'apps/web/src/**/*.test.tsx' ':!apps/web/src/features/tags'` | empty output |
| 4 | Scope | `git diff origin/main --name-only` | only paths listed under "May change" |
| 5 | E2E | `pnpm --filter web run test:e2e` | exits 0, including `tags.spec.ts` on desktop-chromium, phone-chromium, phone-webkit (TV is out of scope; do not add it) |
| 6 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `apps/web/gui-artifacts/tags/` has desktop and phone (Chromium + WebKit) PNGs: the default state, the open suggestion list with a `Create tag` option, and the delete dialog. Inspected against artboard 10 per `docs/gui-verification.md` |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File › test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tag-model.test.ts` › `memberCountByTag counts members per tag, 0 for unused` | usage counts | missing keys or counting chips twice |
| `tag-model.test.ts` › `tagSuggestions filters case-insensitively, excludes carried, sorts, caps at 8` | suggestion rule | case-sensitive match or suggesting a carried tag |
| `tag-model.test.ts` › `tagSuggestions offers create only for a new non-blank name` | create rule | offering to create a duplicate `weekday` when `Weekday` exists |
| `tag-model.test.ts` › `dugoutMatches keeps input order and only members with a preferred tag` | match rule | returning all dugout members |
| `tag-model.test.ts` › `deleteConfirmation singular/plural and optional calling-tags clause` | confirmation copy | `1 people`, or omitting the preference count |
| `MemberTagsEditor.test.tsx` › `removing a chip calls onSetTags without that tag` | chip removal | removing the wrong id |
| `MemberTagsEditor.test.tsx` › `keyboard picks a suggestion and clears the input` | combobox | Enter submitting nothing |
| `MemberTagsEditor.test.tsx` › `Create tag creates then adds the new tag` | create flow | creating without attaching |
| `MemberTagsEditor.test.tsx` › `admin sees the Needs approval switch; toggling calls back with the negation` | admin control | switch not reflecting state |
| `MemberTagsEditor.test.tsx` › `editor sees read-only Needs approval text and no switch` | authorization in UI | editor can toggle |
| `MemberTagsEditor.test.tsx` › `refusal shows the message and keeps the chips` | error path | swallowed error |
| `CallingTagsEditor.test.tsx` › `adds and removes calling tags and preferences via the right callback` | two lists | preferences written to calling tags |
| `CallingTagsEditor.test.tsx` › `shows dugout match count and Highlight passes the matches` | affinity display | wrong count |
| `CallingTagsEditor.test.tsx` › `read-only on Current: chips, no controls, no footer` | board ownership | Current editable |
| `CallingTagsEditor.test.tsx` › `unknown assignment renders Calling not found.` | error path | crash |
| `TagLibrary.test.tsx` › `rows sorted by name with member counts` | table | unsorted |
| `TagLibrary.test.tsx` › `delete dialog shows usage copy; Cancel and Escape do not call back` | confirmation | delete without confirming |
| `TagLibrary.test.tsx` › `Delete tag calls onDeleteTag and closes; refusal keeps it open with alert` | delete path | dialog closes on failure |
| `TagLibrary.test.tsx` › `new tag: empty and duplicate names are refused without callback` | validation | creating `  ` |
| `TagLibrary.test.tsx` › `Needs approval never appears in the library` | SPEC §6 | flag listed as a tag |
| `tags.spec.ts` › `create a tag from the member editor, see it in the library, delete it with confirmation` | real input across all three panels | preview state not shared |
| `tags.spec.ts` › `no horizontal scroll; controls at least 44px tall (phone projects)` | phone layout | overflow |

## Edge cases (each needs a test)
- Ward with no tags (empty library: `No tags yet.`, and the picker shows only the create option once something is typed).
- Member with no tags (no chips; the combobox still works).
- A query that exactly matches a carried tag (no suggestion and no create).
- Tag used by 1 member and 0 preferences (singular and plural copy).
- Dugout with no matches (no match line).
- Callback refusal on each panel.

## Human checks
none

## Out of scope
- Mounting in the person inspector or group level, and wiring to the sync client or server (a later integration task, after T-078. See B-042 for the missing `deleteTag` server message).
- Tag rename UI (core and server support it; not on artboard 10).
- Preference-match badges on board cards and search tag filters (already T-038/T-077 territory).
- Phone tag editing screens (milestone 5).
