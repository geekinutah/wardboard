# T-024: Operation channel

**Milestone:** 3 — Server and collaboration
**Depends on:** T-022 and T-023 (both must be `done`; this contract binds to their APIs as written in their contracts. If either changes on merge, the controller updates this contract before delegating).
**Spec refs:**
- SPEC.md §10: the server is authoritative. Each client holds a WebSocket. Every edit is one operation, validated and committed in one SQLite transaction, and the committed result is broadcast to every client viewing the affected board. Multi-part edits are a single operation. PROPOSED: boards are versioned, and a stale operation is rejected visibly. Different proposals stay independent.
- SPEC.md §3: Current is read-only, and an Accepted proposal is read-only.
- SPEC.md §6: an approval records the approver and the time.
- AGENTS.md § Security rules: every message type has a test proving an unauthenticated or revoked session is refused.

## Goal
`/api/ws` accepts authenticated, authorized WebSocket connections from the app's own origin. A client lists boards, subscribes to one board, and sends operations against a base version. The server checks the version, applies the matching pure `@wardboard/core` function, commits through `store.commitBoard`, and broadcasts the committed board to every subscriber of that board and no one else. Every refusal is an explicit message.

## Design decisions (binding)

### Endpoint and connection security
- Path: exactly `/api/ws`, matched on the raw pathname with the query removed. Other upgrade paths keep the existing behavior: 401 / 403 / 404 per T-021 and T-022.
- Upgrade checks, in this order, all before `handleUpgrade`:
  1. Identity (401).
  2. Access (403).
  3. **Origin**: the `Origin` header must equal `new URL(config.baseUrl).origin` or the server's own listen origin (`RunningServer.url`). Missing or other → `HTTP/1.1 403 Forbidden` and the socket is closed. This blocks cross-site WebSocket hijacking: Tailscale adds identity headers to any request from the user's device, including requests a malicious page makes.
- `ws` options: `maxPayload: 262144` (256 KiB). `perMessageDeflate` is off. The connection keeps the authenticated user id and login.
- **Access is re-checked on every incoming message.** The check calls `access.resolve` with the connection's identity. A refusal sends `{"type":"error","code":"forbidden"}` and closes with code `4403`. Revocation therefore takes effect on that user's next message.

### Messages (JSON text frames; anything else → `{"type":"error","code":"bad_message"}`, connection stays open)
Client → server:
- `{ "type": "listBoards" }` → `{ "type": "boards", "current": { "boardId", "version", "importVersion", "importedAt" } | null, "proposals": ProposalSummary[] }`.
- `{ "type": "subscribe", "boardId" }`:
  - Replaces the connection's subscription.
  - Reply: `{ "type": "snapshot", "boardId", "version", "board", "ward", "proposal": { "id", "name", "status", "rationale", "baselineBoardId" } | null }`.
  - Unknown board → `{ "type": "error", "code": "not_found", "boardId" }`.
  - Baselines may be subscribed (for diff display). They are read-only.
- `{ "type": "op", "requestId": string (1–64 chars), "boardId", "baseVersion": integer ≥ 0, "op": { "kind": <OpKind>, "request": object } }`.

Server → client, for an op:
- Rejection, sent to the sender only: `{ "type": "rejected", "requestId", "code", "message", "currentVersion"? }`. Codes:
  - `stale`: `baseVersion` ≠ stored version. Includes `currentVersion`.
  - `not_subscribed`: `boardId` ≠ the connection's subscription.
  - `not_found`.
  - `not_editable`: Current, a baseline, or an Accepted proposal.
  - `unknown_operation`.
  - `bad_request`: the request fails shape validation.
  - Any core operation error code, passed through unchanged (for example `already_in_list`).
- Commit, sent to every connection subscribed to `boardId`, including the sender: `{ "type": "committed", "boardId", "version", "board", "requestId", "by": login }`.

### Operation registry (`apps/server/src/ws/operations.ts`)
`OpKind` maps one-to-one to these existing core functions. Each kind's `request` is validated against an explicit shape before the core function is called: strings non-empty, ids strings, numbers integers. Unexpected keys → `bad_request`.
- `placeInPosition`, `addToList`
- `swap`, `releaseOccupant`
- `releaseCalling`, `moveToDugout`, `addToDugout`
- `addCallingGroup`, `renameGroup`, `setBoardGroupVisible`, `moveGroup`, `addAssignment`, `addListPosition`, `removePosition`, `removeAssignment`
- `approvePlacement`:
  - The client sends only `memberId` and `positionId`.
  - The server supplies `baseline` (the proposal's baseline, loaded from the store), `approvedBy` (the connection's user id) and `approvedAt` (clock ISO).
  - A client-supplied `approvedBy`, `approvedAt` or `baseline` → `bad_request`.
- `setCallingTags` and `setCallingPreferences`. These have a `(board, ward, …)` signature, so adapt them. Their result type is mapped to the same rejected/committed messages.

Oversight (T-018) and ward-wide edits (T-026) are not registered here.

`OperationContext.ids` comes from the server's injected `ids`. Each operation runs as `loadBoard` → version check → core function → `store.commitBoard(result, baseVersion)`, synchronously, with no `await` between the version check and the commit. That keeps operations serialized in the single Node process. Server-side ordering guarantee: `committed` versions on one board are broadcast in strictly increasing order with no gaps.

### Wiring
- `startServer` creates the store over the database T-022 opened and passes the `ws` server to the upgrade handler.
- On close: terminate all sockets, then close the HTTP server, then close the database.
- The server never logs message bodies.

## Scope
May change:
- `apps/server/src/ws/**` (new)
- `apps/server/src/server.ts`, `apps/server/src/index.ts` (exports)
- `apps/server/package.json` and `pnpm-lock.yaml` (`ws` dependency, `@types/ws` dev dependency)
- `apps/server/test/ws/**` (new)

Must not change:
- `apps/server/src/store/**`, `access/**`, `identity/**`, `db/**`, `packages/**`, `apps/web/**`, and all existing tests

New dependencies allowed: `ws` (latest 8.x) and `@types/ws`, pinned exactly like the other dependencies.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Connection security | `pnpm --filter @wardboard/server exec vitest run test/ws/connect.test.ts` | all pass |
| 2 | Protocol and operations | `pnpm --filter @wardboard/server exec vitest run test/ws/protocol.test.ts test/ws/operations.test.ts` | all pass |
| 3 | Broadcast scoping and versioning | `pnpm --filter @wardboard/server exec vitest run test/ws/broadcast.test.ts` | all pass |
| 4 | Registry covers exactly the listed kinds | `pnpm --filter @wardboard/server exec vitest run test/ws/registry.test.ts` | passes; removing any entry or adding an unlisted one fails it |
| 5 | Existing server tests unchanged and green | `pnpm --filter @wardboard/server test` and `git diff origin/main --stat -- apps/server/test ':!apps/server/test/ws'` | pass; diff empty |
| 6 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
All tests use a real server from `startServer` on port 0, with a temp data dir seeded through the store (the T-023 `seedFixture` from `@wardboard/server/dev` is fine in tests). Clients are real `ws` clients. Identity comes from the fixture provider, and the clock and ids are injected. Every wait is on a message or event, never a sleep.

`connect.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `unauthenticated upgrade to /api/ws is 401` | — | ws handled before the gate |
| `authenticated user without access is 403` | — | access skipped for ws |
| `missing or foreign Origin is 403` | no Origin, and `https://evil.example` → 403; baseUrl origin and listen origin → open | CSWSH |
| `revoked user is refused on the next message of every type` | for each of `listBoards`, `subscribe` and `op`: open, revoke via access, send → `error forbidden` and close `4403` | access checked only at upgrade |
| `oversize and non-JSON frames get bad_message` | 300 KiB frame → connection closed by `ws` (1009); `"nope"` → `bad_message`, still open | crash or silent drop |

`protocol.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `listBoards returns current and proposals` | matches the store | — |
| `subscribe returns a snapshot of board, ward and proposal meta` | version and board equal `store.loadBoard` | — |
| `subscribe to unknown board is not_found` | — | — |
| `op on an unsubscribed board is not_subscribed` | — | cross-board writes |
| `op shape validation` | missing `requestId`, `baseVersion: -1`, `baseVersion: 1.5`, unknown kind, extra key, non-string id → `bad_request` / `unknown_operation`; board unchanged | untrusted input reaching core |

`operations.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `move commits, bumps version and persists` | `placeInPosition` → `committed` version 1; a restart on the same data dir loads the same board | not persisted |
| `core error passes through as rejected` | duplicate list placement → `rejected` with the core code; version unchanged | swallowed or committed |
| `current and baselines are not_editable` | — | read-only bypass |
| `accepted proposal is not_editable` | proposal inserted as accepted | — |
| `swap is one committed operation` | one `committed` message, and both positions are changed in it | split into two ops |
| `approvePlacement takes approver and time from the server` | approval in `committed.board.approvals` has the connection's user id and the clock time; a client-supplied `approvedBy` → `bad_request` | trusting client approver |

`broadcast.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `commit reaches every subscriber of the board including the sender` | three clients on A all receive `committed` with the same version | sender excluded, or only the sender |
| `other boards' subscribers receive nothing` | a client on B gets no message. A final `listBoards` round-trip on that client proves the absence without a sleep | global broadcast |
| `concurrent ops at the same base version: exactly one commits` | two clients send at version 0 in the same tick → one `committed` v1, one `rejected stale currentVersion 1`; the board has no duplicate occupant | last-write-wins |
| `versions are strictly increasing without gaps` | 5 sequential ops → versions 1..5 in order on every subscriber | — |
| `resubscribe switches boards` | after subscribing to B, A's commits are not received | subscription accumulates |

`registry.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `registry kinds equal the contract list` | exact set equality with the list above | an op silently added or missing |

## Edge cases (each needs a test)
All are listed above: an empty store (`listBoards` → current null, no proposals), stale version, revoked mid-session, foreign origin, malformed frames, an accepted proposal, and concurrent ops.

## Human checks
none. The visible multi-client experience is checked in T-029 and the UI tasks.

## Out of scope
- Client sync code (T-029).
- Proposal create, rename, accept and reopen messages (T-025).
- Member and ward edits (T-026).
- Oversight operations (after T-018).
- Heartbeat/ping. T-029 owns offline detection. Note it if `ws` needs one for dead-socket cleanup.
- Presence.
