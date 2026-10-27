# T-026: Member profile service

**Milestone:** 3 — Server and collaboration
**Depends on:** T-020 (core tag functions), T-015 (approvals, `dropMemberApprovals`), T-022 (roles), T-023 (store), T-024 (channel), T-025 (lifecycle messages in `ws/channel.ts`). All `done`.
- Runs alongside T-028. It shares no files with T-028.

**Spec refs:**
- SPEC.md §7, Independent roster structures: member names, photos, notes and tags are ward-wide shared data. Editing them updates the profile across Current and all proposals.
- SPEC.md §6:
  - `needs_approval` is a member property, not a tag.
  - Only Admins set or clear it, and an Editor's attempt is refused.
  - Setting it makes the member's proposed placements in Draft proposals require approval, and approval is required each time.
  - Clearing it removes the requirement.
  - Tags are ward-wide. Maximum note length is OPEN; the schema caps it at 280.
- SPEC.md §10: the only presentation setting is Show Needs approval. It is off by default and only Admins can change it. Shared changes propagate to other clients without a refresh.
- AGENTS.md § Security rules:
  - Every new message type is tested with a revoked session.
  - Every admin-only action is tested with an Editor.

## Goal
Clients on `/api/ws` can:
- edit a member's name, note, and tags;
- create and rename tags;
- (Admins only) set or clear a member's `needs_approval`;
- (Admins only) change the Show Needs approval setting.

Every change is committed in one SQLite transaction and pushed to every open connection. Turning `needs_approval` on drops that member's existing approvals on Draft proposals, so each placement needs fresh approval.

## Design decisions (binding)

### Store (`apps/server/src/store/`)
New `Store` methods, each one SQLite transaction. Validation goes through the core functions named here; do not reimplement it.
- `updateMemberProfile(id: MemberId, patch: { name?: string; note?: string | null; tagIds?: readonly TagId[] }): StoreResult<Ward>`
  - `tagIds` goes through `setMemberTags`.
  - The whole ward must still pass `createWard`.
  - Unknown member → `not_found`. An unknown tag id or another validation failure → `invalid`.
  - Removed members (non-null `removedDate`) may be edited.
- `createTag(name: string, ids: IdGenerator): StoreResult<{ ward: Ward; tagId: TagId }>` and `renameTag(id: TagId, name: string): StoreResult<Ward>`
  - Both go through core `createTag` / `renameTag`.
  - Map core's duplicate-name error to `invalid`.
  - `renameTag` with an unknown tag id → `not_found`.
  - Core `setMemberTags` reports an unknown tag id as `not_found`. Map that to `invalid`; only an unknown member is `not_found`.
- `setNeedsApproval(id: MemberId, value: boolean): StoreResult<{ ward: Ward; boards: readonly Board[] }>`
  - Updates the flag.
  - When `value` is `true`, it also applies `dropMemberApprovals` to **every Draft proposal's working board**, in the same transaction.
  - Each board that actually changed is written with `version + 1`.
  - Those changed boards, as stored, are returned in `boards`.
  - When `value` is `false`, no board changes.
  - Setting the value the member already has → `invalid` with message `no change`.
  - Baselines, Current and Accepted proposals are never modified.
- `loadSettings(): { showNeedsApproval: boolean }` and `setShowNeedsApproval(value: boolean): void`
  - The `settings` row has key `showNeedsApproval` and a JSON boolean value.
  - When the row is absent, the value is `false`.

### Input rules (`apps/server/src/members/`)
Pure validation functions, unit-tested without a socket.
- `name`: trimmed, 1–100 characters.
- `note`: `null`, or a string that is trimmed, with an empty result becoming `null`. Maximum 280 characters after trimming.
- `tagIds`: an array of non-empty strings with no duplicates, at most 20.
- Tag `name`: trimmed, 1–40 characters.
- `patch` must have at least one key, and only the keys `name`, `note`, and `tagIds`.

### WebSocket messages (wired in `apps/server/src/ws/channel.ts`)
- Every request carries a `requestId` (1–64 characters).
- Each message must have exactly its listed keys. Otherwise → `rejected` with `bad_request`.
- Refusals use the existing `rejected` shape and go to the sender only.

**Role checks** use the user returned by the access re-check that already runs for each message, not the user captured at connect. An Admin demoted to Editor mid-connection is therefore refused on their next admin message. An Editor sending an admin-only message gets `rejected` with code `forbidden`. The connection stays open and nothing changes.

Client → server:
1. `{ type: "updateMember", requestId, memberId, patch }`
   - Editor or Admin.
   - Errors: `bad_request`, `not_found`, `invalid`.
2. `{ type: "createTag", requestId, name }` → the sender also gets `{ type: "tagCreated", requestId, tagId }`.
   - Editor or Admin.
3. `{ type: "renameTag", requestId, tagId, name }`
   - Editor or Admin.
4. `{ type: "setNeedsApproval", requestId, memberId, value }`
   - **Admin only.**
5. `{ type: "getSettings", requestId }` → `{ type: "settings", requestId, showNeedsApproval }`.
   - Editor or Admin.
6. `{ type: "setShowNeedsApproval", requestId, value }`
   - **Admin only.**

On success:
- Messages 1–4: the sender receives `{ type: "memberUpdated", requestId }`, or `tagCreated` for message 2. **Every** open connection, whatever its subscription, receives `{ type: "ward", ward }` with the full committed ward.
- Message 4 also sends `{ type: "committed", boardId, version, board, requestId, by }` for each changed board, to that board's subscribers only. This is the same shape as T-024.
- Message 6: every open connection receives `{ type: "settings", requestId: "", showNeedsApproval }`.

## Scope
May change:
- `apps/server/src/members/**` (new)
- `apps/server/src/store/index.ts`, `persist.ts`, `types.ts` (new methods only)
- `apps/server/src/ws/channel.ts` (new message types and broadcasts only)
- `apps/server/src/index.ts` (exports only)
- `apps/server/test/members/**` (new), `apps/server/test/store/members.test.ts` (new), `apps/server/test/ws/members.test.ts` (new). `apps/server/test/ws/helpers.ts` may gain new helpers; existing helpers must not change behavior.

Must not change:
- `apps/server/src/server.ts`, `apps/server/src/photos/**`, `apps/server/src/db/**` (no migration is needed), `packages/**`, `apps/web/**`, and existing tests.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Input rules | `pnpm --filter @wardboard/server exec vitest run test/members` | every `test/members` test in the table passes |
| 2 | Store methods (real SQLite, temp dir) | `pnpm --filter @wardboard/server exec vitest run test/store/members.test.ts` | every `store/members` test passes |
| 3 | WebSocket messages (real server, ephemeral port, fixture identity) | `pnpm --filter @wardboard/server exec vitest run test/ws/members.test.ts` | every `ws/members` test passes |
| 4 | Existing tests unchanged and green | `pnpm --filter @wardboard/server test && pnpm --filter web test` | both exit 0 |
| 5 | No migration or dependency change | `git diff main --stat -- apps/server/src/db apps/server/package.json pnpm-lock.yaml` | empty output |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use the fictional fixture ward. Build approvals with core `approvePlacement` on proposals created through the store.

| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `members/rules.test.ts` › `name trimmed 1–100; note trimmed, blank → null, ≤280; tag name 1–40` | boundaries (0/1/100/101, 280/281, 40/41) | off-by-one; no trim |
| `members/rules.test.ts` › `patch rejects empty, unknown keys, duplicate or >20 tagIds, non-strings` | strict shape | permissive parse |
| `store/members.test.ts` › `updateMemberProfile persists name, note and tags; reload shows them; unknown member → not_found; unknown tag → invalid` | ward-wide write | partial write; FK error escaping as throw |
| `store/members.test.ts` › `createTag then duplicate name → invalid; renameTag persists` | tag library | case/duplicate handling bypassing core |
| `store/members.test.ts` › `setNeedsApproval(true) drops the member's approvals on Draft boards only and bumps only changed boards' versions` | fresh approval each time; Accepted/baseline/Current untouched | dropping on Accepted; bumping unchanged boards |
| `store/members.test.ts` › `setNeedsApproval(false) changes no board; same value → invalid` | clearing semantics | needless version bumps |
| `store/members.test.ts` › `settings default false; set persists across reopen` | settings row | wrong default |
| `ws/members.test.ts` › `updateMember: sender gets memberUpdated; connections subscribed to different boards and unsubscribed ones all receive ward` | ward-wide broadcast | broadcasting only to one board |
| `ws/members.test.ts` › `edited name appears in the next snapshot of Current and of every proposal` | SPEC §7 shared profile | per-board member copies |
| `ws/members.test.ts` › `Editor setNeedsApproval → rejected forbidden, connection open, flag unchanged` | admin-only rule | missing role check |
| `ws/members.test.ts` › `Editor setShowNeedsApproval → rejected forbidden, setting unchanged` | admin-only rule | missing role check |
| `ws/members.test.ts` › `Admin demoted to Editor mid-connection is refused setNeedsApproval` | role from per-message re-check | using connect-time role |
| `ws/members.test.ts` › `Admin setNeedsApproval(true) with an existing approval: committed goes to that board's subscribers, ward to all, and unapprovedPlacements now lists the placement` | approval drop wiring | approval kept; no committed broadcast |
| `ws/members.test.ts` › `setShowNeedsApproval broadcasts settings to all; getSettings returns it` | setting propagation | not broadcasting |
| `ws/members.test.ts` › `each new message type from a revoked user → error forbidden and close 4403, no state change` | security rule | dispatch before re-check |
| `ws/members.test.ts` › `bad_request for extra keys on each message type` | strict shape | permissive dispatch |

## Edge cases (each needs a test)
- Name of 100 and 101 characters; note of 280 and 281; whitespace-only name; empty `tagIds` (clears tags).
- Editing a removed member.
- `setNeedsApproval` with no proposals, and with an Accepted proposal holding an approval (unchanged).
- Revoked session for every new message type, Editor for both admin-only types, and mid-connection demotion.

## Human checks
none

## Out of scope
- Deleting tags (`deleteTag` with usage counts and cross-board effects). That needs its own contract before T-039.
- Setting `photoRef` on a member (T-060).
- External callings, `removed_date`, and category, which are import-owned (T-058).
- Any UI (T-037, T-039, T-046).
