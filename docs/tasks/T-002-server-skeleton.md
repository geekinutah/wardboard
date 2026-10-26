# T-002: Server skeleton

**Milestone:** 1 — Foundations
**Depends on:** T-001
**Spec refs:** SPEC.md §10 (portable server, configurable storage/base URL/access, localhost-only listening, health check is the only unauthenticated route), §9 (no sensitive data in logs); AGENTS.md (Security rules, Test stack: real server on an ephemeral port)

## Goal
`apps/server` is a Node 26 TypeScript package (`@wardboard/server`) that reads its configuration from environment variables, answers `GET /api/health`, optionally serves a built web client from a configured directory, listens on `127.0.0.1` by default, and can be started in-process on an ephemeral port for tests and the GUI pipeline.

## Design decisions (binding for this task)
- Runs TypeScript source directly with Node 26 type stripping (the T-001 pattern): `node src/main.ts`. No build step. Package is ESM and exports `./src/index.ts`.
- HTTP uses `node:http` only. No HTTP framework and no runtime dependencies in this task.
- `parseConfig(env: Record<string, string | undefined>): Config` is a pure function. It throws a `ConfigError` whose message lists **every** problem (not just the first). Variables:
  - `WARDBOARD_DATA_DIR`: required, must be an absolute path. No default (no machine-specific paths).
  - `WARDBOARD_BASE_URL`: required, must parse as an absolute `http:` or `https:` URL; stored without a trailing slash.
  - `WARDBOARD_PORT`: optional, default `8080`, integer 0–65535 (`0` means ephemeral). Rejects `''`, `'80a'`, `'-1'`, `'65536'`, `'1.5'`.
  - `WARDBOARD_HOST`: optional, default `127.0.0.1`. (The container sets `0.0.0.0` and publishes only to the host's loopback; see T-006.)
  - `WARDBOARD_WEB_DIR`: optional absolute path to a built web client.
- `startServer(config): Promise<{ url: string; port: number; close(): Promise<void> }>` creates the data dir if missing (recursive), listens on `config.host:config.port`, and resolves with the actual bound port. `close()` stops accepting connections and resolves once closed.
- Routes:
  - `GET /api/health` → `200`, `content-type: application/json`, body `{"status":"ok"}`. `HEAD` also returns 200. Other methods on that path → `405` with an `allow: GET, HEAD` header.
  - Any other `/api/*` path → `404` JSON `{"error":"not_found"}`.
  - When `webDir` is set, non-`/api` `GET` requests serve files from it with correct `content-type` for `.html`, `.js`, `.css`, `.svg`, `.png`, `.woff2`, `.json`; a path that does not match a file falls back to `index.html` (SPA routing). Any request whose decoded, normalized path escapes `webDir` (`..`, encoded `%2e%2e`, backslashes, absolute paths) → `404`, never the file. When `webDir` is unset, non-`/api` paths → `404`.
  - Every response sets `x-content-type-options: nosniff`.
- `src/main.ts`: parses config from `process.env`, prints a clear error and exits 1 on `ConfigError`, otherwise starts the server, logs one line with the bound URL (never env values other than host/port), and closes cleanly on `SIGTERM`/`SIGINT`.
- Logging never includes request bodies or query strings.
- Health is the only route that will remain unauthenticated; leave a comment at the routing seam noting that T-021 adds the identity middleware in front of everything else. Do not implement auth here.

## Scope
May change:
- `apps/server/` (new: `package.json`, `tsconfig.json`, `src/**`, `test/**`, `vitest.config.ts` if needed)
- `pnpm-workspace.yaml` (only if `apps/*` is not already included)
- `pnpm-lock.yaml`

Must not change:
- `packages/**`, `scripts/**`, root configs other than the above, `docs/**`, `SPEC.md`, `AGENTS.md`, anything else

New dependencies allowed: devDependencies already used at the root by T-001 (`typescript`, `vitest`, `@types/node`) added to `apps/server` as needed. No runtime dependencies.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Config tests | `pnpm --filter server test -- config` | all tests in `test/config.test.ts` pass |
| 2 | HTTP tests | `pnpm --filter server test -- http` | all tests in `test/http.test.ts` pass |
| 3 | Typecheck and lint | `pnpm --filter server typecheck && pnpm --filter server lint` | both exit 0 |
| 4 | Starts from the command line | `WARDBOARD_DATA_DIR=$(mktemp -d) WARDBOARD_BASE_URL=http://localhost:8080 WARDBOARD_PORT=0 node apps/server/src/main.ts` then `curl -s` the printed URL + `/api/health`; then send SIGTERM | prints a URL with `127.0.0.1`; curl prints `{"status":"ok"}`; process exits 0 after SIGTERM |
| 5 | Bad config fails clearly | `env -u WARDBOARD_DATA_DIR WARDBOARD_PORT=abc node apps/server/src/main.ts` | exits 1; stderr names `WARDBOARD_DATA_DIR`, `WARDBOARD_BASE_URL`, and `WARDBOARD_PORT` |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `parseConfig applies defaults` | only required vars set → port 8080, host 127.0.0.1, webDir undefined | default host 0.0.0.0 |
| `parseConfig reports every problem at once` | no vars and `WARDBOARD_PORT=abc` → one `ConfigError` mentioning all three variables | throws on first problem |
| `parseConfig rejects a relative data dir` | `WARDBOARD_DATA_DIR=data` → error | accepts relative paths |
| `parseConfig rejects non-http base URLs` | `ftp://x`, `localhost:8080`, `''` → error each | only checks non-empty |
| `parseConfig strips a trailing slash from base URL` | `http://h/` → `http://h` | slash kept |
| `parseConfig validates port bounds and format` | `0` and `65535` accepted; `-1`, `65536`, `80a`, `1.5`, `''` rejected | `parseInt` laxness |
| `startServer binds an ephemeral port on loopback` | port 0 → returned port > 0, url host `127.0.0.1`, health reachable | ignores host/port |
| `startServer creates a missing data dir` | nested non-existent dir exists after start | dir not created |
| `health returns ok JSON` | 200, JSON content type, `{"status":"ok"}`, nosniff header | wrong body or header |
| `health HEAD returns 200 and other methods 405` | HEAD 200; POST 405 with `allow` header | 404 or 200 for POST |
| `unknown api path is a JSON 404` | `/api/nope` → 404 `{"error":"not_found"}` | falls through to SPA index |
| `serves web files with content types` | temp webDir with `index.html`, `assets/app.js` → correct bodies and types | wrong type |
| `spa fallback serves index.html` | `/board/123` → index.html | 404 |
| `path traversal never escapes webDir` | `/../secret.txt`, `/%2e%2e/secret.txt`, `/..%2fsecret.txt`, `/assets/..\..\secret.txt` with a sibling `secret.txt` → never returns its content | naive `path.join` |
| `no webDir means non-api 404` | `/` → 404 | serves cwd |
| `close stops the server` | after `close()`, fetch to the URL rejects | close is a no-op |

All HTTP tests use a real server started with `startServer` on port 0 and real `fetch`. No mocks of `node:http`.

## Edge cases (each needs a test)
- All required variables missing at once.
- Port boundaries 0 and 65535; malformed ports.
- Encoded and backslash traversal attempts.
- Data dir that does not exist yet.

## Human checks
none

## Out of scope
- Authentication/identity (T-021), SQLite (T-005), WebSocket (T-024), Docker (T-006).
- Building the web client (T-003); this task only serves an already-built directory.
