#!/usr/bin/env bash
# End-to-end Docker smoke test for the WardBoard image.
#
# Builds the image, runs it on an ephemeral loopback port with a fresh named
# volume, and proves: the health check becomes healthy, /api/health answers
# {"status":"ok"}, the built web shell is served, the container runs non-root,
# /data survives a restart, and no fixtures/ directory made it into the image.
# Cleans up everything it created on every exit path.
#
# Usage: ./scripts/docker-smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker smoke: docker CLI not found on PATH — install OrbStack on macOS, or Docker Engine, to build and run the image." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker smoke: Docker daemon is not reachable — start OrbStack (macOS) or Docker, or, in a sandbox, grant this session access to the Docker socket. The quality gate cannot pass without a running Docker daemon." >&2
  exit 1
fi

IMAGE="wardboard:smoke-$(date +%s)-$$"
NAME="wardboard-smoke-$(date +%s)-$$"
VOLUME="wardboard-smoke-$(date +%s)-$$"
PROBE_NAME=""

cleanup() {
  local status=$?
  [ -n "$NAME" ] && docker rm -f "$NAME" >/dev/null 2>&1 || true
  # The probe container has an anonymous /data volume (the image declares
  # VOLUME /data); -v removes it with the container, since modern engines no
  # longer delete anonymous volumes on a plain `docker rm`.
  [ -n "$PROBE_NAME" ] && docker rm -f -v "$PROBE_NAME" >/dev/null 2>&1 || true
  [ -n "$VOLUME" ] && docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  [ -n "$IMAGE" ] && docker rmi "$IMAGE" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "docker smoke: FAILED — $*" >&2
  exit 1
}

echo "==> [docker-smoke] building image ${IMAGE}"
docker build -f docker/Dockerfile -t "$IMAGE" . || fail "image build failed"

echo "==> [docker-smoke] starting container ${NAME} (fresh volume ${VOLUME})"
docker volume create "$VOLUME" >/dev/null
docker run -d \
  --name "$NAME" \
  -v "$VOLUME:/data" \
  -p 127.0.0.1::8080 \
  -e WARDBOARD_BASE_URL=http://localhost \
  "$IMAGE" >/dev/null

# Wait for the container's own health check; a broken image must time out here.
wait_healthy() {
  local deadline=$(( $(date +%s) + 120 ))
  local status
  while :; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$NAME" 2>/dev/null || true)"
    if [ "$status" = "healthy" ]; then
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      {
        echo "docker smoke: health never became healthy within 120s (last status: ${status:-unknown}). Container log tail:"
        docker logs --tail 50 "$NAME" 2>&1 || true
      } >&2
      return 1
    fi
    sleep 2
  done
}

echo "==> [docker-smoke] waiting for the container to become healthy"
wait_healthy || fail "health never became healthy within 120s"
echo "    healthy"

ADDR="$(docker port "$NAME" 8080/tcp)"
HOST_PORT="${ADDR#*:}"
[ -n "$HOST_PORT" ] || fail "could not determine the published host port (${ADDR})"
BASE_URL="http://127.0.0.1:${HOST_PORT}"

echo "==> [docker-smoke] checking HTTP on ${BASE_URL}"
HEALTH_BODY="$(curl -fsS "${BASE_URL}/api/health")" || fail "GET /api/health failed"
[ "$HEALTH_BODY" = '{"status":"ok"}' ] || fail "/api/health returned '${HEALTH_BODY}', expected '{\"status\":\"ok\"}'"
echo "    /api/health: ${HEALTH_BODY}"

INDEX_BODY="$(curl -fsS -H 'Tailscale-User-Login: smoke@example.test' "${BASE_URL}/")" || fail "GET / failed"
grep -q 'WardBoard' <<<"$INDEX_BODY" || fail "GET / did not serve the WardBoard web shell"
echo "    / serves the WardBoard shell"

ANON_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/")" || fail "GET / without identity failed"
[ "$ANON_STATUS" = "401" ] || fail "GET / without Tailscale-User-Login returned ${ANON_STATUS}, expected 401"
echo "    / without identity: 401"

RUN_UID="$(docker exec "$NAME" id -u)"
[ "$RUN_UID" != "0" ] || fail "container runs as root"
echo "    runs as non-root (uid ${RUN_UID})"

echo "==> [docker-smoke] checking /data persistence across a restart"
docker exec "$NAME" sh -c 'echo wardboard-smoke-probe > /data/smoke-probe.txt'
docker restart "$NAME" >/dev/null
wait_healthy || fail "health never became healthy after restart within 120s"
docker exec "$NAME" sh -c 'grep -q wardboard-smoke-probe /data/smoke-probe.txt' \
  || fail "probe file in /data did not survive the container restart"
echo "    /data survived the restart"

echo "==> [docker-smoke] checking the image contains no fixtures/"
PROBE_NAME="${NAME}-image"
docker create --name "$PROBE_NAME" "$IMAGE" >/dev/null
if ! FIXTURE_LIST="$(docker export "$PROBE_NAME" | tar -tf -)"; then
  fail "could not inspect the image filesystem"
fi
FIXTURE_HITS="$(grep -E '(^|/)fixtures(/|$)' <<<"$FIXTURE_LIST" || true)"
[ -z "$FIXTURE_HITS" ] || fail "image contains fixtures: ${FIXTURE_HITS}"
echo "    no fixtures/ in the image"

echo "docker smoke: OK"
