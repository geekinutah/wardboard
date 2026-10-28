# Deploying WardBoard on a Mac Studio

Install, upgrade, back up, restore, and tear down WardBoard on the Mac Studio. The only network path in is Tailscale.

## What this is

WardBoard runs as a container on OrbStack. The app port is published on the host loopback interface only. `tailscale serve` is the single entry point and injects the identity headers (for example `Tailscale-User-Login`). The server refuses direct or unauthenticated traffic (401) and traffic without a role (403, once access lands). Never use `tailscale funnel`, and never publish the port to the LAN.

## Prerequisites

- OrbStack is running.
- Tailscale is signed in and connected on the host (`tailscale status`).
- HTTPS is enabled in the tailnet. The first `tailscale serve` run may present a consent URL — visit it once from a signed-in device.
- A clone of this repo.

## First install

From the repository root, copy the sample env and edit both values, then start the stack and publish it on the tailnet:

```sh
cp docker/.env.example docker/.env   # edit both values
cd docker && docker compose up -d --build
docker compose ps                    # wait for "healthy"
tailscale serve --bg --yes localhost:8080
```

`WARDBOARD_BASE_URL` is this machine's MagicDNS name from `tailscale status`: `https://<machine-hostname>.<tailnet>.ts.net`, with no trailing slash. `WARDBOARD_INITIAL_ADMIN_LOGIN` is the `Tailscale-User-Login` your device presents (Tailscale admin console → your account). On first start that login becomes the first admin. On later starts it is a no-op once an admin exists. Leave it set: compose always passes the variable through, and a set-but-empty value is a config error.

`--bg` is mandatory (without it the serve handler dies when the terminal closes). The serve target must match `WARDBOARD_PORT` if that is changed (8080 by default). On macOS the app-installed CLI needs no `sudo`.

## Verify install

(a) From a second signed-in tailnet device (a laptop or a phone), open `https://<machine>.<tailnet>.ts.net/` — the shell loads.

(b) On the host, `curl -s http://127.0.0.1:8080/` returns exactly `{"error":"unauthenticated"}`. If you changed `WARDBOARD_PORT`, use that port instead of 8080.

(c) From the tailnet device, `curl -s https://<machine>.<tailnet>.ts.net/api/health` returns `{"status":"ok"}`.

Note: until the app ships people & access (T-022), every signed-in tailnet user passes the identity gate and the admin variable is inert.

## Counselor access

Each counselor needs a signed-in Tailscale device on the tailnet (human setup: tailnet membership or machine sharing) and, once access is live, an invitation in the app as admin. Do not tag their devices: tagged-device traffic carries no identity headers and 401s forever.

## Upgrade

Back up first (see Backup), including one archive taken right before the upgrade. Then:

```sh
git pull
cd docker && docker compose build && docker compose up -d
```

Migrations run automatically at startup. Re-verify: `docker compose ps` shows healthy, then open the URL from a tailnet device. Leave the existing serve config in place unless `WARDBOARD_PORT` changed; if it did, update the serve target to match.

## Backup

This is the volume-level disaster-recovery path. It still applies after in-app backup and restore ships, for when the app itself cannot start.

```sh
cd docker && docker compose stop       # quiesce first — never tar a live WAL database
mkdir -p ~/wardboard-backups
docker run --rm -v wardboard_wardboard-data:/data \
  -v ~/wardboard-backups:/backup alpine:3 \
  tar -czf /backup/wardboard-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
docker compose up -d
```

The archive is the whole `/data` tree (SQLite database `wardboard.sqlite` plus WAL sidecars, photos, settings). Stopping first is required: a tar of a live WAL database can be corrupt.

Keep 7 daily archives, plus one taken right before every upgrade and before the first real-data import. Backups contain real member data: keep them in `~/wardboard-backups` on the host — never inside the repo checkout, never in a shared or public location.

If the app's Settings offer in-app backup/restore, prefer it for routine backups; keep this procedure for recovery.

## Restore

Validate the archive before touching the live volume. The pre-restore snapshot preserves the previous working state. Set `<stamp>` to the archive you are restoring.

```sh
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

Stop at step 2 unless the printed result is `{ integrity_check: 'ok' }`. The check opens `wardboard.sqlite` in the unpacked tree. The archive is the whole `/data` tree, so WAL sidecars beside that file are what the check reads. The swap runs as root via the app image (the `wardboard` user exists there) and `chown`s the volume to that user so the non-root server can write.

Verify the container is healthy (`docker compose ps`), then open the app from a tailnet device. Never delete the pre-restore snapshot until the restored app has been verified working from a tailnet device.

## Teardown

Stop the container and keep the data volume:

```sh
cd docker && docker compose down
```

`docker compose down -v` deletes all data — back up first. Remove the serve endpoint with `tailscale serve --https=443 localhost:8080 off`, or `tailscale serve reset` to clear every serve config. Keep the last backup in `~/wardboard-backups`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Everything returns 401 (`{"error":"unauthenticated"}`) | The request is not from a signed-in tailnet user via the serve URL. Check `tailscale status`. A tagged device has no identity headers. Hitting the host or LAN port directly also returns 401. |
| Everything returns 403 while signed in | The login is not in the user list (invite in the app as admin), or this is a pre-access image without `WARDBOARD_INITIAL_ADMIN_LOGIN` set. |
| The page loads but boards do not sync | `WARDBOARD_BASE_URL` is wrong. The client derives the WebSocket endpoint from it, so the value must match the browser's address bar exactly. |
| The container is unhealthy or refuses to start | Run `docker compose logs --tail 100 wardboard`. A bad `WARDBOARD_BASE_URL` or port refuses startup by design. |
| `tailscale serve` shows a consent page | HTTPS is not yet enabled in the tailnet. Open the consent URL once from a signed-in device. |
| The host port is already in use | Change `WARDBOARD_PORT` in `docker/.env` and the serve target together. |
| OrbStack not running | Every `docker` and `compose` command fails on the socket. Start OrbStack. |
