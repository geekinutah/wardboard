# T-086: Server: deleteTag, getTagUsage, and acceptedAt in the proposal list

**Milestone:** 4 — Desktop board (server support for integration)
**Depends on:** T-020 (core `deleteTag`, `tagUsage`), T-024/T-025 (channel, proposal lifecycle), T-072 (message-type auth pattern). All are `done`.
- Promoted from B-042 (with T-087).
- No overlap with in-flight T-081 or T-083, which only touch web files.

**Spec refs:**
- SPEC.md §6: deleting a tag removes it from all members and from calling preferences in Current and every proposal, without notices, after a confirmation that shows how many members and calling preferences use it. `needs_approval` is not a tag and is not affected.
- SPEC.md §3: past accepted proposals stay viewable in an Accepted list. Record who accepted and when.
- AGENTS.md Security rules: every message type has a test proving an unauthenticated or revoked session is refused.

## Goal
- The operation channel gets a `deleteTag` message. It runs core `deleteTag` across the ward and every stored board in one SQLite transaction.
- It also gets a `getTagUsage` read that returns core `tagUsage` counts for the delete confirmation.
- The `boards` list carries `acceptedAt` for each proposal, so the client can build the Accepted list without one request per proposal.

## Design decisions (binding)

### Wire format (T-087 builds the client against exactly this)
- **`deleteTag`**
  - Request: `{ type: 'deleteTag', requestId, tagId }`. Exact keys. `requestId` follows the existing bounded rule. `tagId` is a non-empty string.
  - Success: the requester gets `{ type: 'tagDeleted', requestId, tagId }`.
  - Every open connection gets `{ type: 'ward', ward }` (existing `broadcastWard`).
  - For each changed Current or proposal working board, the subscribers get the existing `committed` broadcast (`broadcast(board, requestId, actor.login)`) at `version + 1`.
  - Then `broadcastBoards()` runs once.
  - Refusals:
    - Bad shape: `rejected` with `bad_request`.
    - Unknown tag: `rejected` with `not_found`.
    - No session, or a revoked or forbidden session: the existing connection-level refusal (`error` with `forbidden` and close 4403 for revoked).
- **`getTagUsage`**
  - Request: `{ type: 'getTagUsage', requestId, tagId }`.
  - Reply: `{ type: 'tagUsage', requestId, tagId, members, callingPreferences, callingTags }`. The counts come from core `tagUsage(ward, boards, tagId)`, where `boards` = Current plus every proposal **working** board (Draft and Accepted). Baselines are not counted: they are hidden snapshots, and counting them would double-count a calling the user sees once.
  - Unknown tag: `rejected` with `not_found`.
- **`boards.proposals[]`**: each entry gains `acceptedAt: string | null`, read from the stored acceptance. Existing fields are unchanged.

### Deletion semantics
- Core `deleteTag(ward, boards, id)` is called with **every** stored board: Current, each proposal's working board, and each baseline. No dangling tag id may remain anywhere, because `createBoard` validation requires it.
- The ward and every changed board are written in one `withImmediateTransaction`.
- Current and working boards whose content changed are written at `version + 1`.
- Baselines are written in place with no version bump. Baselines have no subscribers, and they keep their snapshot role apart from the dropped tag id.
- Unchanged boards are not rewritten.
- Accepted proposals are included (SPEC §6: "every proposal"). Their frozen `accepted_summary` text is not touched; it holds no tag ids.
- `needsApproval` and approvals are unchanged. Assert this in a test.
- Authorization: any signed-in Editor or Admin. Tags are shared Editor data; SPEC §6 does not restrict deletion to Admins.
- The server does not log tag names or member names.

### Store
- Add `deleteTag(id: TagId): StoreResult<{ ward: Ward; boards: readonly Board[] }>` (returning the changed Current and working boards, after the version bump) and `tagUsage(id: TagId): StoreResult<TagUsage>` to `Store`, implemented in `store/index.ts` with helpers in `persist.ts` as needed.
- Add `acceptedAt` to `ProposalSummary` / `listProposalSummaries`.

## Scope
May change:
- `apps/server/src/ws/channel.ts`
- `apps/server/src/store/index.ts`, `apps/server/src/store/types.ts`, `apps/server/src/store/persist.ts`
- `apps/server/test/ws/tags.test.ts` (new), `apps/server/test/store/delete-tag.test.ts` (new)

Must not change:
- Existing tests, `packages/**`, `apps/web/**`, migrations / the DB schema (no schema change is needed; if one is, stop and report).

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Store tests | `pnpm --filter @wardboard/server exec vitest run test/store/delete-tag.test.ts` | all pass |
| 2 | Channel tests | `pnpm --filter @wardboard/server exec vitest run test/ws/tags.test.ts` | all pass |
| 3 | Existing tests untouched | `git diff origin/main --stat -- 'apps/server/test/**' ':!apps/server/test/ws/tags.test.ts' ':!apps/server/test/store/delete-tag.test.ts'` | empty output |
| 4 | Scope | `git diff origin/main --name-only` | only the paths under "May change" |
| 5 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use a real SQLite database in a temp dir and a real WebSocket server on an ephemeral port, following `test/ws/members.test.ts`. Use fictional data only.

| File › test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `delete-tag.test.ts` › `removes the tag from the ward, members, Current, a Draft, an Accepted proposal and their baselines in one write` | everywhere | skipping baselines or accepted proposals; `createBoard` later fails on the dangling id |
| `delete-tag.test.ts` › `changed Current/working boards are returned at version+1; unchanged boards keep their version` | versioning | bumping every board, or none |
| `delete-tag.test.ts` › `needsApproval and approvals are unchanged` | SPEC §6 | the flag treated as a tag |
| `delete-tag.test.ts` › `unknown tag → not_found and nothing written` | error path | partial write |
| `delete-tag.test.ts` › `a failure mid-transaction rolls back (ward still has the tag)` (inject the failure through a board that fails validation, or an equivalent seam that does not mock SQLite) | atomicity | writing outside the transaction |
| `delete-tag.test.ts` › `tagUsage counts members once and preferences/tags over Current + working boards, not baselines` | counts | counting baselines |
| `delete-tag.test.ts` › `listProposals includes acceptedAt (null for Draft, the stored time for Accepted)` | Accepted list | missing field |
| `tags.test.ts` › `Editor deleteTag → tagDeleted to the requester, ward to all, committed to a Draft subscriber at version+1, then boards` | broadcast | the subscriber keeps a stale board |
| `tags.test.ts` › `getTagUsage returns the store counts` | read | wrong reply shape |
| `tags.test.ts` › `deleteTag / getTagUsage with bad shape (extra key, empty tagId, bad requestId) → rejected bad_request` | validation | accepting junk |
| `tags.test.ts` › `unknown tag → rejected not_found for both` | error path | crash |
| `tags.test.ts` › `revoked user sending deleteTag or getTagUsage → error forbidden and close 4403, nothing deleted` | auth | the revoked user can delete |
| `tags.test.ts` › `unauthenticated upgrade cannot send deleteTag` (the connection is refused before any message) | auth | an unauthenticated socket accepted |

## Edge cases (each needs a test)
Covered above: unknown tag, an Accepted proposal, baselines, unchanged boards, a revoked user, bad shape, rollback.

## Human checks
none

## Out of scope
- Web sync client methods (T-087) and UI (later integration tasks).
- Tag rename semantics (already exist).
- Cleanup of orphaned tags.
