# T-075: Sync client methods for proposals, members, access and settings

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-029, T-071, T-072, T-025, T-026 (all `done`).
- First of the integration wave. It touches only `apps/web/src/sync/**`, so it runs in parallel with T-077, which doesn't change `sync/`. T-078, T-079 and T-080 depend on it.

**Spec refs:** SPEC.md §2 (invitations, admins), §3 (Start proposal), §6/§7 (shared member profile and notes), §10 (Show Needs approval, admin only). Server message shapes in `apps/server/src/ws/channel.ts` are the contract here (read; do not change): `createProposal {name, rationale, source}` → `proposalCreated {proposalId, boardId}`; `updateMember {memberId, patch}` → `memberUpdated`; `setShowNeedsApproval {value}` → `settings`; `listAccess` → `access {users, invitations}`; `invite {login}`, `revokeInvitation {invitationId}`, `revokeUser {userId}`, `setRole {userId, role}`, `transferAdmin {toUserId}` → `accessUpdated`; any refusal → `error {requestId, code, message}`; unsolicited `access` frames are pushed to admins after any access change.

## Goal
`SyncClient` and the React layer expose typed, promise-returning methods for every request message the shell still lacks, each resolving to `{ ok: true, … }` or `{ ok: false, code, message }` (never throwing, never `null`), plus a `useAccess()` hook that follows `access` pushes. Nothing in the UI changes.

## Design decisions (binding)
In `apps/web/src/sync/client.ts` (and types in `protocol.ts`):
```ts
export type RequestResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; code: string; message: string };
createProposal(input: { name: string; rationale: string | null; source: { kind: 'current' } | { kind: 'proposal'; proposalId: string } }): Promise<RequestResult<{ proposalId: string; boardId: string }>>;
updateMember(memberId: string, patch: MemberPatch): Promise<RequestResult>; // MemberPatch mirrors the server's parseMemberPatch fields (read it; include only what the server accepts)
setShowNeedsApproval(value: boolean): Promise<RequestResult>;
listAccess(): Promise<RequestResult<{ users: AccessUser[]; invitations: AccessInvitation[] }>>;
invite(login: string): Promise<RequestResult>;
revokeInvitation(invitationId: string): Promise<RequestResult>;
revokeUser(userId: string): Promise<RequestResult>;
setRole(userId: string, role: 'editor' | 'admin'): Promise<RequestResult>;
transferAdmin(toUserId: string): Promise<RequestResult>;
```
- Offline, or the socket closes before a reply: resolve `{ ok: false, code: 'offline', message: 'offline' }` (same convention as `send`). A server `error` frame resolves `{ ok: false, code, message }` with the server's values.
- Add a private result-returning request helper beside the existing `request<T>` (which returns `null`); do not change `request<T>`'s behavior or existing methods' signatures.
- `access` frames (reply or push) update `SyncState.access` (`{ users, invitations } | null`; null until first received and reset to null on disconnect). Export `useAccess()` from `react.tsx`. Non-admins never receive `access` frames, so `useAccess()` stays null for them.
- `AccessUser`/`AccessInvitation` are declared in `protocol.ts`, matching `apps/server/src/access/index.ts` `User`/`Invitation` (the web app does not import server runtime code).

## Scope
May change: `apps/web/src/sync/client.ts`, `apps/web/src/sync/protocol.ts`, `apps/web/src/sync/react.tsx`, new tests `apps/web/src/sync/requests.test.ts` and `apps/web/src/sync/requests.node.test.ts`.
Must not change: existing sync tests, `apps/server/**`, `packages/**`, `apps/web/src/shell/**`, `features/**`, anything else. New dependencies: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New tests | `pnpm --filter @wardboard/web exec vitest run src/sync/requests.test.ts src/sync/requests.node.test.ts` | all pass |
| 2 | All web unit tests | `pnpm --filter @wardboard/web test` | exits 0 (existing sync tests unchanged and passing) |
| 3 | Existing tests untouched | `git diff origin/main --stat -- apps/web/src/sync/*.test.ts apps/web/src/sync/*.test.tsx ':!apps/web/src/sync/requests*'` | empty |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`requests.test.ts` uses a fake `WebSocketLike` (as `client.test.ts` does): one test per method asserting the exact frame sent (`type`, `requestId`, fields) and the resolved result for a success reply and for an `error` frame; offline before send → `offline`; socket closes with a pending request → `offline`; an `access` push updates `getState().access`; disconnect resets it to null; `useAccess()` re-renders on push.
`requests.node.test.ts` runs against a **real server** (the pattern in `client.node.test.ts`) with the fixture identity provider:
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `createProposal from Current returns ids and the new tab appears in boards` | real `proposalCreated`; `boards.proposals` gains it | wrong message shape (server `bad_request`) |
| `updateMember saves a note that a fresh fetch returns` | note round-trips; a 281-character note resolves `ok: false` with the server's code | patch field names wrong; error swallowed |
| `admin invite, setRole, revokeUser round-trip and push access` | each resolves ok; `access` state reflects each change | pushes ignored |
| `an editor's invite is refused with forbidden` | `{ ok: false, code: 'forbidden' }` | refusal mapped to ok or null |
| `setShowNeedsApproval by admin updates settings; by editor is refused` | settings push observed / `forbidden` | |

## Edge cases (each needs a test)
Covered above: offline, close with pending request, server refusal, editor refusal, push without request, disconnect reset.

## Human checks
none

## Out of scope
Any UI; changing server messages; backup/restore HTTP (T-080 calls `fetch` directly).
