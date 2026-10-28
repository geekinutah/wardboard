# T-072: Access management over the operation channel

**Milestone:** 4 — Desktop board (prerequisite for T-046 Settings)
**Depends on:** T-022 (`Access`: invite, revoke, roles, transfer, last-admin protection), T-024 (channel), T-026 (per-message `actor` and `requireAdmin` pattern in `channel.ts`). All `done`.
- Server only. It shares no files with T-030 (web shell) or T-040 (web removed markers).

**Spec refs:**
- SPEC.md §10, Authorization:
  - WardBoard's own user list maps a verified login to Editor, Admin, or no access.
  - Invitations, admin transfer, last-admin protection, and access removal live in the authorization module.
- SPEC.md §11 item 1: private Editor access, invitations, and transferable or multiple-admin management.
- SPEC.md §12: multiple admins can manage invitations and transfer administration.
- SPEC.md §9:
  - Access removal when leaders change is OPEN.
  - Logins are personal data, so the user list is not shown to everyone.
- AGENTS.md § Security rules:
  - Every new message type is tested with a revoked session.
  - Every admin-only action is tested with an Editor.

## Goal
Admins can do all of the following over `/api/ws`:
- list users and pending invitations;
- invite a login;
- revoke an invitation;
- revoke a user;
- change a user's role;
- transfer admin.

Every rule stays in `apps/server/src/access/`; the channel only validates message shapes and maps results. When a user is revoked or loses access, that user's open connections are closed right away instead of on their next message. Admin connections receive the updated list after every change.

## Design decisions (binding)

### Messages (wired in `apps/server/src/ws/channel.ts`)
**Shape rules:**
- Every request has a `requestId` (1–64 characters) and exactly its listed keys. Otherwise → `rejected` with `bad_request`.
- String ids and logins must be non-empty.

**Admin check:**
- All six messages are **Admin only**.
- The role comes from the `actor` resolved for that message (T-026's `requireAdmin`), not the role at connect time.
- An Editor gets `rejected` with code `forbidden`. The connection stays open and nothing changes.
- The `Access` methods also check the actor (`forbidden`). Keep both checks.

Client → server:
1. `{ type: "listAccess", requestId }` → `{ type: "access", requestId, users: User[], invitations: Invitation[] }`. This uses `access.listUsers()` (including revoked users, so the screen can show them) and `access.listInvitations()`.
2. `{ type: "invite", requestId, login }` → `access.invite(actor.id, login)`.
3. `{ type: "revokeInvitation", requestId, invitationId }` → `access.revokeInvitation(actor.id, invitationId)`.
4. `{ type: "revokeUser", requestId, userId }` → `access.revokeUser(actor.id, userId)`.
5. `{ type: "setRole", requestId, userId, role: "editor" | "admin" }` → `access.setRole(actor.id, userId, role)`.
6. `{ type: "transferAdmin", requestId, toUserId }` → `access.transferAdmin(actor.id, toUserId)`.

**Error mapping:** an `AccessResult` failure is sent as `rejected` with `code` equal to the access error code, unchanged:
- `forbidden`
- `not_found`
- `invalid_login`
- `already_user`
- `already_invited`
- `last_admin`
- `revoked`

The `message` is short English text. It never echoes another user's login back to a non-admin, which can't happen because only admins reach this point.

**On success (messages 2–6):**
1. The sender receives `{ type: "accessUpdated", requestId }`.
2. Every open connection whose freshly resolved user is an **Admin** receives `{ type: "access", requestId: "", users, invitations }`. Editors receive nothing.
3. **Immediate effect on the target's connections:**
   - After `revokeUser` succeeds, every open connection belonging to that user id gets `{ type: "error", code: "forbidden" }` and is closed with `4403`. This is the same frame and code as the existing per-message re-check.
   - After `setRole` to `editor`, or after `transferAdmin`, the demoted user's connections stay open. Their next admin message is refused by the per-message check, and no extra frame is needed.
4. A revoked admin who was the actor (allowed when they are not the last admin) also has their own connections closed, after `accessUpdated` is sent.

**Serialization:** each handler runs synchronously from validation to commit and broadcast, with no `await` in between. That keeps last-admin protection race-free in the single process. This is already true of `Access` transactions; do not introduce async work.

**Logging:** never log logins, display names, or ids.

### No other changes
- No new HTTP routes.
- No `Access` interface changes. If a needed behavior is missing from `Access`, stop and report BLOCKED rather than editing `access/`.
- No web changes. The client methods and Settings UI are T-046.

## Scope
May change:
- `apps/server/src/ws/channel.ts` (the six messages, the admin broadcast, and closing revoked users' connections)
- `apps/server/test/ws/access-messages.test.ts` (new)
- `apps/server/test/ws/helpers.ts` (new helpers only; existing helpers keep their behavior)

Must not change:
- `apps/server/src/access/**`, `apps/server/src/server.ts`, `apps/server/src/db/**`, existing tests, `packages/**`, `apps/web/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Access messages (real server, ephemeral port, fixture identity, real SQLite) | `pnpm --filter @wardboard/server exec vitest run test/ws/access-messages.test.ts` | every test in the table below passes |
| 2 | Existing tests unchanged and green | `git diff main --stat -- apps/server/test ':!apps/server/test/ws/access-messages.test.ts' ':!apps/server/test/ws/helpers.ts' && pnpm --filter @wardboard/server test` | empty diff; exits 0 |
| 3 | Access module untouched | `git diff main --stat -- apps/server/src/access` | empty output |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
All in `access-messages.test.ts`, run against a real server with the fixture identity provider. Build users through `access.bootstrapAdmin`, `invite`, and `resolve`, as the T-022 tests do.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `admin listAccess returns users (including revoked) and pending invitations` | listing | filtering revoked; missing invitations |
| `Editor gets forbidden for each of the six messages; connection stays open; nothing changes` | admin-only | missing role check on one message |
| `revoked session sending each of the six messages → error forbidden, close 4403, no state change` | security rule | dispatch before re-check |
| `admin demoted mid-connection is refused invite with forbidden` | per-message role | connect-time role |
| `invite: accessUpdated to sender; access list to every admin connection and to no editor connection` | broadcast scope | leaking logins to editors |
| `invite errors pass through: invalid_login, already_user, already_invited` | error mapping | collapsing to bad_request |
| `revokeInvitation then a second revoke → revoked; unknown id → not_found` | errors | silent success |
| `revokeUser closes every open connection of that user with 4403 immediately, without them sending a message` | immediate removal | waiting for next message |
| `revokeUser of the last active admin → last_admin and no connection closed` | last-admin protection | revoking anyway |
| `setRole admin→editor on the last admin → last_admin; with two admins it succeeds and the demoted user's next admin message is forbidden` | role change | ignoring protection |
| `transferAdmin makes target admin and actor editor; actor's next listAccess → forbidden; transfer to self → invalid_login` | transfer | both admins after transfer |
| `an admin revoking themselves (not last) gets accessUpdated, then their connections close with 4403` | self-revoke ordering | closing before reply |
| `extra keys, empty strings, bad role value → bad_request` | strict shape | permissive parse |

## Edge cases (each needs a test)
- Last active admin: revoke, demote, and self-revoke.
- A user with two open connections, both closed on revoke.
- An Editor connection open during an admin change receives no `access` frame.
- An unknown user id or invitation id.

## Human checks
- After T-046 exists and T-063 is set up: invite a counselor's tailnet login, confirm they can sign in as an Editor, revoke them, and confirm their open browser is disconnected immediately.

## Out of scope
- Settings UI and the web sync client methods (T-046).
- Changing the rules in `apps/server/src/access/`, or how logins are normalized.
- Display-name editing, audit logs, and retention of revoked users (SPEC §9 OPEN).
