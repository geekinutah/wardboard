#!/usr/bin/env bash
# The single quality gate. Must pass before any task is reported done.
# Usage: ./scripts/verify.sh
#
# Concurrency: uses no fixed ports and writes only inside this checkout (and
# the shared pnpm store, which pnpm locks), so separate checkouts or worktrees
# can run it at the same time. Run at most one gate per checkout at a time.
set -euo pipefail

cd "$(dirname "$0")/.."

current_step=""
step() {
  current_step="$1"
  printf '\n==> [verify] %s\n' "$1"
}

on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    printf '\nverify: FAILED at step "%s" (exit %s)\n' "$current_step" "$status" >&2
  else
    printf '\nverify: all steps passed\n'
  fi
}
trap on_exit EXIT

step "env: toolchain check"
node scripts/env-check.mjs

step "install: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

step "scripts tests: node --test scripts/"
node --test scripts/

step "typecheck: pnpm -r typecheck"
pnpm -r typecheck

step "lint: pnpm -r lint, then root scripts"
pnpm -r lint
pnpm run lint

step "test: pnpm -r test"
pnpm -r test

step "ensure_playwright_browsers: pnpm --filter web exec playwright install chromium webkit"
pnpm --filter web exec playwright install chromium webkit

step "e2e: pnpm --filter web run test:e2e:playwright"
pnpm --filter web run test:e2e:playwright
