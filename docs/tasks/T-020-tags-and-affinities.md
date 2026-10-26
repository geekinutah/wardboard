# T-020: Tags and affinities

**Milestone:** 2 — Board domain
**Depends on:** T-007
**Spec refs:** SPEC.md §6 (ward-wide member tags; calling tags and affinities are board-owned preferences, never requirements; deleting a tag removes it from members and calling preferences in Current and every proposal, after a confirmation showing usage counts; `needs_approval` is not a tag and is unaffected by tag operations), §7 (Tag / MemberTag, CallingTag / CallingAffinity), §3 (Current is read-only to ordinary edits)

## Goal
Pure functions in `packages/core/src/tags/` manage the ward-wide tag library and member tags, per-board calling tags and preferences, tag-usage counts for the delete confirmation, cascading tag deletion across every board, and preference-match computation.

## Design decisions (binding for this task)
- Ward-level operations return `TagResult<T> = { ok: true; value: T } | { ok: false; error: { code; message } }`, with values produced through `createWard` / `createBoard` (so invariants are rechecked and results frozen; throw if validation unexpectedly fails — programming error).
  - `createTag(ward, ids, name): TagResult<{ ward: Ward; tagId: TagId }>` — trims; empty → `invalid_name`; case-insensitive duplicate → `duplicate_tag_name`.
  - `renameTag(ward, tagId, name): TagResult<Ward>` — same rules (renaming to its own name with different case is allowed).
  - `setMemberTags(ward, memberId, tagIds): TagResult<Ward>` — replaces the member's tags; unknown tag → `not_found`; duplicates collapsed in first-occurrence order. Never touches `needsApproval`.
  - `tagUsage(ward, boards, tagId): { members: number; callingPreferences: number; callingTags: number }` — `members` = members carrying the tag; `callingPreferences` / `callingTags` = number of `(board, assignment)` pairs referencing it in `preferredMemberTagIds` / `callingTagIds` across all supplied boards.
  - `deleteTag(ward, boards, tagId): TagResult<{ ward: Ward; boards: readonly Board[] }>` — removes the tag from the library, from every member, and from `callingTagIds` and `preferredMemberTagIds` on **every** supplied board of any kind (Current, proposals and baselines — leaving it in a baseline would leave a dangling reference). Boards are returned in input order; `version`, ids and everything else unchanged. Unknown tag → `not_found`. `needsApproval` values unchanged.
- Board-level operations (`OperationResult`-like `{ ok: true; board } | { ok: false; error }`), allowed only on `kind: 'proposal'` boards (else `board_not_editable`):
  - `setCallingTags(board, ward, assignmentId, tagIds)` and `setCallingPreferences(board, ward, assignmentId, tagIds)` — replace the list; unknown assignment or tag → `not_found`; duplicates collapsed. Do not change `board.version`.
- `preferenceMatches(board, ward, assignmentId, memberId): readonly TagId[]` — the assignment's preferred tags the member carries, in preference order. Informational only: there is no "eligible"/"rejected" output and no ranking function (SPEC §6: preferences are not qualifications; no automatic ranking).
- Board operations must not depend on T-009's `src/ops/` module (they run in parallel); keep these self-contained in `src/tags/`.

## Scope
May change:
- `packages/core/src/tags/` (new)
- `packages/core/src/index.ts` (one export line)
- `packages/core/test/tags/` (new)

Must not change: `packages/core/src/model/**`, `src/fixtures/**`, `src/ops/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Tag tests | `pnpm --filter core exec vitest run test/tags` | all pass |
| 2 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 3 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `createTag adds a trimmed tag with a generated id` | `'  Weekday availability '` → stored trimmed, id from `ids` | untrimmed |
| `createTag rejects empty and case-insensitive duplicates` | `''`, `'   '` → `invalid_name`; existing `Youth` vs `youth` → `duplicate_tag_name` | case-sensitive |
| `renameTag allows a case-only change of its own name` | `Youth` → `YOUTH` ok; to another tag's name → `duplicate_tag_name` | self-collision |
| `setMemberTags replaces tags and keeps needsApproval` | needs-approval member's flag unchanged; duplicates collapsed | flag cleared |
| `setMemberTags rejects unknown tags` | → `not_found` | dangling tag |
| `tagUsage counts members and calling references across boards` | fixture Current + proposal (2 boards) → counts double for board-owned refs | counts only one board |
| `deleteTag removes the tag everywhere` | after delete: not in library, no member has it, no assignment on Current, proposal board or baseline references it | baseline left dangling (createBoard would fail) |
| `deleteTag leaves everything else unchanged` | other tags, placements, versions, needsApproval identical | collateral edits |
| `deleteTag of an unknown tag is refused` | → `not_found` | silent success |
| `calling tag edits are proposal-only` | on Current → `board_not_editable`; on proposal ok | Current editable |
| `setCallingPreferences replaces and dedupes` | — | append instead of replace |
| `calling edits on one proposal do not affect another` | two proposals from the same Current: edit A, B unchanged | shared references |
| `preferenceMatches returns matching preferred tags in order` | fixture affinity → its matching tag; member without the tag → `[]` | returns all preferred tags |
| `results are frozen and inputs untouched` | — | mutation |

## Edge cases (each needs a test)
- Deleting a tag nobody uses.
- `tagUsage` with an empty board list.
- Assignment with no preferences → `preferenceMatches` is `[]`.

## Human checks
none

## Out of scope
- Server persistence and broadcast of tag edits (T-026), the tag editor UI (T-039), setting `needsApproval` (Admin-only, T-026), search by tag (T-019).
