# T-063: Tailscale and Mac Studio runbook

**Milestone:** 7 — Deployment
**Depends on:** T-006 (done). May run alongside T-022/T-023/T-024/T-018 — no shared files. The runbook documents `WARDBOARD_INITIAL_ADMIN_LOGIN` (defined by T-022): it is ignored by the server until T-022 lands and effective after, so there is no ordering dependency.
**Spec refs:** SPEC.md §9 (privacy: local storage, no public exposure), §10 (CONFIRMED deployment: Mac Studio first; Tailscale-only access; identity via `tailscale serve` headers; localhost-only listener; backup must capture a consistent snapshot, restore must validate and complete atomically or preserve the previous working state), §11.9 (full backup/restore in the initial release); AGENTS.md § Security rules (no secrets or real member data committed; gitignored `.env`); T-021 contract (identity gate and its parked human check), T-022 contract (bootstrap env var); the Human Backlog's pending Tailscale/Mac Studio item (account, device setup, counselor access).

## Goal
An operator runbook (`docs/deploy.md`), a compose env sample (`docker/.env.example`), one compose env passthrough, and structural checks that keep the runbook, compose file, and env sample mutually consistent — so WardBoard can be installed, upgraded, backed up, restored, and torn down on the Mac Studio, reachable only over Tailscale.

## Background

`docker/compose.yaml` (T-006) already has the right network shape: the app port is published on host loopback only (`127.0.0.1:${WARDBOARD_PORT:-8080}:8080`), data lives on the named volume `wardboard-data`, and the image binds `0.0.0.0` *inside* the container with `WARDBOARD_TRUST_IDENTITY_HEADERS_ON_NON_LOOPBACK=1`. The only path from the tailnet is `tailscale serve` on the host, which strips and re-injects the identity headers; the T-021 gate (and, once T-022 lands, the access gate) enforces the rest. What does not exist yet is the operator side: env bootstrap, the exact serve command, upgrades, backup/restore, teardown, and troubleshooting. That is this task. The runbook is written for the **target** deployment (all milestones shipped); where a feature is not yet in the image, it is noted in a single parenthetical, not a parallel set of sections.

## Design decisions (binding)

### `docker/compose.yaml` — one line added
In the `wardboard` service's `environment`, add:
```yaml
      WARDBOARD_INITIAL_ADMIN_LOGIN: ${WARDBOARD_INITIAL_ADMIN_LOGIN}
```
No `:-` default, and no other change. Rationale: compose cannot omit an unset variable (it interpolates to an empty string), and T-022 treats set-but-empty as a `ConfigError`; so the runbook mandates the operator always sets this in `docker/.env` (it is idempotent — the bootstrap is a no-op once an admin exists). Until T-022 lands the variable is unknown to the server and ignored, so a first install of a pre-T-022 image is unaffected.

### `docker/.env.example` — new file
```
# Copy to .env (gitignored) and edit. Run compose commands from this directory:
#   cp .env.example .env && $EDITOR .env && docker compose up -d
#
# The app's public URL — this machine's tailscale serve URL, i.e.
# https://<machine-hostname>.<tailnet>.ts.net
# (the machine's MagicDNS name from `tailscale status`, no trailing slash).
WARDBOARD_BASE_URL=https://<machine-hostname>.<tailnet>.ts.net
#
# Your Tailscale login — the `Tailscale-User-Login` your device presents
# (Tailscale admin console → your account). On first start you become the
# first admin; on later starts this is a no-op once an admin exists.
WARDBOARD_INITIAL_ADMIN_LOGIN=<your-tailnet-login>
#
# Optional: the host-side loopback port (default 8080). If you change it,
# the `tailscale serve` target in docs/deploy.md must match.
# WARDBOARD_PORT=8080
```
Both set values contain a `<…>` placeholder. Real tailnet names and logins never enter the repo (`.gitignore`'s `.env` entry already covers `docker/.env` at any depth). The runbook instructs `cp docker/.env.example docker/.env` and editing; `docker/.env` is never committed.

### `docs/deploy.md` — new runbook
Sections, in this order (binding content; prose is the implementer's):

1. **What this is** — the topology in one short paragraph: container on OrbStack; app port on host loopback only; `tailscale serve` is the single entry point and injects the identity headers; the server refuses direct or unauthenticated traffic (401) and traffic without a role (403, once access lands). "Never use `tailscale funnel`, and never publish the port to the LAN."
2. **Prerequisites** — OrbStack running; Tailscale signed in and connected on the host (`tailscale status`); HTTPS enabled in the tailnet (the first `tailscale serve` run may present a consent URL — visit it once from a signed-in device); a clone of this repo.
3. **First install**
   ```
   cp docker/.env.example docker/.env   # edit both values
   cd docker && docker compose up -d --build
   docker compose ps                    # wait for "healthy"
   tailscale serve --bg --yes localhost:8080
   ```
   `--bg` is mandatory (without it the serve handler dies when the terminal closes). The serve target's port must equal `WARDBOARD_PORT` from `docker/.env` (8080 by default) — say so. On macOS the app-installed CLI needs no `sudo`.
4. **Verify install** — (a) from a *second* signed-in tailnet device (laptop or phone): open `https://<machine>.<tailnet>.ts.net/` → the shell loads; (b) on the host: `curl -s http://127.0.0.1:8080/` → exactly `{"error":"unauthenticated"}`; (c) from the tailnet device: `curl -s https://<machine>.<tailnet>.ts.net/api/health` → `{"status":"ok"}`. Include the one-liner: until the app ships people & access (T-022), every signed-in tailnet user passes the identity gate and the admin variable is inert.
5. **Counselor access** — each counselor needs a signed-in Tailscale device on the tailnet (human setup: tailnet membership or machine sharing) and, once access is live, an invitation in the app as admin. Do **not** tag their devices: tagged-device traffic carries no identity headers and 401s forever.
6. **Upgrade** — back up first (§ Backup). Then `git pull`, `cd docker && docker compose build && docker compose up -d`. Migrations run automatically at startup. Re-verify: `docker compose ps` healthy, then open the URL from a tailnet device.
7. **Backup** (volume-level; the disaster-recovery path that also applies after in-app backup/restore ships, for when the app itself cannot start)
   ```
   cd docker && docker compose stop       # quiesce first — never tar a live WAL database
   mkdir -p ~/wardboard-backups
   docker run --rm -v wardboard_wardboard-data:/data \
     -v ~/wardboard-backups:/backup alpine:3 \
     tar -czf /backup/wardboard-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
   docker compose up -d
   ```
   The archive is the whole `/data` tree (SQLite database `wardboard.sqlite` plus WAL sidecars, photos, settings). Retention guidance (e.g. keep 7 daily plus one taken right before every upgrade and before the first real-data import). Backups contain real member data: keep them in `~/wardboard-backups` on the host — never inside the repo checkout, never in a shared or public location. One sentence: if the app's Settings offer in-app backup/restore, prefer it for routine backups; keep this procedure for recovery.
8. **Restore** (validate before touching the live volume; the pre-restore snapshot preserves the previous working state)
   ```
   cd docker && docker compose stop
   ARCHIVE=~/wardboard-backups/wardboard-<stamp>.tar.gz
   TMP=$(mktemp -d)
   tar -xzf "$ARCHIVE" -C "$TMP"                    # 1. unpack outside the live volume
   docker run --rm -v "$TMP:/data" node:26-slim node -e \
     'const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync("/data/wardboard.sqlite");
      console.log(db.prepare("PRAGMA integrity_check").get());'   # 2. expect { integrity_check: 'ok' }
   docker run --rm -v wardboard_wardboard-data:/data -v "$TMP/pre-restore:/backup" alpine:3 \
     sh -c 'mkdir -p /backup && tar -czf /backup/wardboard-pre-restore-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'   # 3. snapshot current state
   IMAGE=$(docker compose config --images)          # 4. swap contents via the app image (the wardboard user exists there)
   docker run --rm --user root --entrypoint sh -v wardboard_wardboard-data:/data -v "$TMP:/new" "$IMAGE" \
     -c 'find /data -mindepth 1 -delete && tar -cf - -C /new . | tar -xf - -C /data && chown -R wardboard /data'
   docker compose up -d                             # 5. verify: healthy, then open the app from a tailnet device
   rm -rf "$TMP"
   ```
   The runbook references the database file by its exact name `wardboard.sqlite` (T-022 opens `path.join(dataDir, 'wardboard.sqlite')`) so the name is a single substitutable token. Never delete the pre-restore snapshot until the restored app has been verified working from a tailnet device.
9. **Teardown** — `cd docker && docker compose down` (stops; keeps the volume) / `docker compose down -v` (**deletes all data** — back up first) / `tailscale serve --https=443 localhost:8080 off` (or `tailscale serve reset` for everything) / keep the last backup.
10. **Troubleshooting** — a table with at least these rows: everything 401 (`{"error":"unauthenticated"}`) → the request is not from a signed-in tailnet user via the serve URL (check `tailscale status`; tagged device = no identity headers; hitting the host/LAN port directly); everything 403 while signed in → not in the user list (invite in the app as admin) or a pre-access image without `WARDBOARD_INITIAL_ADMIN_LOGIN` set; page loads but boards do not sync → `WARDBOARD_BASE_URL` is wrong (the client derives the WebSocket endpoint from it; it must match the browser's address bar exactly); container unhealthy or refusing to start → `docker compose logs --tail 100 wardboard` (a bad `WARDBOARD_BASE_URL`/port refuses startup by design); `tailscale serve` shows a consent page → HTTPS not yet enabled in the tailnet; host port already in use → change `WARDBOARD_PORT` in `docker/.env` and the serve target together; OrbStack not running → every `docker`/`compose` command fails on the socket — start it.

### `scripts/deploy.test.mjs` — new structural tests
`node:test` + `node:assert`, no dependencies, read from the repo root (path relative to the test file, as `scripts/docker.test.mjs` does). It runs automatically in the gate through the existing `node --test scripts/` step — **no `verify.sh` change**. Tests are listed in the "Unit tests to write" section.

## Scope

May change:
- `docker/compose.yaml` (the one env line above)
- `docker/.env.example` (new)
- `docs/deploy.md` (new)
- `scripts/deploy.test.mjs` (new)

Must not change:
- `docker/Dockerfile`, anything else under `docker/`, `scripts/verify.sh`, `scripts/docker-smoke.sh`, existing `scripts/*.test.mjs`, `.dockerignore`, `.gitignore`, `apps/**`, `packages/**`, `docs/tasks/**`, anything else

New dependencies allowed: none.

## Acceptance criteria

Application unit tests do not apply: documentation and deployment configuration with no application behavior change (the 401/403 gate and config behavior are already covered by T-021/T-022 tests). Structural tests, a real compose validation, a real backup/restore dry run, and mutations replace them. The Docker CLI must be available (OrbStack is installed per the Human Backlog); if `docker info` fails, report BLOCKED rather than skipping checks 3–5.

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural tests pass | `node --test scripts/deploy.test.mjs` | `# fail 0`; every test in the table below is listed as passing |
| 2 | Red before green | commit only the new test file, then run check 1 | the tests concerning not-yet-existing artifacts fail for the expected reason (deploy.md missing, .env.example missing, compose admin line missing); the invariant guards that already hold on current `compose.yaml` (loopback publish, name/volume, no base-URL default) are noted as already-green; record the output |
| 3 | Compose still valid and interpolates | `docker compose -f docker/compose.yaml --env-file docker/.env.example config --quiet` | exit 0, no warnings about unset variables |
| 4 | Quality gate | `./scripts/verify.sh > <log> 2>&1; echo exit=$?` | `exit=0`; the log shows the new deploy tests under the `node --test scripts/` step and ends `verify: all steps passed` |
| 5 | Runbook backup/restore mechanics work end to end | see below | the probe database row and probe file survive the backup → loss → restore cycle; the container is healthy at the end |
| 6 | Mutations of the structural checks | in a disposable copy of the candidate, apply each of (a)–(h), run check 1 after each, reverting between | each mutation makes at least one named test fail; record the output; remove the copy afterwards |
| 7 | Only scoped files changed | `git diff --stat origin/main...HEAD` | exactly `docker/compose.yaml` (1 insertion), `docker/.env.example`, `docs/deploy.md`, `scripts/deploy.test.mjs` |
| 8 | CI on the task branch | push the **task branch only** (`git push origin HEAD:<task-branch>`; never `main`), then `gh run view <id> --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'` once it finishes | a single `verify success` job. If `gh` is unavailable or unauthenticated, report this check as not run with the reason |

Check 5 (dry run) is binding in shape: in a scratch directory outside the repo, copy `docker/compose.yaml` and write a scratch `.env` with `WARDBOARD_PORT=0` (ephemeral host port), `WARDBOARD_BASE_URL=http://localhost`, `WARDBOARD_INITIAL_ADMIN_LOGIN=smoke@example.test`; run every compose command with `--project-name "t063-<unique>"` so its image and `t063-<unique>_wardboard-data` volume cannot collide with a real deployment or another worktree's gate. Then: `up -d --build` and wait for healthy (the smoke's `docker inspect` health-wait pattern); seed a probe via `docker compose exec wardboard node -e` creating `t063-probe.sqlite` with one row, and `sh -c 'echo probe > /data/t063-probe.txt'`; run the runbook's **Backup** commands verbatim with `wardboard_wardboard-data` → the scratch volume name and `~/wardboard-backups` → the scratch backup dir; simulate loss (`docker compose exec wardboard sh -c 'rm -f /data/t063-probe.*'`); run the runbook's **Restore** sequence verbatim with the same token substitutions (and `wardboard.sqlite` → `t063-probe.sqlite` in the integrity check); assert healthy + the row and file are back; tear down (`down -v`, remove the scratch image and directory). The dry run must work whether or not T-022 has landed on the branch (the identity-header health probe plus the admin env var covers both eras).

Mutations for check 6: (a) compose publish `"8080:8080"` (LAN-reachable); (b) runbook serve command without `--bg`; (c) runbook backup section without the `docker compose stop` line; (d) runbook restore section without the `integrity_check` step; (e) runbook restore swap step without the `chown`; (f) rename the compose volume `wardboard-data` → `wardboard-state` (runbook unchanged); (g) `.env.example` with a real-looking value `https://studio.acme.ts.net` (no `<`); (h) compose `WARDBOARD_BASE_URL` given a `:-http://localhost` default.

Run at most one `./scripts/verify.sh` or one check-5 dry run at a time in a worktree.

## Unit tests to write (structural, in `scripts/deploy.test.mjs`)

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `compose publishes the app port on loopback only` | every non-comment `ports:` entry, after stripping quotes, begins with `127.0.0.1:` | the publish changed to `8080:8080` or a LAN address (tailnet-only invariant broken) |
| `compose passes through the initial-admin login with no default` | the `environment` block contains `WARDBOARD_INITIAL_ADMIN_LOGIN: ${WARDBOARD_INITIAL_ADMIN_LOGIN}` with no `:-` or `-` fallback inside the braces | the line dropped, or a default added (an unset var would interpolate to empty, which T-022 rejects with a ConfigError) |
| `compose requires the base URL with no default` | the `WARDBOARD_BASE_URL` environment line has no `:-` fallback | a convenience default added (the app must refuse to start without a base URL — T-002/T-021) |
| `compose keeps the fixed project name and data volume` | `name: wardboard` and the `wardboard-data:/data` mount are both present | a rename drifts from the runbook's derived volume name |
| `.env.example defines both required variables with placeholders only` | uncommented `WARDBOARD_BASE_URL=` and `WARDBOARD_INITIAL_ADMIN_LOGIN=` lines exist, and every set value contains a `<…>` placeholder token | a real tailnet name or login committed to the repo |
| `the runbook's serve command is persistent` | deploy.md contains a `tailscale serve` command carrying `--bg` with target `localhost:8080` (flags may be reordered), and the text notes the target must match `WARDBOARD_PORT` if that is changed | `--bg` dropped — the handler silently dies when the terminal closes |
| `the runbook backs up a quiesced volume` | in the Backup section, `docker compose stop` appears before the `tar -czf` line and `docker compose up -d` after it | the stop removed or reordered — a live WAL database tarred into a corrupt archive |
| `the runbook validates the archive before swapping the live volume` | in the Restore section, `integrity_check` appears before the volume-content swap, the pre-restore snapshot appears before the swap, and a `docker compose up -d` plus a verification sentence appears after it | restore proceeds unvalidated, or the previous state is not preserved |
| `the runbook re-owns volume contents for the app user` | the volume-swap step contains `chown` and `wardboard` | files left root-owned — the non-root app cannot write and the restored app breaks |
| `the runbook's volume name matches compose` | `wardboard_wardboard-data` (the project-name + volume pair from test 4) appears in deploy.md's backup and restore commands | a rename in compose or the runbook desynchronizes the two |
| `the runbook keeps backups in the home directory, outside the checkout` | the backup destination is `~/wardboard-backups` (or `$HOME/wardboard-backups`), and no backup path is relative to the repo root | real member data lands in the git worktree |

## Edge cases (each needs a check)

- Non-default `WARDBOARD_PORT`: the runbook states the serve target must match (covered by the serve-command test's `WARDBOARD_PORT` clause).
- Pre-T-022 image (a first install today): the §4 one-liner (identity-only era; the admin variable is inert) is present in the runbook.
- Tagged counselor device: the troubleshooting 401 row names it.
- Signed-in but no role: the troubleshooting 403 row names it and the fix (invite in the app, or set the admin var on a pre-access image).
- Wrong `WARDBOARD_BASE_URL`: the troubleshooting row (realtime breaks because the WebSocket endpoint derives from it).
- OrbStack stopped: the troubleshooting row (docker/compose fail on the socket; start it).
- An archive taken from a stopped app includes the WAL sidecars: the runbook says the archive is the whole `/data` tree, so the integrity check reads them.

## Human checks

All on the Mac Studio, once the Human Backlog's pending Tailscale/Mac Studio setup is in place; none can be verified by an agent:

1. First install per the runbook with the real `.env` and real tailnet name.
2. From a second signed-in tailnet device — a laptop, then a phone (the phone step also discharges the parked T-003 iPhone-shell check): open the serve URL and confirm the shell loads.
3. On the host: `curl -s http://127.0.0.1:8080/` returns exactly `{"error":"unauthenticated"}` (completes the parked T-021 check).
4. Run the Backup section once; confirm the app returns healthy and the archive is non-trivial.
5. Run the full Restore sequence on that archive (safe before the first real import — no real data yet); confirm the app comes back from a tailnet device.
6. Have one counselor open the URL from their phone.

## Out of scope

- In-app backup/restore (T-028), people & access endpoints and the settings UI (T-022/T-046), board persistence (T-023): the runbook documents their *deployment surface* (one env var, one note, one troubleshooting row) and implements none of it.
- `tailscale funnel` / public exposure, Tailscale Services (L3), running tailscaled inside the container.
- Any change to `verify.sh`, the CI workflow, the Dockerfile, or the smoke script.
- Real tailnet names, logins, or member data in any committed file.
