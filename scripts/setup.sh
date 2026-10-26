#!/usr/bin/env bash
# One-command dev environment setup for a fresh clone. Safe to re-run.
# Usage: ./scripts/setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> [setup] toolchain check"
node scripts/env-check.mjs

echo "==> [setup] install dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

# --- extension point: later setup steps go below, in order ---------------
# T-003: install Playwright browsers.
# T-006: check for a Docker CLI.
# --- end extension point --------------------------------------------------

echo "==> [setup] done. Next: ./scripts/verify.sh"
