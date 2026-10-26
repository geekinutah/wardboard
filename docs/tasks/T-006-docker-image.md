# T-006: Docker image

**Milestone:** 1 — Foundations
**Depends on:** T-002, T-003
**Spec refs:** SPEC.md §10 (Docker, SQLite and photos on local persistent storage, portable — no Mac-only runtime dependencies, localhost/Tailscale-only access), §9

## Goal
A Docker image builds the web client and runs the server; data lives on a mounted volume; the container's health check passes; and a scripted smoke test proves it end to end. Docker is provided by OrbStack on Mike's Macs (any Docker engine works). The image is not part of `./scripts/verify.sh` (agents without Docker can still run the gate) but CI runs the smoke test on every push.

## Design decisions (binding for this task)
- **`docker/Dockerfile`**, multi-stage, base `node:26-slim` matching `.node-version`'s major (pin by minor at least, e.g. `node:26.12-slim`, and add a test that the Dockerfile's Node version agrees with `.node-version`'s major.minor). pnpm installed at exactly the root `packageManager` version (Node 26 does not ship corepack; use `npm install -g pnpm@<version>` reading the version from `package.json` or a build arg defaulted to it).
  - Build stage: `pnpm install --frozen-lockfile`, `pnpm --filter web run build`.
  - Runtime stage: production dependencies only, workspace sources needed by the server (`apps/server`, `packages/*`), and `apps/web/dist`. Runs as a non-root user. `ENV WARDBOARD_HOST=0.0.0.0 WARDBOARD_PORT=8080 WARDBOARD_DATA_DIR=/data WARDBOARD_WEB_DIR=/app/apps/web/dist`. `VOLUME /data`. `EXPOSE 8080`. `CMD ["node", "apps/server/src/main.ts"]`. `WARDBOARD_BASE_URL` has no default in the image (required at run time).
  - `HEALTHCHECK` using `node -e` with `fetch('http://127.0.0.1:8080/api/health')` (no curl in slim).
- **`docker/compose.yaml`**: one `wardboard` service built from the Dockerfile; ports `127.0.0.1:${WARDBOARD_PORT:-8080}:8080` (loopback only — `tailscale serve` on the host forwards to it); a named volume `wardboard-data` at `/data` (named volume rather than a host bind mount so SQLite WAL locking stays inside the engine's filesystem); `WARDBOARD_BASE_URL` from env with no default; `restart: unless-stopped`.
- **Root `.dockerignore`**: excludes `node_modules`, `**/node_modules`, `.git`, `apps/web/dist`, `apps/web/gui-artifacts`, `**/test-results`, `**/playwright-report`, `data/`, `*.sqlite*`, `.env`, `fixtures/` (real-layout reports never enter the image), `docs/`.
- **`scripts/docker-smoke.sh`**: `set -euo pipefail`; builds the image with a unique tag; runs it detached with a unique name, a fresh named volume, `-p 127.0.0.1::8080` (ephemeral host port), and `WARDBOARD_BASE_URL=http://localhost`; waits (timeout 120s) for Docker health status `healthy`; asserts `GET /api/health` returns `{"status":"ok"}` and `GET /` returns HTML containing `WardBoard`; asserts the container user is not root; writes a probe file in `/data` via `docker exec`, restarts the container, and asserts the probe survives; asserts the image contains no `fixtures/` directory. A `trap` removes the container, volume and image on every exit path. Prints a final `docker smoke: OK`. Exits non-zero with a clear message if `docker` is unavailable.
- **`scripts/setup.sh`**: add a non-fatal check that prints a hint when `docker` is missing ("Docker not found — install OrbStack on macOS, or Docker Engine, to build and run the image").
- **CI**: add a `docker-smoke` job to `.github/workflows/ci.yml` that runs `./scripts/docker-smoke.sh` on `ubuntu-latest`.
- **README**: a short "Run with Docker" section (`docker compose -f docker/compose.yaml up -d --build` with `WARDBOARD_BASE_URL` set) and the smoke command.

## Scope
May change:
- `docker/` (new: `Dockerfile`, `compose.yaml`)
- `.dockerignore` (new)
- `scripts/docker-smoke.sh` (new), `scripts/setup.sh` (Docker hint only), `scripts/*.test.mjs` (new structural tests only)
- `.github/workflows/ci.yml` (new job only)
- `README.md` ("Run with Docker" section only)

Must not change:
- `apps/**`, `packages/**`, `scripts/verify.sh`, `docs/**`, `SPEC.md`, `AGENTS.md`, anything else. If the server needs a change to run in the container, report BLOCKED.

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | End-to-end smoke | `./scripts/docker-smoke.sh` | exits 0; prints `docker smoke: OK`; afterwards `docker ps -a`, `docker volume ls` and `docker images` show nothing it created |
| 2 | Compose config is valid and loopback-only | `WARDBOARD_BASE_URL=http://localhost docker compose -f docker/compose.yaml config` | exits 0; published port has `host_ip: 127.0.0.1`; volume `wardboard-data` mounted at `/data` |
| 3 | Structural tests | `node --test scripts/` | passes, including the tests below |
| 4 | Smoke fails on a broken image | in a disposable copy, change the `CMD` to a missing file, run `./scripts/docker-smoke.sh` | exits non-zero with a health-timeout message and still cleans up |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
This task is configuration. Application unit tests do not apply because no application behavior changes; these structural checks (`scripts/docker.test.mjs`, `node:test`, reading the files as text/YAML-lite parsing without new dependencies) stand in, and criterion 4 is the mutation.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Dockerfile Node version matches .node-version` | `FROM node:<major.minor>` agrees with `.node-version` | Node bumped in one place only |
| `Dockerfile pins pnpm to packageManager` | pnpm version in the Dockerfile (or its default build arg) equals `package.json` `packageManager` | drift |
| `Dockerfile runs as non-root with a health check and /data volume` | `USER` is not root, `HEALTHCHECK` present, `VOLUME /data`, `WARDBOARD_DATA_DIR=/data` | missing user/healthcheck |
| `compose publishes only on loopback` | every `ports` entry starts with `127.0.0.1:` | `8080:8080` |
| `dockerignore keeps fixtures, data and env out` | `.dockerignore` lists `fixtures/`, `data/`, `.env`, `node_modules` | real-layout PDFs copied into the image |

## Edge cases (each needs a test)
- Docker unavailable: smoke script exits non-zero with a clear message (test by running it with `PATH` lacking `docker`).
- Health never becomes healthy: script times out, fails, and cleans up (criterion 4).

## Human checks
- On the Mac Studio with OrbStack: `WARDBOARD_BASE_URL=http://localhost docker compose -f docker/compose.yaml up -d --build`, open `http://127.0.0.1:8080`, see the shell with `Server: ok`, then `docker compose -f docker/compose.yaml restart` and confirm it comes back. Pending until Mike runs it.

## Out of scope
- Tailscale, `tailscale serve`, launch-at-login, and the deployment runbook (T-063).
- Backup tooling (T-028).
