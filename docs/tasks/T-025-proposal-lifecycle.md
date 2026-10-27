# T-025: Proposal lifecycle

**Milestone:** 3 — Server and collaboration
**Depends on:** T-015 (`unapprovedPlacements`), T-017 (`acceptanceEligibility`), T-018 (`acceptedSummary`), T-022 (access), T-023 (store), T-024 (operation channel). All `done`.
- Runs alongside T-027 and T-034. It shares no files with them.
- T-026 (member profile service) also edits `ws/channel.ts`, so it runs after this task merges.

**Spec refs:**
- SPEC.md §3, Current and Proposed:
  - Start a proposal from Current, or duplicate an existing proposal, with a name and an optional rationale.
  - Statuses are Draft (editable) and Accepted (read-only). Accepted can return to Draft.
  - A proposal cannot be accepted while it places a removed member, contains a removed position, or has an unapproved placement that needs approval.
  - Accepting produces a summary grouped by overseer. The summary is frozen while the proposal is Accepted and regenerated on re-accept.
  - Past accepted proposals stay viewable. Any Editor may accept or reopen, and the server records who and when.
- SPEC.md §6: duplicating never copies approvals. `store.createProposal` already does this.
- SPEC.md §10: every edit is server-authoritative and visible to other clients.
- AGENTS.md § Security rules: every new message type is tested with a revoked session.

## Goal
Clients on `/api/ws` can create proposals (from Current or as a duplicate), rename them, edit their rationale, accept them, and return them to Draft.
- Acceptance is refused for ineligible proposals, with a specific reason code.
- When a proposal is accepted, the server records the accepting user, the time, and a frozen structured summary.
- Every connected client learns about these changes without refreshing.

## Design decisions (binding)

### Store (`apps/server/src/store/`)
Add two methods to `Store`, each one SQLite transaction:
- `updateProposalMeta(id: ProposalId, meta: { name: string; rationale: string | null }): StoreResult<Proposal>`
  - Unknown id → `not_found`. An Accepted proposal → `not_editable`.
  - Sets `name`, `rationale` and `updated_at`.
  - Does **not** change the board version.
- `setProposalAcceptance(id: ProposalId, accepted: ProposalAcceptance | null): StoreResult<Proposal>`
  - Non-null: status becomes `accepted`, and `accepted_by` / `accepted_at` / `accepted_summary` are written.
  - Null: status becomes `draft`, and those three columns become NULL.
  - Sets `updated_at`. Does not change the board version.
  - Unknown id → `not_found`.
  - The result must pass core's `createProposal` validation.

Existing `Store` methods and `ProposalSummary` keep their current shape. Do not add fields to `ProposalSummary`, because `apps/web` imports it.

### Lifecycle logic (`apps/server/src/proposals/`)
Pure functions on top of `@wardboard/core`, unit-tested without a socket.

- `validateMeta(input: unknown): { ok: true; name: string; rationale: string | null } | { ok: false }`
  - Input must be an object with exactly the keys `name` and `rationale`.
  - `name` is trimmed. It must be 1–80 characters.
  - `rationale` is `null` or a string. It is trimmed, and an empty result becomes `null`. Maximum 500 characters after trimming.
- `checkAcceptance(proposal: Proposal, current: Board, ward: Ward): { ok: true } | { ok: false; code: 'removed_items' | 'unapproved_placements'; message: string }`
  - Removed items are checked first. If `acceptanceEligibility(...).eligible` is false → `removed_items`.
  - Then `unapprovedPlacements(proposal, ward)`. If it is non-empty → `unapproved_placements`.
  - Each message names the counts, for example `2 removed members, 1 removed position`.
- `freezeSummary(proposal: Proposal, ward: Ward): string` returns `JSON.stringify(acceptedSummary(proposal, ward))`.
  - The stored summary is a serialized `SummaryGroup[]`, so T-043 can offer per-group Copy.
  - Names are frozen together with the summary.
  - A proposal with no changes stores `"[]"`.

### WebSocket messages (wired in `apps/server/src/ws/channel.ts`)
- Every request has a `requestId` (1–64 characters).
- Each message must have exactly its listed keys. Extra or missing keys → `{ type: "rejected", requestId, code: "bad_request", message }`.
- All refusals use the existing `rejected` shape, sent to the sender only.
- The access re-check that already runs on every message applies unchanged, so revoked sessions are closed with code `4403`.
- Any signed-in Editor or Admin may send every message below.

Client → server:
1. `{ type: "createProposal", requestId, name, rationale, source }`
   - `source` is `{ kind: "current" }` or `{ kind: "proposal", proposalId }`. Duplicating an Accepted proposal is allowed, and the copy is a Draft.
   - Errors: `bad_request` (shape or `validateMeta`), `not_found` (source proposal), `no_current`.
   - Success: the sender receives `{ type: "proposalCreated", requestId, proposalId, boardId }`. Then **every** open connection receives a fresh `boards` message, with the same payload as the `listBoards` reply.
2. `{ type: "updateProposal", requestId, proposalId, name, rationale }`
   - Errors: `bad_request`, `not_found`, `not_editable` (Accepted).
   - Success: the sender receives `{ type: "proposalUpdated", requestId, proposalId }`. Every connection subscribed to that proposal's working board receives `proposalChanged`, and every open connection receives `boards`.
3. `{ type: "setProposalStatus", requestId, proposalId, status: "accepted" | "draft" }`
   - Errors:
     - `bad_request`;
     - `not_found`;
     - `no_current`;
     - `no_change` (already in that status);
     - `removed_items` / `unapproved_placements` (from `checkAcceptance`, only when accepting).
   - Accepting writes `{ by: <user id>, at: clock ISO, summary: freezeSummary(...) }`. Reopening writes `null`.
   - The eligibility check and the write run synchronously, with no `await` in between, like operations.
   - Success: the sender receives `{ type: "statusChanged", requestId, proposalId, status }`. Then `proposalChanged` goes to subscribers of that board, and `boards` goes to every connection.
4. `{ type: "getProposal", requestId, proposalId }` → `{ type: "proposalDetail", requestId, proposal: ProposalDetail }`. Unknown id → `not_found`.

`ProposalDetail` is `{ id, name, status, rationale, baselineBoardId, boardId, createdAt, updatedAt, accepted: null | { byLogin, at, summary: SummaryGroup[] } }`.
- `byLogin` is the login of the accepting user, resolved through `access.listUsers()`. A user who has since been revoked still resolves.
- `summary` is the parsed frozen value. It is never recomputed while the proposal is Accepted.

Server → subscribers: `{ type: "proposalChanged", boardId, proposal: ProposalDetail }`.

Existing behavior that must keep working (already covered by T-024 tests):
- `op` against an Accepted proposal → `not_editable`.
- The `snapshot` and `boards` payload shapes do not change.

## Scope
May change:
- `apps/server/src/proposals/**` (new)
- `apps/server/src/store/index.ts`, `apps/server/src/store/persist.ts`, `apps/server/src/store/types.ts` (the two new methods only)
- `apps/server/src/ws/channel.ts` (new message types and broadcasts only)
- `apps/server/src/index.ts` (exports only)
- `apps/server/test/proposals/**` (new), `apps/server/test/store/lifecycle.test.ts` (new), `apps/server/test/ws/lifecycle.test.ts` (new). `apps/server/test/ws/helpers.ts` may gain new helpers; existing helpers must not change behavior.

Must not change:
- `apps/server/src/server.ts`, `apps/server/src/db/**` (no migration is needed; the columns already exist), `packages/**`, `apps/web/**`, and existing tests.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Lifecycle logic | `pnpm --filter @wardboard/server exec vitest run test/proposals` | every `test/proposals` test in the table passes |
| 2 | Store methods (real SQLite in a temp dir) | `pnpm --filter @wardboard/server exec vitest run test/store/lifecycle.test.ts` | every `store/lifecycle` test passes |
| 3 | WebSocket messages (real server, ephemeral port, fixture identity) | `pnpm --filter @wardboard/server exec vitest run test/ws/lifecycle.test.ts` | every `ws/lifecycle` test passes |
| 4 | Existing server and web tests unchanged and green | `pnpm --filter @wardboard/server test && pnpm --filter web test` | both exit 0 |
| 5 | No migration or dependency change | `git diff main --stat -- apps/server/src/db apps/server/package.json pnpm-lock.yaml` | empty output |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use the fictional fixture ward, and build proposals with `store.createProposal` or the existing helpers. Make removed and needs-approval cases with core operations on the fixture, not hand-edited rows.

| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `proposals/meta.test.ts` › `trims name, maps blank rationale to null, enforces 1–80 and ≤500` | meta validation boundaries (0, 1, 80, 81; 500, 501) | off-by-one; no trim |
| `proposals/meta.test.ts` › `rejects extra/missing keys and non-string values` | strict shape | permissive parse |
| `proposals/acceptance.test.ts` › `eligible draft → ok` | happy path | always refusing |
| `proposals/acceptance.test.ts` › `removed member placed → removed_items` and `removed position → removed_items` | SPEC §3 removal block | skipping eligibility |
| `proposals/acceptance.test.ts` › `unapproved needs-approval placement → unapproved_placements; approved → ok` | SPEC §3 approval block | ignoring approvals |
| `proposals/acceptance.test.ts` › `both problems → removed_items first` | defined precedence | order swapped |
| `proposals/summary.test.ts` › `freezeSummary round-trips to acceptedSummary output; no changes → "[]"` | frozen structure | storing plain text; storing `""` |
| `store/lifecycle.test.ts` › `updateProposalMeta persists and leaves board version unchanged; Accepted → not_editable; unknown → not_found` | store semantics | bumping version; editing accepted |
| `store/lifecycle.test.ts` › `setProposalAcceptance accept then reopen round-trips through reload; reopen clears all three columns` | persistence | stale summary after reopen |
| `ws/lifecycle.test.ts` › `createProposal from current and duplicate: sender gets proposalCreated, all connections get boards` | creation + broadcast | broadcasting only to sender |
| `ws/lifecycle.test.ts` › `duplicate of a proposal with approvals has none` | SPEC §6 via channel | copying approvals |
| `ws/lifecycle.test.ts` › `accept: statusChanged to sender, proposalChanged to subscribers only, boards to all; then op on it → not_editable` | read-only after accept | missing broadcast; op still accepted |
| `ws/lifecycle.test.ts` › `accept refused with removed_items / unapproved_placements and status unchanged` | refusal leaves state | partial write |
| `ws/lifecycle.test.ts` › `frozen summary does not change when a member is renamed in the ward while Accepted; reopen + re-accept regenerates it` | freeze/regenerate | recomputing on read |
| `ws/lifecycle.test.ts` › `getProposal returns byLogin and parsed summary for Accepted, accepted null for Draft` | detail payload | returning user id or raw string |
| `ws/lifecycle.test.ts` › `updateProposal on Accepted → not_editable; no_change on same status; not_found ids` | error codes | silent no-op |
| `ws/lifecycle.test.ts` › `each new message type from a revoked user → error forbidden and close 4403, no state change` | security rule | dispatch before re-check |
| `ws/lifecycle.test.ts` › `Editor (non-admin) may accept and reopen` | SPEC §3 any Editor | admin-only gate |

The rename-while-Accepted test may change the member name with a direct SQL `UPDATE` on `members` inside the test. There is no member-edit message until T-026.

## Edge cases (each needs a test)
- Name of exactly 80 and 81 characters; rationale of 500 and 501; whitespace-only name.
- Accepting with no Current (`no_current`), and accepting an already-Accepted proposal (`no_change`).
- A proposal with no changes accepts with summary `[]`.
- Revoked session for every new message type, and an Editor (non-admin) for accept and reopen.

## Human checks
none

## Out of scope
- Recording who reopened a proposal and when. Backlog B-012 is a separate, unpromoted decision, and there is no column for it.
- Deleting or archiving proposals (SPEC §10 OPEN), and tab reordering.
- All UI (T-041, T-043), CSV export (T-042), and member profile edits (T-026).
- Any change to `ProposalSummary`, the `snapshot` payload, or `db/` migrations.
