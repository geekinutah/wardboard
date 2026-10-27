# T-022: Authorization: users, roles and invitations

**Milestone:** 3 — Server and collaboration
**Depends on:** T-021 (done). Can run alongside T-023 and T-018.
**Spec refs:**
- SPEC.md §2: access is invitation-only. Every invited user is an Editor. Mike is the initial admin. Multiple admins are allowed, and the admin seat can be transferred. PROPOSED: prevent removing the last admin.
- SPEC.md §10: the authorization layer maps a verified login to Editor, Admin, or no access, and does not depend on how identity was established.
- AGENTS.md § Security rules: every route except health refuses unauthenticated or revoked sessions, and admin-only actions refuse Editors.

## Goal
After T-021's identity gate, a second gate decides access. A verified login that is not an active user, and has no pending invitation, gets `403` on every HTTP route and WebSocket upgrade except health. An `apps/server/src/access/` service manages users and invitations, including last-admin protection. On startup an operator-configured login is made the first admin. The server now opens and migrates its SQLite database.

## Design decisions (binding)

### Bootstrap (Mike: confirm or change, see the controller report)
- New optional env var `WARDBOARD_INITIAL_ADMIN_LOGIN`, which sets `Config.initialAdminLogin?: string`. It is validated and normalized with the same rules as a Tailscale login (trim, lowercase, no whitespace, comma or control characters, at most 254 characters). Invalid values throw `ConfigError` naming the variable.
- At startup, `startServer` calls `access.bootstrapAdmin(login)` when the value is set:
  - If an **active admin already exists**, it does nothing and returns `'exists'`.
  - Otherwise a user with that login is created as admin, or promoted and reactivated if it already exists, and it returns `'created'`.
- With no active admin and no env var, the server still starts but every non-health request gets 403. `main.ts` logs the hint `no admin: set WARDBOARD_INITIAL_ADMIN_LOGIN`; nothing else is logged.

### Database ownership
- `startServer` opens `path.join(config.dataDir, 'wardboard.sqlite')` with `openDatabase`, runs `migrate`, and closes it in `close()`.
- `apps/server/src/db/index.ts` exports `databasePath(dataDir: string): string`, which T-068 uses for seeding.
- `StartServerOptions` gains `clock?: () => Date` (default `() => new Date()`) and `ids?: () => string` (default `crypto.randomUUID`).

### Access API: `apps/server/src/access/index.ts`
```ts
export type Role = 'editor' | 'admin';
export type User = { id: string; login: string; displayName: string; role: Role; createdAt: string; revokedAt: string | null };
export type Invitation = { id: string; login: string; invitedBy: string | null; createdAt: string };
export type AccessErrorCode = 'forbidden' | 'not_found' | 'invalid_login' | 'already_user' | 'already_invited' | 'last_admin' | 'revoked';
export type AccessResult<T> = { ok: true; value: T } | { ok: false; code: AccessErrorCode };

export function createAccess(db: DatabaseSync, clock: () => Date, ids: () => string): Access;
export interface Access {
  resolve(identity: Identity): { ok: true; user: User } | { ok: false };
  bootstrapAdmin(login: string): 'created' | 'exists';
  listUsers(): readonly User[];                 // ordered by login
  listInvitations(): readonly Invitation[];     // pending only, ordered by login
  invite(actorId: string, login: string): AccessResult<Invitation>;
  revokeInvitation(actorId: string, invitationId: string): AccessResult<void>;
  revokeUser(actorId: string, userId: string): AccessResult<void>;
  setRole(actorId: string, userId: string, role: Role): AccessResult<User>;
  transferAdmin(actorId: string, toUserId: string): AccessResult<void>;
}
export function getAuthenticatedUser(req: IncomingMessage): User | undefined;   // set by the server gate
```

### Rules
- **`resolve`** checks these cases in order:
  1. Active user with this login (`revoked_at IS NULL`) → ok. If the identity's `displayName` differs, update `display_name`.
  2. A pending invitation for the login → in one transaction: if a revoked user with that login exists, reactivate it (clear `revoked_at`, set role `editor`); otherwise create an `editor` user. Then delete the invitation and return ok.
  3. Anything else, including a revoked user with no invitation → `{ ok: false }`.
- **Every mutation** requires the actor to be an active admin. A missing, revoked or editor actor gets `forbidden`, checked first. Each mutation is one transaction.
- **`invite`**:
  - Login normalized and validated as above; otherwise `invalid_login`.
  - Active user with that login → `already_user`.
  - Pending invitation for that login → `already_invited`.
  - A revoked user may be re-invited.
- **`revokeUser`**: unknown user → `not_found`; already revoked → `revoked`; the last active admin → `last_admin`. Revoking yourself is allowed when you are not the last admin.
- **`setRole`**: unknown user → `not_found`; revoked user → `revoked`; demoting the last active admin → `last_admin`.
- **`transferAdmin`**:
  - Target must be an active user (`not_found` or `revoked` otherwise), and the target must not be the actor (`invalid_login`).
  - In one transaction the target becomes admin and the actor becomes editor.
- `id` and `created_at` come from the injected `ids` and `clock`.

### Server gate (`server.ts`)
- After `authenticate` succeeds, call `access.resolve(identity)`. On `{ ok: false }` respond `403` with body `{"error":"forbidden"}`, `content-type: application/json` and `cache-control: no-store`, for every method and path, before routing.
- On an upgrade, a refusal gets `HTTP/1.1 403 Forbidden` and the socket is closed. An allowed upgrade keeps today's behavior (404, socket closed).
- The resolved user is stored for `getAuthenticatedUser(req)`.
- Health stays exempt from both gates. Refusals never echo the login.

### Updates to existing callers (byte-identical assertions)
- `apps/server/test/http.test.ts` and `apps/server/test/identity/gate.test.ts`: the only allowed change is setting `initialAdminLogin` in the configs they build, equal to the fixture identity's login, so authenticated requests keep their current expected statuses. No `expect`, path or status line changes.
- `apps/web/e2e/checkout-server.ts`: add `initialAdminLogin: 'e2e-editor@example.test'` to the config.
- `scripts/docker-smoke.sh`:
  - Add `-e WARDBOARD_INITIAL_ADMIN_LOGIN=smoke@example.test` to `docker run`.
  - Add an assertion that `GET /` with `Tailscale-User-Login: stranger@example.test` returns `403`.
  - The volume is fresh per smoke run; if it is not, report it rather than working around it.

## Scope
May change:
- `apps/server/src/access/**` (new)
- `apps/server/src/server.ts`, `apps/server/src/config.ts`, `apps/server/src/main.ts`, `apps/server/src/index.ts` (exports)
- `apps/server/src/db/index.ts` (`databasePath` only)
- `apps/server/test/access/**` (new); `apps/server/test/config.test.ts` (new tests only)
- `apps/server/test/http.test.ts` and `apps/server/test/identity/gate.test.ts`: only the config addition above
- `apps/web/e2e/checkout-server.ts` (config addition only)
- `scripts/docker-smoke.sh` (only the two edits above)

Must not change:
- `apps/server/src/db/migrations/**`, `apps/server/src/identity/**`, `apps/server/src/store/**`, `packages/**`, `apps/web/src/**`, `docker/**`, `scripts/verify.sh`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Access service | `pnpm --filter @wardboard/server exec vitest run test/access/access.test.ts` | all pass |
| 2 | HTTP and upgrade access gate on a real server | `pnpm --filter @wardboard/server exec vitest run test/access/gate.test.ts` | all pass |
| 3 | Config | `pnpm --filter @wardboard/server exec vitest run test/config.test.ts` | all pass |
| 4 | Existing tests: only config additions | `git diff origin/main -- apps/server/test/http.test.ts apps/server/test/identity/gate.test.ts \| grep -E '^[-+][^-+]' \| grep -v initialAdminLogin` | no output |
| 5 | All server tests | `pnpm --filter @wardboard/server test` | all pass |
| 6 | e2e | `pnpm --filter web run test:e2e` | all projects pass |
| 7 | Typecheck and lint | `pnpm -r typecheck && pnpm -r lint` | exit 0 |
| 8 | Quality gate (includes the Docker smoke) | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`test/access/access.test.ts`: real SQLite file in `mkdtemp`, migrated, with a fixed clock and sequential ids.
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `unknown login has no access` | `resolve` → `{ ok: false }` | default allow |
| `bootstrap creates the first admin once` | first → `created`, user admin; a second bootstrap with a different login → `exists`, and no second admin | bootstrap promotes every restart value |
| `bootstrap reactivates and promotes an existing revoked user when no admin exists` | — | duplicate user row |
| `invitation is accepted on first resolve` | invite → resolve → editor user exists, invitation gone, display name from identity | invitation never consumed, or role admin |
| `revoked user is refused until re-invited` | revoke → resolve false; re-invite → resolve ok, role `editor` | revocation ignored, or reactivated as admin |
| `display name follows identity` | resolve with a new display name updates it | stale name |
| `editor cannot perform any admin mutation` | each of `invite`, `revokeInvitation`, `revokeUser`, `setRole`, `transferAdmin` by an editor → `forbidden`, with no table changes | missing role check on any one |
| `revoked admin cannot act` | → `forbidden` | checks role but not revocation |
| `invite validates and deduplicates` | `' Bob@X.test '` stored as `bob@x.test`; `'a b@x'` → `invalid_login`; repeat → `already_invited`; active user → `already_user` | no normalization |
| `last admin cannot be revoked or demoted` | sole admin → `last_admin` both ways; with two admins, demoting one succeeds | count includes revoked admins |
| `transfer admin swaps roles atomically` | actor editor, target admin | target promoted without actor demoted |
| `transfer to a revoked or unknown user is refused and nothing changes` | — | partial transfer |

`test/access/gate.test.ts`: real server from `startServer`, temp data dir, fixture identity provider.
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `identity without access gets 403 on every non-health path` | `GET /`, `GET /api/nope`, `POST /x` → 403 `{"error":"forbidden"}` with no-store | gate only on `/api` |
| `health needs neither identity nor access` | 200 | gate before health |
| `initial admin gets through` | `initialAdminLogin` = the identity's login → `GET /` 200 | bootstrap not called |
| `invited login gets through and becomes an editor` | invite via the service on the same database → 200; `listUsers` shows editor | — |
| `revoked user is refused on the next request` | 200, then revoke, then 403 | access cached per process |
| `upgrade without access gets 403; with access gets 404` | raw socket | upgrade bypasses access |
| `unauthenticated still gets 401, not 403` | no identity → 401 | access gate before identity gate |
| `database persists across restart` | invite, restart on the same data dir → invited login still gets in | in-memory DB |

`test/config.test.ts` (new tests only)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `initial admin login is optional and normalized` | absent → undefined; `' Mike@X.test '` → `mike@x.test` | not lowercased |
| `invalid initial admin login is a ConfigError` | `'a b'`, `'a,b'`, `''` → `ConfigError` naming `WARDBOARD_INITIAL_ADMIN_LOGIN` | silently accepted |

## Edge cases (each needs a test)
All are listed above: empty user table, last admin, revoked actor, re-invitation, duplicate invitation, self-revocation by a non-last admin (add a test for this), and a restart with the same data dir.

## Human checks
- After T-063 on the Mac Studio: with `WARDBOARD_INITIAL_ADMIN_LOGIN` set to Mike's tailnet login, Mike can open the app through `tailscale serve`, and a second tailnet login gets "forbidden".

## Out of scope
- HTTP or WebSocket endpoints for managing users. The settings UI (T-046) and its transport come later.
- Any UI, migrations, or WebSocket handling (T-024).
- Changing how identity is established.
