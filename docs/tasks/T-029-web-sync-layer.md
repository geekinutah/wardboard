# T-029: Web sync layer

**Milestone:** 3 — Server and collaboration
**Depends on:** T-024 (done), T-003 (done). Can run alongside T-031 and T-068 (no shared files).
**Spec refs:**
- SPEC.md §10:
  - The server is authoritative, and every edit is one operation.
  - Phone edits appear on the TV and other clients in real time.
  - Stale operations are rejected visibly ("the client shows what happened rather than silently dropping the edit").
  - Disconnected clients show their stale/offline state and resynchronize on reconnection. Offline editing is not assumed.
  - Active tab, pan, zoom and selection stay local, and a synchronized edit must not reset local camera state.
- T-024 contract and `apps/server/src/ws/channel.ts`: the message protocol.

## Goal
`apps/web/src/sync/` holds a framework-agnostic `SyncClient` and a thin React binding. The client:
- Connects to `/api/ws`.
- Lists boards and subscribes to one board.
- Sends operations against the board's current version.
- Applies only server-committed boards, never optimistic edits.
- Reports rejections in words.
- Detects a dead connection, reconnects with backoff, and resyncs with a fresh snapshot.

The app shell gets a provider, a visible connection indicator, and a banner. The board UI itself comes in later tasks.

## Design decisions (binding)

### `SyncClient` (`apps/web/src/sync/client.ts`, no React imports)
```ts
export type ConnectionStatus = 'connecting' | 'live' | 'offline' | 'forbidden';
export type SyncState = {
  status: ConnectionStatus;
  boards: { current: CurrentInfo | null; proposals: readonly ProposalSummary[] } | null;
  subscribedBoardId: string | null;
  board: Board | null;          // last committed/snapshot board for subscribedBoardId
  ward: Ward | null;
  proposal: ProposalView | null;
  notice: SyncNotice | null;    // latest user-facing notice; cleared by dismissNotice()
};
export type SyncNotice =
  | { kind: 'rejected'; requestId: string; code: string; message: string }
  | { kind: 'stale'; requestId: string }               // board was refreshed
  | { kind: 'resynced' };                              // after reconnect or a version gap
export type OpOutcome = { ok: true; version: number } | { ok: false; code: string; message: string };

export type SyncDeps = {
  url: string;                                          // ws(s)://<host>/api/ws
  createSocket: (url: string) => WebSocketLike;         // browser: (u) => new WebSocket(u)
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
  requestIds: () => string;                             // browser: crypto.randomUUID
};
export class SyncClient {
  constructor(deps: SyncDeps);
  start(): void; stop(): void;
  getState(): SyncState; subscribe(listener: (s: SyncState) => void): () => void;
  open(boardId: string): void;                          // sends subscribe; replaces the subscription
  send(kind: OpKind, request: object): Promise<OpOutcome>;
  dismissNotice(): void;
}
```
- `WebSocketLike` is the minimal browser `WebSocket` surface used (`readyState`, `send`, `close`, `onopen/onmessage/onclose/onerror`).
- `OpKind` is imported as a type from `@wardboard/server`. Message payload types (`CurrentInfo`, `ProposalSummary`, `ProposalView`) are imported as types where the server exports them; otherwise they are declared in `sync/protocol.ts` to match `apps/server/src/ws/channel.ts` exactly. `Board`, `Ward` and the rest come from `@wardboard/core`. Type-only imports from the server are allowed. A runtime import of server code into the web bundle is forbidden, and is checked by acceptance #5.
- Each state change produces a new `SyncState` object, and listeners are called synchronously.

### Behavior
- **Start**:
  1. Status `connecting`.
  2. On open: status `live`. Send `listBoards`, and re-send `subscribe` for the last `open()`ed board, if any.
- **Snapshot**: replaces `board`, `ward`, `proposal` and the version for that board. A snapshot for a board other than the current subscription is ignored.
- **Committed**: ignored unless `boardId === subscribedBoardId`.
  - `version === local + 1` → apply.
  - `version <= local` → ignore.
  - `version > local + 1` (a gap) → re-send `subscribe`, and set notice `resynced` when the new snapshot arrives.
  - If `requestId` matches a pending op of this client, resolve it `{ ok: true, version }`.
- **Rejected** (matched by `requestId`): resolve the pending op `{ ok: false, code, message }`.
  - `stale`: also re-send `subscribe` and set notice `{ kind: 'stale' }`.
  - Any other code: set notice `{ kind: 'rejected', … }`.
  - Never retry automatically.
- **`send`** while not `live` or with no board → resolves `{ ok: false, code: 'offline' }` immediately. Nothing is queued: offline editing is not assumed.
- **Close or error**:
  - Every pending op resolves `{ ok: false, code: 'offline' }`.
  - Close code `4403`, or an `error forbidden` message → status `forbidden`, with no reconnect.
  - Otherwise status `offline`, then reconnect after 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s for every later attempt, resetting after a successful open. Board, ward and boards stay visible (stale) while offline. After reconnecting, the fresh snapshot replaces them and notice `resynced` is set.
- **Dead-connection detection**: the server sends no pings (T-024 note).
  - While `live`, send `listBoards` 25 s after the last received message.
  - If nothing arrives within 10 s after that, close the socket and follow the offline path.
  - Every received message resets the 25 s timer.
- **`stop()`** closes the socket and clears every timer. No reconnect after stop.

### React binding (`apps/web/src/sync/react.tsx`)
- `SyncProvider` takes `{ client?: SyncClient }`. The default builds a browser client for `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`, calls `start()` on mount and `stop()` on unmount.
- `useSync(): SyncState & { open, send, dismissNotice }`, built on `useSyncExternalStore`.
- `ConnectionIndicator`:
  - Text `Live`, `Connecting…`, `Offline — reconnecting` or `No access`, in an element with `role="status"`.
  - A dot whose color is never the only signal.
- `SyncBanner` (`role="alert"`, with a Dismiss button of at least 44 px) renders the notice:
  - `stale` → "Someone else changed this board first. Your change was not applied; the board has been refreshed."
  - `rejected` → "Your change was not applied: <message>"
  - `resynced` → "Reconnected. The board has been refreshed."
  - While status is `offline`, a non-dismissible line also shows: "Offline. Changes can't be saved until the connection returns."

### App wiring (`apps/web/src/App.tsx`)
- Wrap the shell (not the `/__gallery` route) in `SyncProvider`.
- Render `ConnectionIndicator` in the header and `SyncBanner` above `main`'s content.
- Keep the existing "Server: ok" health status unchanged, because existing tests assert it.
- No board rendering yet.

## Scope
May change:
- `apps/web/src/sync/**` (new), `apps/web/src/App.tsx`, `apps/web/src/app.css`
- `apps/web/src/App.test.tsx`: new tests only
- `apps/web/package.json` and `pnpm-lock.yaml`: add `@wardboard/core: "workspace:*"` as a dependency. `@wardboard/server` is already a devDependency, used for types and the integration test.
- `apps/web/e2e/sync.spec.ts`, `apps/web/e2e/gui/sync.capture.ts` (new)
- `apps/web/vite.config.ts`, only if needed so `*.node.test.ts` files run in the `node` environment

Must not change:
- `apps/server/**`, `packages/**`, `apps/web/src/design/**`, existing e2e specs, `apps/web/e2e/checkout-server.ts` (T-068 owns it), and anything else

New dependencies allowed: `@wardboard/core` (workspace) in `apps/web`.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Client unit tests | `pnpm --filter @wardboard/web exec vitest run src/sync/client.test.ts` | all pass |
| 2 | Integration against a real server | `pnpm --filter @wardboard/web exec vitest run src/sync/client.node.test.ts` | all pass |
| 3 | React binding and app wiring | `pnpm --filter @wardboard/web exec vitest run src/sync/react.test.tsx src/App.test.tsx` | all pass |
| 4 | e2e: app goes Live | `pnpm --filter web run test:e2e` | all projects pass, including `sync.spec.ts` |
| 5 | No server runtime in the web bundle | `pnpm --filter @wardboard/web run build && ! grep -rlE "node:sqlite\|WebSocketServer" apps/web/dist` | exit 0 |
| 6 | GUI capture | `pnpm --filter web run gui:capture` | `gui-artifacts/sync/<project>.png` for every project, showing the Live indicator; inspected per `docs/gui-verification.md` |
| 7 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
`client.test.ts` uses a scripted fake `WebSocketLike` and fake timers passed via `SyncDeps`. This is allowed here: the client's contract is the protocol, and the real-server test below covers fidelity.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `start connects, goes live, lists boards` | status connecting → live; first frame `listBoards` | — |
| `open sends subscribe and snapshot fills state` | — | — |
| `send uses the current version as baseVersion and does not change the board` | the frame has `baseVersion` = snapshot version; state is unchanged until committed | optimistic apply |
| `committed next version applies and resolves the pending op` | — | — |
| `committed from another client applies` | no pending op needed | only own commits applied |
| `old or duplicate committed is ignored` | — | version regress |
| `version gap resubscribes and reports resynced` | — | silently applies a gapped board |
| `committed for another board is ignored` | — | cross-board bleed |
| `stale rejection resubscribes, notices stale, never retries` | exactly one `op` frame sent | auto-retry |
| `other rejection resolves and notices with the server message` | — | swallowed |
| `send while offline resolves offline and sends nothing` | — | queueing |
| `close resolves pending ops offline and keeps stale data` | board still present, status offline | data cleared |
| `reconnect backoff 1,2,4,8,16,30,30 and reset after open` | timer delays asserted exactly | fixed delay or unbounded |
| `reconnect resubscribes and notices resynced` | — | stale board after reconnect |
| `4403 and forbidden error stop reconnecting` | status forbidden; no timers scheduled | reconnect loop on revoked access |
| `silent connection is detected` | 25 s idle → `listBoards`; 10 s with no reply → close → offline | dead socket stays "live" |
| `stop clears timers and never reconnects` | — | leak |

`client.node.test.ts` runs in the `node` environment. It starts a real server via `startServer`, with a temp data dir seeded with `seedFixture` from `@wardboard/server/dev`, the fixture identity, and `initialAdminLogin`. It uses `ws`'s `WebSocket` as `createSocket`, passing the `Origin` header.
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `two clients on one proposal see each other's commit` | A sends `moveToDugout`; both A and B states show the new version and board | wrong message parsing |
| `stale op from a lagging client is reported and refreshed` | B's op at an old version → `stale` notice, then B's board equals A's | — |
| `server restart: client goes offline, reconnects and resyncs` | close the server, start a new one on the same port and data dir → status live again, notice `resynced` | no reconnect |

`react.test.tsx` and new `App.test.tsx` tests
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `indicator shows each status as text` | all four texts | color-only status |
| `banner shows stale, rejected and resynced messages and dismisses` | exact copy above; Dismiss clears | — |
| `offline line is shown while offline and not dismissible` | — | — |
| `a committed update does not reset local component state` | a child with local `useState` (a counter standing in for camera) keeps its value across a committed update | provider remounts its subtree |
| `app shell renders indicator and keeps Server: ok` | — | health line removed |
| `gallery route does not open a socket` | `/__gallery` → `createSocket` not called | — |

## Edge cases (each needs a test)
All are listed above: no Current or proposals (`boards.current` null renders without error; add this test), forbidden, offline send, a version gap, other-board messages, and duplicate commits.

## GUI verification
Required. This task changes `apps/web/src/**`. Capture scenario `sync` at every viewport: the shell with "Live". Check:
- The indicator text is readable.
- There is no overlap with the brand.
- There is no horizontal scroll on the phone.
- The Dismiss button is at least 44 px. Exercise the banner state with a unit-rendered screenshot only if the capture can't produce it, and say which.

## Human checks
- Open the app in two browser windows (after T-068: `pnpm dev`). Stop the dev server: both windows show "Offline — reconnecting". Restart it: both return to "Live" within about 30 s with the "Reconnected" banner.

## Out of scope
- Rendering boards.
- The board tabs UI (T-030).
- Presence.
- Proposal lifecycle messages (T-025).
- Optimistic updates.
- Offline queueing.
