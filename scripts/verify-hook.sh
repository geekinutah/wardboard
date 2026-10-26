#!/usr/bin/env bash
# Harness Stop hook (Claude Code and Grok Build). See docs/agents/README.md.
#
# Reads hook JSON on stdin. If `stop_hook_active` (Claude Code) or
# `stopHookActive` (Grok Build) is true, exits 0 without running anything so
# the hook cannot loop. Otherwise runs the quality gate: exit 0 when it
# passes; when it fails, print the last 60 lines of its output to stderr and
# exit 2 so the harness feeds them back to the agent.
#
# WARDBOARD_VERIFY_CMD overrides the gate command; it exists for tests only.
set -uo pipefail

cd "$(dirname "$0")/.."

input="$(cat || true)"

active="$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const active = parsed !== null && typeof parsed === "object" &&
    (parsed.stop_hook_active === true || parsed.stopHookActive === true);
  process.stdout.write(active ? "true" : "false");
});
' 2>/dev/null || true)"

if [ "$active" = "true" ]; then
  exit 0
fi

verify_cmd="${WARDBOARD_VERIFY_CMD:-./scripts/verify.sh}"
output="$(mktemp "${TMPDIR:-/tmp}/wardboard-verify-hook.XXXXXX")"
trap 'rm -f "$output"' EXIT

if bash -c "$verify_cmd" </dev/null >"$output" 2>&1; then
  exit 0
fi

{
  echo "Quality gate failed ($verify_cmd). Last 60 lines of output:"
  tail -n 60 "$output"
} >&2
exit 2
