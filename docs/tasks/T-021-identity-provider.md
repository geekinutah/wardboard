# T-021: Identity provider interface and Tailscale provider

**Milestone:** 3 — Server and collaboration
**Depends on:** T-005 (done), T-002 (done), T-003 (done)
**Spec refs:** SPEC.md §9 (authenticated access behind Tailscale), §10 (identity comes from Tailscale via `tailscale serve` headers; WardBoard listens only on localhost; identity provider interface; fixture provider for tests; no other server code reads identity headers); AGENTS.md § Security rules (every route except health requires a signed-in session; tests prove unauthenticated requests are refused)

## Goal
Every HTTP request and WebSocket upgrade except `GET/HEAD /api/health` is refused with 401 unless a single pluggable `IdentityProvider` turns it into a verified identity. Production can only use the Tailscale-header provider. Tests and the e2e harness inject a fixture provider in code. The server refuses to start on a non-loopback host unless the operator explicitly opts in.

## Design decisions (binding for this task; Mike approved the two choices marked ✔ on 2026-10-26)
- **Module**: `apps/server/src/identity/` with `index.ts` exporting:
  - `type Identity = { readonly login: string; readonly displayName: string }`.
  - `type IdentityResult = { ok: true; identity: Identity } | { ok: false; reason: 'missing' | 'malformed' }`.
  - `interface IdentityProvider { identify(req: IncomingMessage): IdentityResult }`. It is synchronous and pure over the request's headers, and works the same for a normal request and an upgrade request (both are `IncomingMessage`).
  - `tailscaleIdentityProvider(): IdentityProvider`, `fixtureIdentityProvider(identity: Identity | null): IdentityProvider` (`null` means every request is refused with `missing`), and `authenticate(provider, req): IdentityResult`, the single entry point the server calls.
- **Tailscale provider rules** (header names are case-insensitive; read from `req.rawHeaders` so duplicates can be seen):
  - `Tailscale-User-Login` absent → `missing`. Present more than once, empty or whitespace-only after trimming, containing any whitespace, comma or control character (U+0000–U+001F, U+007F), or longer than 254 characters → `malformed`. Otherwise the login is the trimmed value, lowercased.
  - `Tailscale-User-Name` is optional. Decode RFC 2047 encoded-words (`=?utf-8?q?…?=` and `=?utf-8?b?…?=`, charset case-insensitive). Strip control characters, trim, and truncate to 200 characters. If the header is absent, appears more than once, is empty after this processing, or the encoded-word is malformed or not UTF-8, `displayName` falls back to the login. A bad display name never causes a refusal.
  - `Tailscale-User-Profile-Pic` and every other header are ignored.
- **No other server code reads identity headers.** Only files under `src/identity/` may contain the string `tailscale-user` (case-insensitive). Header values are never logged or echoed in responses.
- **Server wiring** (`src/server.ts`, `src/index.ts`):
  - ✔ `startServer(config, options?: { identityProvider?: IdentityProvider })`. Without the option it uses `tailscaleIdentityProvider()`. No environment variable or config field selects the fixture provider.
  - The health exemption matches only when the raw pathname (before any decoding, query removed) is exactly `/api/health`. Every other request, including unknown `/api/*` paths, static web files and the SPA fallback, is authenticated **before** routing. A refusal responds `401` with body `{"error":"unauthenticated"}`, `content-type: application/json` and `cache-control: no-store`, whatever the method, path or reason. Unauthenticated requests therefore never reveal whether a route exists (they get 401, never 404).
  - The server gets an `upgrade` listener. An unauthenticated upgrade gets `HTTP/1.1 401 Unauthorized` and the socket is closed. An authenticated upgrade gets `HTTP/1.1 404 Not Found` and the socket is closed, because there is no WebSocket endpoint until T-024. Keep the authenticate-then-route seam obvious so T-024 can plug in. Upgrades to `/api/health` are not exempt.
  - The authenticated identity is attached in a way later routes can read (for example passed to the route handler or kept in a `WeakMap<IncomingMessage, Identity>` exported from `src/identity/`). No route uses it yet.
- ✔ **Loopback guard**:
  - `Config` gains `trustIdentityHeadersOnNonLoopback: boolean`. `parseConfig` sets it from `WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK`: absent → `false`, `"1"` → `true`, any other value → `ConfigError`. The field is optional in the type so existing callers compile, and treated as `false` when omitted.
  - `startServer` throws an `Error` whose message names `WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK`, **before** listening, when `config.host` is not a loopback host and the flag is not `true`. Loopback hosts are `localhost`, any IPv4 address in `127.0.0.0/8`, and `::1` (also written `[::1]` or `0:0:0:0:0:0:0:1`). Everything else is non-loopback, including `0.0.0.0`, `::` and LAN addresses.
  - This guard lives in the server, not only in `parseConfig`, so a hand-built `Config` cannot bypass it.
- **Docker coordination with T-006, which is in progress on branch `t-006-docker-image`**:
  - If `docker/Dockerfile` exists on `origin/main` when you start or rebase, add `WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK=1` next to its `WARDBOARD_HOST=0.0.0.0`.
  - If `scripts/docker-smoke.sh` exists, make its `GET /` probe send `Tailscale-User-Login: smoke@example.test`, and add an assertion that `GET /` without that header returns 401.
  - If those files do not exist on `origin/main`, do not create them. Report under Notes so the controller hands the change to T-006 at merge.
- **Existing tests that now need an identity**: in `apps/server/test/http.test.ts`, tests that request non-health paths may pass `{ identityProvider: fixtureIdentityProvider(...) }` to `startServer`. Change nothing else in them: every existing assertion, path and expected status stays byte-identical. `apps/web/e2e/checkout-server.ts` passes a fixture provider with the fictional identity `{ login: 'e2e-editor@example.test', displayName: 'E2E Editor' }`.

## Scope
May change:
- `apps/server/src/identity/` (new)
- `apps/server/src/server.ts`, `apps/server/src/index.ts`, `apps/server/src/config.ts`
- `apps/server/test/identity/` (new), `apps/server/test/http.test.ts` (only the identity option described above), `apps/server/test/config.test.ts` (new tests only; no existing test changed)
- `apps/web/e2e/checkout-server.ts` (fixture provider injection only)
- `docker/Dockerfile`, `scripts/docker-smoke.sh`: only the edits described above, and only if they already exist on `origin/main`

Must not change:
- `apps/server/src/db/**`, `packages/**`, `apps/web/src/**`, other `apps/web/e2e/**` files, `scripts/verify.sh`, `docs/**`, anything else

New dependencies allowed: none. Raw HTTP and upgrade tests use `node:http` and `node:net`. Do not add `ws`.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Tailscale and fixture provider tests | `pnpm --filter @wardboard/server test -- identity/providers` | all tests in `test/identity/providers.test.ts` pass |
| 2 | HTTP and upgrade gate tests against a real server on an ephemeral port | `pnpm --filter @wardboard/server test -- identity/gate` | all tests in `test/identity/gate.test.ts` pass |
| 3 | Loopback guard and config tests | `pnpm --filter @wardboard/server test -- identity/loopback config` | all tests in `test/identity/loopback.test.ts` and `test/config.test.ts` pass |
| 4 | Header-isolation structural test | `pnpm --filter @wardboard/server test -- identity/isolation` | passes; adding `req.headers['tailscale-user-login']` to `src/server.ts` makes it fail |
| 5 | Existing server tests still pass with unchanged assertions | `pnpm --filter @wardboard/server test -- http` and `git diff origin/main -- apps/server/test/http.test.ts` | tests pass; the diff only adds the identity option or import, with no changed `expect`, path or status lines |
| 6 | No direct header reads outside the module | `grep -rniI 'tailscale-user' apps/server/src \| grep -v '^apps/server/src/identity/'` | no output (exit 1) |
| 7 | e2e still loads the shell through the gate | `pnpm --filter web run test:e2e` | all projects pass |
| 8 | Typecheck and lint | `pnpm -r typecheck && pnpm -r lint` | exit 0 |
| 9 | Quality gate | `./scripts/verify.sh` | exits 0 (`verify: all steps passed`) |

## Unit tests to write

`test/identity/providers.test.ts`: pure tests that build `IncomingMessage`-shaped objects with `rawHeaders` and `headers`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tailscale: valid login and name yield identity` | `alice@example.test` + `Alice Example` → `{ login: 'alice@example.test', displayName: 'Alice Example' }` | wrong header read |
| `tailscale: login is trimmed and lowercased` | ` Alice@Example.TEST ` → `alice@example.test` | case kept, so T-022 lookups miss |
| `tailscale: header name is case-insensitive` | `TAILSCALE-USER-LOGIN` raw header accepted | exact-case match |
| `tailscale: missing login is refused as missing` | no login header (name present) → `{ ok: false, reason: 'missing' }` | falls back to name or anonymous |
| `tailscale: empty or whitespace login is malformed` | `''` and `'   '` → `malformed` | empty accepted |
| `tailscale: duplicate login headers are malformed` | two `Tailscale-User-Login` raw headers → `malformed` | Node's `, ` join accepted as one login, or first value used |
| `tailscale: login with comma, inner space or control char is malformed` | `a@x.test, b@x.test`, `a b@x.test`, `a\u0007@x.test` → `malformed` | no character validation |
| `tailscale: login length boundary` | 254 chars accepted, 255 → `malformed` | off-by-one or no limit |
| `tailscale: RFC 2047 Q and B display names are decoded` | `=?utf-8?q?Ferris_B=C3=BCller?=` and the B-encoded equivalent → `Ferris Büller` | raw encoded-word shown |
| `tailscale: missing, duplicate, empty or malformed name falls back to login` | each case → `displayName === login`, `ok: true` | refusal on cosmetic header, or `undefined` name |
| `tailscale: display name control chars stripped and truncated to 200` | 250-char name with `\u0000` → 200 chars, no control chars | unbounded name |
| `tailscale: profile pic and unrelated headers ignored` | only `Tailscale-User-Profile-Pic` → `missing` | treats pic as identity |
| `fixture: returns configured identity` | `fixtureIdentityProvider(id)` → `{ ok: true, identity: id }` for any request | ignores argument |
| `fixture: null refuses as missing` | `fixtureIdentityProvider(null)` → `missing` | defaults to allow |

`test/identity/gate.test.ts`: a real server from `startServer` on `127.0.0.1` port 0 with a temp data dir and a temp `webDir` containing `index.html`. Raw requests through `node:http` and `node:net`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `health is reachable without identity` | default provider, no headers: `GET` and `HEAD /api/health` → 200 | gate placed before the health check |
| `web root, spa fallback and static files are refused without identity` | `GET /`, `/board/1`, `/index.html` → 401 `{"error":"unauthenticated"}` with `cache-control: no-store` | only `/api` gated |
| `unknown api route is 401 not 404 without identity` | `GET /api/nope`, `POST /api/nope` → 401 | routing before auth leaks route existence |
| `spoofed health paths are not exempt` | `/api/health/`, `/api/health/../x`, `/api/healthx`, `/api/%68ealth`, `//api/health`, `/api/health%2f..` → 401 | prefix or decoded match on the exemption |
| `health query string stays exempt` | `/api/health?x=1` → 200 | query not removed |
| `valid tailscale headers pass the gate` | default provider + `Tailscale-User-Login: alice@example.test` → `GET /` 200 HTML and `/api/nope` 404 | provider not wired |
| `malformed and duplicate login headers are refused` | duplicate login headers sent over a raw `node:net` socket, and a comma login → 401 | gate only checks presence |
| `refusal body never echoes header values` | malformed login `evil<script>@x.test` → body is exactly `{"error":"unauthenticated"}` | value echoed |
| `injected fixture provider replaces tailscale` | `fixtureIdentityProvider(id)` + no headers → `GET /` 200. `fixtureIdentityProvider(null)` + valid Tailscale headers → 401 | Tailscale headers still read when another provider is injected |
| `unauthenticated websocket upgrade is refused with 401` | raw socket `GET /ws` with `Connection: Upgrade`, `Upgrade: websocket` and valid WS key/version headers, no identity → status line `HTTP/1.1 401`, then the socket closes | upgrades bypass the gate, or the socket hangs |
| `upgrade to /api/health is not exempt` | same as above against `/api/health` → 401 | health exemption applied to upgrades |
| `authenticated upgrade gets 404 until a ws endpoint exists` | fixture identity + upgrade → `HTTP/1.1 404`, socket closes | upgrade accepted or hangs |

`test/identity/loopback.test.ts`

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `loopback hosts start without the opt-in` | `127.0.0.1`, `127.1.2.3`, `localhost`, `::1` each start, where the platform can bind them; skipping is allowed only for `::1` on a host without IPv6 loopback, detected at runtime and stated in the test name or output | loopback list too narrow |
| `non-loopback host is refused before listening` | `0.0.0.0` without the flag → rejects with a message containing `WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK`, and nothing is listening (the chosen port is free afterwards) | guard missing, or checked after listen |
| `non-loopback host starts with the opt-in` | `0.0.0.0` + `trustIdentityHeadersOnNonLoopback: true` → starts (port 0) | flag ignored |
| `isLoopbackHost classification` | `127.0.0.1`, `127.255.255.254`, `localhost`, `::1`, `[::1]`, `0:0:0:0:0:0:0:1` → true. `0.0.0.0`, `::`, `128.0.0.1`, `192.168.1.5`, `127.0.0.1.example.test`, `localhost.example.test` → false | prefix string match such as `startsWith('127')` |

`test/config.test.ts` (new tests only)

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `trust flag defaults to false` | absent → `false` | defaults to true |
| `trust flag accepts only "1"` | `"1"` → `true`. `"true"`, `"0"`, `""`, `"yes"` → `ConfigError` naming the variable | truthy parsing that lets `"0"` enable trust |

`test/identity/isolation.test.ts`

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `only src/identity reads tailscale identity headers` | reads every `.ts` file under `apps/server/src` recursively, at runtime, from the test's own location. Fails listing any file outside `src/identity/` containing `/tailscale-user/i`. Also asserts at least one file inside `src/identity/` does contain it, so the scan can't pass vacuously | a route reading `req.headers['tailscale-user-login']` directly |

## Edge cases (each needs a test)
- Missing, empty, whitespace-only, duplicate, over-long and invalid-character logins.
- 254/255 login length boundary and 200-char display-name truncation.
- Malformed RFC 2047 display name falls back to the login.
- Health exemption: exact path only, query string allowed, encoded and traversal variants refused, and upgrades not exempt.
- Unauthenticated requests to unknown routes get 401, not 404.
- Fixture provider `null` (refuse everything).
- Loopback classification lookalikes (`127.0.0.1.example.test`, `128.0.0.1`, `::`).
- Invalid trust-flag values.

## Human checks
- After T-063 (Tailscale runbook) is deployed on the Mac Studio: open WardBoard over `tailscale serve` from a signed-in tailnet device and confirm the shell loads. Then open `http://127.0.0.1:8080/` directly on the Mac Studio, with no Tailscale headers, and confirm it shows `{"error":"unauthenticated"}`. Not runnable until T-006 and T-063 are done.

## Out of scope
- The user list, roles, invitations and the Editor/Admin decision (T-022). Any verified identity passes the T-021 gate. T-022 adds "no access" refusals.
- The WebSocket channel itself (T-024), and any `ws` dependency.
- A web sign-in UI or a "not signed in" page. The web client is not changed.
- Running Tailscale in the container, `tailscale serve` configuration, and the deployment runbook (T-063).
- Fixing backlog item B-004 (base-URL trailing slashes) in `config.ts`.
