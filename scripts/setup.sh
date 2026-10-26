#!/usr/bin/env bash
# One-command dev environment setup for a fresh clone. Safe to re-run.
# Usage: ./scripts/setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [setup] toolchain check"
node scripts/env-check.mjs

echo "==> [setup] install dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

echo "==> [setup] install Playwright browsers (Chromium, WebKit)"
# CI on Ubuntu also needs the browsers' system libraries: set
# WARDBOARD_PLAYWRIGHT_WITH_DEPS=1 to add --with-deps (may use sudo/apt).
if [ "${WARDBOARD_PLAYWRIGHT_WITH_DEPS:-}" = "1" ]; then
  pnpm --filter web exec playwright install --with-deps chromium webkit
else
  pnpm --filter web exec playwright install chromium webkit
fi

# --- extension point: later setup steps go below, in order ---------------
# T-006: Docker is optional for development and the quality gate; hint only.
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found — install OrbStack on macOS, or Docker Engine, to build and run the image."
fi
# --- end extension point --------------------------------------------------

echo "==> [setup] done. Next: ./scripts/verify.sh"
