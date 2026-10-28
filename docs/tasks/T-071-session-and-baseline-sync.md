# T-071: Session, baseline and shared-data sync for the shell

**Milestone:** 4 — Desktop board
**Depends on:** T-024 (channel), T-025 (`proposalChanged`, `boards` pushes), T-026 (`ward`, `settings` pushes), T-029 (web sync layer). All `done`.
- This is a prerequisite for T-030. It shares no files with T-040, T-044 or T-045.

**Spec refs:**
- SPEC.md §10:
  - Shared domain changes propagate to every client without a refresh, scoped by whether the data is ward-wide or proposal-owned.
  - Local view state stays local.
  - Identity comes from the server, and the client never asserts it.
- SPEC.md §3: a proposal is compared against its saved baseline. The level views (T-032–T-034) take `baseline: Board | null`.
- SPEC.md §6 and §7: member profile edits are ward-wide.
- AGENTS.md § Security rules: every new message type is tested with a revoked session.

## Goal
The web client can:
- learn who is signed in (login, display name, role);
- fetch a proposal's baseline board;
- receive ward, proposal-meta, board-list and settings changes pushed by T-025 and T-026.

The new requests are **explicit client methods**, used through React hooks. Nothing new is sent automatically when the client connects or subscribes, so the T-029 frame sequences stay exactly as they are.

## Design decisions (binding)

### Server (`apps/server/src/ws/channel.ts`)
Two new read-only messages. Both require exactly their keys, plus a `requestId` (1–64 characters). Any signed-in Editor or Admin may send them, and the existing per-message access re-check applies.
- `{ type: "whoami", requestId }` → `{ type: "me", requestId, user: { login, displayName, role } }`. The values come from the user resolved for that message, not from the client.
- `{ type: "getBoard", requestId, boardId }` → `{ type: "board", requestId, board }`. Any board kind may be fetched (Current, baseline, proposal).
  - The subscription does not change.
  - An unknown id → `{ type: "rejected", requestId, code: "not_found", message }`.
  - Extra or missing keys → `rejected` with `bad_request`.

### Web sync (`apps/web/src/sync/`)
- `SyncState` gains:
  - `me: { login: string; displayName: string; role: 'editor' | 'admin' } | null`, initially `null`;
  - `settings: { showNeedsApproval: boolean } | null`, initially `null`.
- New `SyncClient` methods. Each returns a Promise that resolves `null` or `{ ok: false, code }` on timeout (the existing `REPLY_MS`), on offline, or on rejection. None of them sends anything while the client is offline.
  - `whoami(): Promise<Me | null>`: sends `whoami` and stores the result in `state.me`.
  - `fetchBoard(boardId): Promise<Board | null>`: sends `getBoard`. Results are cached by board id **only for boards of kind `baseline`**, which never change, so a second call for the same baseline sends nothing.
  - `loadSettings(): Promise<Settings | null>`: sends T-026's `getSettings` and stores `state.settings`.
- Passive handling. These apply only to incoming messages and never send anything:
  - `ward` → replace `state.ward`.
  - `proposalChanged` whose `boardId` is the subscribed board → update `state.proposal`'s `name`, `status` and `rationale`. Pushes for other boards are ignored.
  - `settings` → replace `state.settings`.
  - `boards` pushes are already applied by T-029. Confirm this with a test; do not change it.
- React hooks in `react.tsx`:
  - `useMe()` calls `whoami` once per live connection (again after a reconnect) and returns `state.me`.
  - `useBaseline()` returns the baseline `Board` for the subscribed proposal, or `null` for Current or while loading. It fetches through `fetchBoard(proposal.baselineBoardId)` whenever that id changes.
  - `useSettings()` calls `loadSettings` once per live connection and returns `state.settings`.
- `ProposalView` in `protocol.ts` is unchanged.

## Scope
May change:
- `apps/server/src/ws/channel.ts` (the two new messages only)
- `apps/web/src/sync/client.ts`, `apps/web/src/sync/react.tsx`, `apps/web/src/sync/protocol.ts` (additions only)
- `apps/server/test/ws/session.test.ts` (new), `apps/web/src/sync/session.test.ts` (new), `apps/web/src/sync/hooks.test.tsx` (new)

Must not change:
- Existing tests, including every frame-sequence assertion in `apps/web/src/sync/client.test.ts`.
- Anything else in `apps/server` or `apps/web`, and `packages/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Server messages (real server, ephemeral port, fixture identity) | `pnpm --filter @wardboard/server exec vitest run test/ws/session.test.ts` | every `session.test.ts` test in the table passes |
| 2 | Sync client (fake socket, injected timers) | `pnpm --filter web exec vitest run src/sync/session.test.ts` | every `sync/session.test.ts` test passes |
| 3 | Hooks (Testing Library, fake client) | `pnpm --filter web exec vitest run src/sync/hooks.test.tsx` | every `hooks.test.tsx` test passes |
| 4 | Existing tests unchanged and green | `git diff main --stat -- apps/web/src/sync/client.test.ts apps/web/src/sync/react.test.tsx apps/server/test && pnpm --filter @wardboard/server test && pnpm --filter web test` | the diff lists only the new `apps/server/test/ws/session.test.ts`; both test runs exit 0 |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| server `session.test.ts` › `whoami returns the resolved login, display name and role for an Editor and an Admin` | identity from the server | hard-coded role; returning connect-time role after demotion |
| server `session.test.ts` › `whoami after mid-connection demotion reports editor` | per-message resolution | caching the user at connect |
| server `session.test.ts` › `getBoard returns a baseline without changing the subscription; a later commit on the subscribed board still arrives` | read-only fetch | replacing the subscription |
| server `session.test.ts` › `getBoard unknown id → not_found; extra keys → bad_request` | errors | throwing / silence |
| server `session.test.ts` › `revoked user whoami and getBoard → forbidden, close 4403` | security rule | dispatch before re-check |
| web `session.test.ts` › `whoami stores me; offline → null and nothing sent` | client method | sending while offline |
| web `session.test.ts` › `fetchBoard caches baselines but not proposal boards` | cache scope | caching mutable boards; refetching baselines |
| web `session.test.ts` › `fetchBoard times out to null after REPLY_MS` | timeout | hanging promise |
| web `session.test.ts` › `ward push replaces ward; proposalChanged updates only the subscribed board's proposal; settings push stored` | passive handling | updating the wrong board |
| web `session.test.ts` › `connecting and subscribing still send exactly the T-029 frames` | no automatic sends | eager whoami/baseline fetch |
| web `hooks.test.tsx` › `useBaseline returns null on Current, fetches once for a proposal, refetches when baselineBoardId changes` | hook behavior | fetching every render |
| web `hooks.test.tsx` › `useMe and useSettings request once per live connection and again after reconnect` | reconnect | never refreshing; refetch loop |

## Edge cases (each needs a test)
- A rejection for `getBoard` resolves `null` and leaves state unchanged.
- `proposalChanged` arriving while unsubscribed is ignored.
- Revoked session for both new server messages; demotion seen by `whoami`.

## Human checks
none

## Out of scope
- Presence avatars (not in SPEC; needs its own server design).
- Any shell UI (T-030).
- Lifecycle or member-edit client methods. Those come with the UI tasks that use them (T-037, T-039, T-041).
