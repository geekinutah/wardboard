# T-087: Sync client methods for tags, needs approval, and proposal status

**Milestone:** 4 — Desktop board (client support for integration)
**Depends on:** T-086 (`done`); it uses T-086's wire format and `acceptedAt`. Also depends on T-075 (sync client request pattern), which is `done`.
- Promoted from B-042 (with T-086).

**Spec refs:** SPEC.md §6 (tags; Admin-only `needs_approval`; tag deletion with usage counts), §3 (Draft/Accepted status, frozen summary, Accepted list). The T-086 contract defines the wire format for `deleteTag`, `getTagUsage` and `acceptedAt`. Existing server messages: `createTag` → `tagCreated {requestId, tagId}`; `renameTag` → `memberUpdated {requestId}`; `setNeedsApproval` → `memberUpdated {requestId}`; `setProposalStatus {requestId, proposalId, status}` → `statusChanged {requestId, proposalId, status}`; `getProposal {requestId, proposalId}` → `proposalDetail {requestId, proposal}` (`apps/server/src/proposals/detail.ts` `ProposalDetail`, with `accepted: {byLogin, at, summary: SummaryGroup[]} | null`). Refusals arrive as `rejected {requestId, code, message}`.

## Goal
`SyncClient` gets typed request methods. T-039's and T-043's components can then be wired to the server with no further sync work:
- `createTag`, `renameTag`, `deleteTag`, `getTagUsage`, `setNeedsApproval`;
- `setProposalStatus`, `getProposal`;
- `boards.proposals[].acceptedAt` validated and exposed.

## Design decisions (binding)
- Follow the existing `requestResult(build, reply)` pattern in `apps/web/src/sync/client.ts`. Every method resolves a `RequestResult<…>`. It never rejects. It resolves `REQUEST_OFFLINE` when it is not live, and on the reply timeout.
- Signatures:
  - `createTag(name: string): Promise<RequestResult<{ tagId: string }>>`. Reply `tagCreated`.
  - `renameTag(tagId: string, name: string): Promise<RequestResult>`. Reply `memberUpdated`.
  - `deleteTag(tagId: string): Promise<RequestResult>`. Reply `tagDeleted`.
  - `getTagUsage(tagId: string): Promise<RequestResult<{ members: number; callingPreferences: number; callingTags: number }>>`. Reply `tagUsage`. A reply whose counts are not non-negative integers resolves `{ ok: false, code: 'bad_reply', … }`.
  - `setNeedsApproval(memberId: string, value: boolean): Promise<RequestResult>`. Reply `memberUpdated`.
  - `setProposalStatus(proposalId: string, status: 'draft' | 'accepted'): Promise<RequestResult<{ status: 'draft' | 'accepted' }>>`. Reply `statusChanged`.
  - `getProposal(proposalId: string): Promise<RequestResult<{ proposal: ProposalDetailView }>>`. Reply `proposalDetail`.
- `ProposalDetailView` goes in `sync/protocol.ts`. It mirrors the server `ProposalDetail` (id, name, status, rationale, baselineBoardId, boardId, createdAt, updatedAt, accepted `{ byLogin, at, summary: SummaryGroup[] } | null`). `SummaryGroup` is the core type. The reader validates the shape. A malformed detail resolves `{ ok: false, code: 'bad_reply' }`.
- `readProposalSummary` accepts `acceptedAt: string | null`. When the field is absent it is treated as `null`: the server type is optional, and existing web fixtures omit it. An entry whose `acceptedAt` is present but neither a string nor null is dropped like other malformed entries. The returned entry always has `acceptedAt` set.
- The ward, board and boards pushes that follow these requests are already applied by the existing handlers. Do not add new local state.

## Scope
May change:
- `apps/web/src/sync/client.ts`, `apps/web/src/sync/protocol.ts`
- `apps/web/src/sync/tag-status.test.ts` (new; fake `WebSocketLike` pattern from `client.test.ts`)
- `apps/web/src/sync/tag-status.node.test.ts` (new; real server, pattern from `requests.node.test.ts`)
- `apps/web/src/sync/session.test.ts`: **only** to add one `acceptedAt: null,` line to the expected `boards.proposals[0]` in `ward push replaces ward; proposalChanged updates only the subscribed board's proposal; settings push stored`. That test's exact `toEqual` breaks because the reader now always sets the field. Keep the assertion an exact `toEqual`. No other edit. (Amended in round 2.)

Must not change:
- Existing tests, `apps/server/**`, `packages/**`, `features/**`, `shell/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Fake-socket tests | `pnpm --filter web exec vitest run src/sync/tag-status.test.ts` | all pass |
| 2 | Real-server tests | `pnpm --filter web exec vitest run src/sync/tag-status.node.test.ts` | all pass |
| 3 | Existing tests untouched except the allowed field | `git diff origin/main -- 'apps/web/src/**/*.test.ts' 'apps/web/src/**/*.test.tsx' ':!apps/web/src/sync/tag-status.test.ts' ':!apps/web/src/sync/tag-status.node.test.ts'` | only `session.test.ts`, one added line `acceptedAt: null,`, and no removed lines |
| 4 | Scope | `git diff origin/main --name-only` | only the paths under "May change" |
| 5 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File › test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tag-status.test.ts` › `each method sends the exact message shape` (table over all 7) | wire format | wrong key, e.g. `id` instead of `tagId` |
| `tag-status.test.ts` › `each method resolves ok on its reply type and ignores other reply types for the same requestId` | reply matching | resolving on any message |
| `tag-status.test.ts` › `rejected → { ok:false, code, message }` | refusal | rejecting the promise |
| `tag-status.test.ts` › `offline and timeout → REQUEST_OFFLINE` (injected timers) | resilience | a promise that hangs forever |
| `tag-status.test.ts` › `getTagUsage with negative or non-integer counts → bad_reply` | validation | trusting junk |
| `tag-status.test.ts` › `getProposal with a malformed accepted block → bad_reply` | validation | crash later in the view |
| `tag-status.test.ts` › `boards entries keep acceptedAt; absent → null; an entry with acceptedAt 5 is dropped` | list | missing field, or dropping legacy entries |
| `tag-status.node.test.ts` › `createTag then deleteTag: the ward push loses the tag; getTagUsage before delete reports the seeded member count` | real round trip | method not wired |
| `tag-status.node.test.ts` › `setNeedsApproval by an editor is refused forbidden; by an admin it succeeds` | auth surfaced | swallowed refusal |
| `tag-status.node.test.ts` › `setProposalStatus accepted then getProposal returns a frozen summary and boards shows acceptedAt; draft clears it` | status | wrong reply type |

## Edge cases (each needs a test)
Covered above: offline, timeout, refusal, malformed replies, Editor refusal.

## Human checks
none

## Out of scope
- UI wiring (later integration tasks for tags and the accepted view).
- Changing the `RequestResult` default type (B-044).
