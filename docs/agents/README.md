# Running the agent workflow

Read `AGENTS.md` first. The shared [protocol](protocol.md) defines handoffs, capabilities, and reports; [controller](controller.md), [implementer](implementer.md), and [verifier](verifier.md) define the roles. `SPEC.md`, task contracts, and STATUS.md remain the durable product/work state. Backlog intake follows AGENTS.md.

Only adapters are harness-specific. Model settings remain unset in committed adapters, except OpenCode, which pins `arch-llama/qwen3.8-27b` (see Model choice (OpenCode)); harness guidance below describes selection at invocation or handoff. Choose providers and models through your installed harness's supported settings; role behavior and quality gates remain the same. Different models can implement and verify when each supports the required capabilities.

## Claude Code

From the repository root, start the installed/authenticated CLI's main session:

```sh
claude --agent controller
```

Give it the requested work or task ID. Project agents in `.claude/agents/` point to the canonical files. The controller retains `Agent(implementer, verifier)` delegation; implementer/editor tools and its `Stop` verification hook remain configured; the verifier retains its read/shell tool list. Run the controller as the main session to avoid depending on nested delegation. Models are omitted to leave selection to invocation/environment/session defaults. Inspect available agents with `/agents` in a local session.

The Stop hook calls the existing `./scripts/verify-hook.sh`; it is an additional harness check, not a substitute for the implementer and fresh verifier explicitly running acceptance commands and the full gate. A verifier with shell access is not OS-enforced read-only; obey the shared candidate/mutation rules.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

See the official [Claude Code subagent documentation](https://code.claude.com/docs/en/sub-agents).

## Codex CLI

Start the installed/authenticated Codex CLI from the repository root:

```sh
codex
```

Prompt the main session:

```text
Read AGENTS.md, docs/agents/protocol.md, and docs/agents/controller.md.
Act as controller for <requested work/task ID>. Delegate implementation to
implementer and then independent verification to a fresh verifier, supplying
the protocol handoff packet. Report any missing capability as BLOCKED.
```

Local custom agents are discovered from `.codex/agents/*.toml`; no duplicate role text or separate config registration is needed. Each adapter declares `name`, `description`, and `developer_instructions`. The controller adapter is available for role discovery, but the startup above keeps coordination in the main session instead of depending on nested delegation. The implementer and verifier adapters point to the same Markdown used by Claude.

No model, reasoning effort, or sandbox override is committed. Choose model and reasoning effort at the controller handoff using the policy below. Verification requires shell execution, build artifacts, and disposable mutation space; source read-only is a workflow rule, not a claim that a read-only OS sandbox can run every gate. Resolve missing permissions through the harness's normal controls; report BLOCKED if required checks cannot run.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

See the official [Codex custom subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents). Check your installed CLI supports this configuration. Hosted ChatGPT/Codex sessions do not automatically load these local custom-agent adapters: explicitly supply the canonical role/protocol and use whatever delegation capabilities that environment actually exposes.

### Model choice (Codex)

For each implementer and independent verifier handoff, explicitly choose both model and reasoning effort based on task complexity and verification risk. Do not silently inherit either when the harness supports overrides. Name the actual model and reasoning effort in the handoff packet and controller report.

Start routine, bounded work with `gpt-6.1-sol` at `low` effort. Use `medium` or `high` for multi-step code reasoning, debugging, or risk-heavy verification. Escalate security-sensitive work, concurrency/race logic, cross-cutting design, and correction rounds; `gpt-6-astra` is an option for the hardest such work. Assess verifier risk independently of implementation size and escalate the verifier independently when needed.

Independent verification stays mandatory regardless of model. Model choice must not weaken any acceptance, quality, mutation, or GUI gate.

If a model or per-handoff override is unavailable in the active Codex harness, use a supported setting and report the actual model/effort and limitation. Do not claim an override occurred when it did not.

Do not pin a model in implementer/verifier TOML, global config, or canonical role docs. Keep choice at the controller handoff.

## Grok Build

From the repository root, start the installed/authenticated CLI's main session:

```sh
grok --agent controller
```

Give it the requested work or task ID. Project agents in `.grok/agents/` point to the canonical files. The controller can spawn `implementer` and `verifier` subagents. Grok forbids nested subagents (maximum depth 1), so the controller must be the main session — a controller child cannot delegate further. Models are omitted to leave selection to invocation/environment/session defaults (`-m`, `/model`). Inspect available agents with `/agents` or `grok inspect`.

The implementer retains editor/shell tools and a `Stop` hook that calls `./scripts/verify-hook.sh` with a 600s timeout (Grok's default hook timeout is too short for the quality gate). That hook is an additional harness check, not a substitute for the implementer and fresh verifier explicitly running acceptance commands and the full gate. The verifier retains its read/shell tool list (no write/edit tools). A verifier with shell access is not OS-enforced read-only; obey the shared candidate/mutation rules.

Do not treat Claude-compat discovery of `.claude/agents/` as the Grok adapter path. Those files remain Claude adapters and can be disabled with `compat.claude.agents = false`. Native `.grok/agents/` stay available either way. Grok does not load `.codex/agents/`.

`./scripts/verify-hook.sh` accepts both Claude Code's `stop_hook_active` and Grok's `stopHookActive` so the continue-loop guard works on either harness.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

See the installed Grok Build user guide: subagents in `~/.grok/docs/user-guide/16-subagents.md`, and project agent discovery (`.grok/agents/`) in `~/.grok/docs/user-guide/12-project-rules.md`.

## OpenCode

From the repository root, start the installed/authenticated CLI's main session:

```sh
opencode
```

OpenCode ingests `AGENTS.md` natively at startup as its project rule. When both exist, `CLAUDE.md` is ignored, and OpenCode does not expand `@` references in rule files — this repo's `AGENTS.md` contains none, so nothing is lost.

Prompt the main session:

```text
Read AGENTS.md, docs/agents/protocol.md, and docs/agents/controller.md.
Act as controller for <requested work/task ID>. Delegate implementation to
implementer and then independent verification to a fresh verifier, supplying
the protocol handoff packet. Report any missing capability as BLOCKED.
```

Select the `controller` agent with Tab in the TUI (a `mode: primary` agent) or `opencode run --agent controller` from the repository root. The controller must be the main session so coordination does not depend on nested delegation.

Project agents in `.opencode/agents/` point to the canonical files (the file name is the agent name; same pointer convention as the Claude and Grok adapters): `controller` is `mode: primary`; `implementer` and `verifier` are `mode: subagent`. Their bodies point at `AGENTS.md`, `docs/agents/protocol.md`, and `docs/agents/controller.md`, `docs/agents/implementer.md`, or `docs/agents/verifier.md` respectively, and contain no second copy of the shared procedure.

The verifier adapter denies file mutation (`edit: deny`, which per the OpenCode docs gates the `write`, `edit`, and `apply_patch` tools) and further delegation (`task: deny`). A verifier with shell access is not OS-enforced read-only; obey the shared candidate/mutation rules.

OpenCode has no per-agent `Stop` hook, so the `./scripts/verify-hook.sh` backstop has no committed equivalent (the closest mechanism is a `.opencode/plugins/` plugin on `session.idle`; documented as an option, not committed). Enforcement remains the implementer's own instructions (run the gate before reporting PASS) and the fresh verifier — the same treatment as the Antigravity section.

If your OpenCode session is sandboxed, the Playwright browser download block in "Sandboxes that block the Playwright browser download" applies — same symptom, same preferred fix, same WebKit caveat.

### Model choice (OpenCode)

Every OpenCode role (controller, implementer, verifier) runs on `arch-llama/qwen3.8-27b` (Arch Qwen3.8-27B, llama.cpp — faster decode and token generation than the LM Studio instance), pinned in the frontmatter of the committed adapters in `.opencode/agents/`. This is Mike's standing decision; only Mike changes it, by editing these docs.

- Do not pass a `model` override on the subagent tool, and do not switch model or provider for any handoff, including correction rounds and security-sensitive tasks.
- Do not apply another harness's model guidance in OpenCode.
- Do not infer a model's capability from its name, release date, or other metadata.
- Independence comes from a fresh verifier session, not a different model.
- Name the model in the handoff packet and the controller report.
- If the pinned model cannot do a task, or the pin fails to load, report BLOCKED to Mike rather than switching models.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

See the official [OpenCode agents documentation](https://opencode.ai/docs/agents/).

## Google Antigravity

Start the Antigravity session from the repository root workspace. Antigravity ingests `AGENTS.md` natively as a project rule from the repository root at startup. Because Antigravity uses dynamic subagents defined at runtime via tool calls, no static adapter directory (such as `.claude/` or `.grok/`) is required.

Gemini 4 Argon (`gemini-4-argon-high`) is recommended for running the main session controller to manage multi-step reasoning, plan decomposition, handoff packet preparation, and verification review.

Prompt the main session to act as controller:

```text
Read AGENTS.md, docs/agents/protocol.md, and docs/agents/controller.md.
Act as controller for <requested work/task ID>. Delegate implementation to
implementer and independent verification to a fresh verifier, supplying the
protocol handoff packet. Report any missing capability as BLOCKED.
```

The main session controller delegates dynamically using Antigravity's subagent tools:
- Call `define_subagent` to configure role instructions pointing to the canonical files:
  - Implementer instructions point to `docs/agents/implementer.md`, `docs/agents/protocol.md`, and `AGENTS.md`. Write tools remain enabled.
  - Verifier instructions point to `docs/agents/verifier.md`, `docs/agents/protocol.md`, and `AGENTS.md`. Because Antigravity's `enable_write_tools` bundles both file editing tools (`write_to_file`, `replace_file_content`) and shell command execution (`run_command`), setting `enable_write_tools: false` strips `run_command`, preventing verifiers from running test suites and the quality gate. Therefore, verifier subagents must be configured with `enable_write_tools: true`.
- Call `invoke_subagent` with the explicit handoff packet (`docs/agents/protocol.md`) and the candidate task contract. The controller awaits implementer completion before invoking a fresh verifier for the frozen candidate revision.
- Use `send_message` to communicate between the parent controller and subagents.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

### Model choice (Google Antigravity)

For every implementer and verifier handoff, choose the model from task complexity and verification risk. There are two tiers: Gemini Flash (`gemini-3.8-flash`) and Gemini 4 Argon (`gemini-4-argon`).

- Default to Gemini Flash for well-specified, routine, bounded tasks.
- Escalate to Gemini 4 Argon for multi-step code reasoning, security-sensitive work, concurrency/race-condition logic, cross-cutting architectural changes, and correction rounds. Escalate the verifier to Gemini 4 Argon on its own risk assessment (complex verification logic, security invariants, subtle races).
- `invoke_subagent`'s `Model` values are harness tier aliases, not model names: currently `'flash'` selects Gemini Flash and `'pro'` selects Gemini 4 Argon. There is no Gemini Pro model. If the installed tool exposes a different value for Argon, use that value.
- Always pass `Model` explicitly. Never `'inherit'`.
- In the handoff packet and controller report, name the model (e.g. "Gemini 4 Argon (`Model: 'pro'`)"), not just the alias.
- If no exposed value maps to the intended model, use a supported one, report the actual model and the limitation, and do not claim the escalation happened.

Gemini 4 Argon (`gemini-4-argon-high`) is recommended for the controller.

Source read-only discipline during verification is governed by the shared verifier workflow rule in `docs/agents/verifier.md` ("Verification requires shell execution, build artifacts, and disposable mutation space; source read-only is a workflow rule, not a claim that a read-only OS sandbox can run every gate"), matching the practice for Codex CLI. Candidate source must remain untouched during independent verification, and disposable copies or temporary worktrees must be used for mutation checks.

## Other harnesses and cross-model handoffs

Open the repository in the chosen harness and explicitly ask it to read AGENTS.md, the protocol, and the required role. If it supports delegation, pass those files and the full contract to separate agents. Otherwise use fresh sessions and the explicit handoff packet in the protocol; a controller can prepare that packet for an operator to transfer. There is no universal tool DSL or automatic cross-provider routing here.

Record verification in the task's evidence file per the Evidence record rule in `docs/agents/protocol.md`.

The receiving verifier must obtain the exact candidate and implementation evidence, then execute its own checks. Do not reuse the implementer's conversation and rename its role. Missing execution, image viewing, or browser tooling is a recorded blocker, not permission to skip verification.

## Validate an installation

Static TOML/YAML parsing and reference checks prove adapter structure, not runtime discovery, tool availability, hook behavior, or model compliance. After installing/authenticating a local CLI, run a small existing contract through controller → implementer → fresh verifier, confirm the shared files were read, and record the CLI version, candidate revision, model when available, real outputs, and remaining human checks. If a CLI is unavailable, record its live smoke test as pending; do not claim every harness executed the workflow.

## Gate needs a reachable Docker daemon

`./scripts/verify.sh` ends with `./scripts/docker-smoke.sh`, which builds and runs the shipped image. It needs a reachable Docker daemon (OrbStack on macOS). If `docker info` fails in your environment (daemon stopped, or a sandbox without Docker socket access), the smoke fails with `docker smoke: Docker daemon is not reachable`; report the gate BLOCKED. Never skip, stub, or work around the step, and never edit `verify.sh` to do so.

## Sandboxes that block the Playwright browser download

The gate needs Playwright's pinned Chromium **and** WebKit. The steps below are written for Chromium; a blocked WebKit download fails the same way and has the same preferred fix. The Chromium-mapping fallback does not apply to WebKit: if WebKit can't be installed, phone-viewport checks are BLOCKED.

`./scripts/verify.sh` downloads Playwright's pinned Chromium and WebKit as part of the web e2e step (its `ensure_playwright_browsers` step runs `pnpm --filter web exec playwright install chromium webkit`, then `pnpm --filter web run test:e2e:playwright`). Some sandboxed agent environments — for example a Claude Code cloud session — block outbound access to `cdn.playwright.dev`, so that download fails and the gate cannot run from the documented steps alone. A sandboxed OpenCode session can hit the same block: same symptom, same preferred fix, same WebKit caveat. Do not improvise around this by weakening, skipping, or disabling the gate; use the fallback below, or get the block lifted.

### Symptom

```
Error: Download failed: server returned code 403 body '...'. URL: https://cdn.playwright.dev/builds/cft/<version>/<platform>/chrome-<platform>.zip
```

The same failure shows up for the `chromium-headless-shell` and `ffmpeg` sibling downloads that `apps/web`'s pinned `@playwright/test` also needs — same 403, different filename in the URL.

### Preferred fix

Ask the environment's owner (Mike, for a Claude Code cloud session) to allow `cdn.playwright.dev` in that sandbox's network policy. This is a setting on the sandbox/harness, not anything in this repo. Once it's allowed, the plain `pnpm --filter web exec playwright install chromium webkit` (what `scripts/verify.sh` already calls) downloads Chromium and WebKit itself and the fallback below isn't needed.

### Fallback: map a preinstalled Chromium into the expected layout

If `cdn.playwright.dev` can't be allowed, and the sandbox has *some* Chromium-family binary already available (a system/apt package, or an older Chromium a previous `@playwright/test` version already cached on the same machine/image), map it into the exact directory layout the pinned Playwright version (`apps/web/package.json`'s `@playwright/test`) expects, under a scratch `PLAYWRIGHT_BROWSERS_PATH` — never inside the default cache, and never by editing `scripts/verify.sh`, `apps/web/e2e/playwright.config.ts`, or the pinned `@playwright/test` version.

Copy-paste this from the repo root (written for a Linux x64 sandbox — the platform these blocked environments actually run):

```bash
#!/usr/bin/env bash
set -euo pipefail

# 0. An empty scratch directory Playwright will treat as its browsers cache.
#    Never point this at the real default cache.
export PLAYWRIGHT_BROWSERS_PATH="$(mktemp -d)"

# 1. Ask the pinned Playwright which exact revisions apps/web needs.
#    --dry-run makes no network request; it only prints the install plan.
DRYRUN="$(pnpm --filter web exec playwright install --dry-run chromium)"
echo "$DRYRUN"
CHROMIUM_DIR="$(echo "$DRYRUN" | grep -o 'chromium-[0-9]\+' | head -1)"
SHELL_DIR="$(echo "$DRYRUN" | grep -o 'chromium_headless_shell-[0-9]\+' | head -1)"
FFMPEG_DIR="$(echo "$DRYRUN" | grep -o 'ffmpeg-[0-9]\+' | head -1)"

# 2. Point these at whatever Chromium-family binaries already exist on this
#    host. CHROME_BIN/HEADLESS_SHELL_BIN can be the same binary — a plain
#    Chrome/Chromium build stands in fine for chrome-headless-shell; reuse
#    it if there's no dedicated headless_shell build. FFMPEG_DIR_SRC must be
#    an existing Playwright-style ffmpeg-<rev> directory (has its own
#    INSTALLATION_COMPLETE) — e.g. from an older cached revision.
: "${CHROME_BIN:?path to a Chrome/Chromium executable}"
: "${HEADLESS_SHELL_BIN:?path to a chrome-headless-shell-capable executable}"
: "${FFMPEG_DIR_SRC:?path to an existing Playwright-style ffmpeg-<rev> dir}"

mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/$CHROMIUM_DIR/chrome-linux64"
ln -s "$CHROME_BIN" "$PLAYWRIGHT_BROWSERS_PATH/$CHROMIUM_DIR/chrome-linux64/chrome"
touch "$PLAYWRIGHT_BROWSERS_PATH/$CHROMIUM_DIR/INSTALLATION_COMPLETE" \
      "$PLAYWRIGHT_BROWSERS_PATH/$CHROMIUM_DIR/DEPENDENCIES_VALIDATED"

mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/$SHELL_DIR/chrome-headless-shell-linux64"
ln -s "$HEADLESS_SHELL_BIN" "$PLAYWRIGHT_BROWSERS_PATH/$SHELL_DIR/chrome-headless-shell-linux64/chrome-headless-shell"
touch "$PLAYWRIGHT_BROWSERS_PATH/$SHELL_DIR/INSTALLATION_COMPLETE" \
      "$PLAYWRIGHT_BROWSERS_PATH/$SHELL_DIR/DEPENDENCIES_VALIDATED"

ln -s "$FFMPEG_DIR_SRC" "$PLAYWRIGHT_BROWSERS_PATH/$FFMPEG_DIR"

echo "Fallback browsers path ready: $PLAYWRIGHT_BROWSERS_PATH"
```

Then, in the same shell (so the `PLAYWRIGHT_BROWSERS_PATH` export survives), run the gate exactly as documented elsewhere — do not pass it any special flags:

```bash
./scripts/verify.sh
```

`scripts/verify.sh`'s own `ensure_playwright_browsers` step calls `pnpm --filter web exec playwright install chromium webkit` before the e2e suite; with the scratch directory above already populated and marked complete, that call recognizes the mapped Chromium as already installed and makes no network request for it (WebKit still needs its real download; see above), and `pnpm --filter web run test:e2e:playwright` then runs against the mapped binaries.

`chrome-linux64` / `chrome-headless-shell-linux64` are the directory names Playwright's own registry (`packages/playwright-core/src/server/registry/index.ts`'s `EXECUTABLE_PATHS`, vendored into `playwright-core`'s bundled `lib/coreBundle.js`) uses for a `linux-x64` host. A `linux-arm64` host uses `chrome-linux-arm64` / `chrome-headless-shell-linux-arm64` instead — same script, substitute those two directory names (`uname -m` tells you which you're on). Other host platforms (for example testing this fallback locally on macOS before relying on it in a Linux sandbox) use that same registry's own platform-specific names, which differ enough — a macOS Chrome-for-Testing build is a full, code-signed `.app` bundle, not a flat binary — that the whole platform subdirectory should be symlinked from an existing local Playwright cache instead of a single renamed executable file; `docs/tasks/evidence/T-135.md` records that variant and a real run of it.

### Limits

- The e2e suite then runs against whatever Chromium the fallback found, not the version CI downloads fresh — very likely an older Chromium than CI's. That's an accepted tradeoff to make the gate runnable at all in a sandbox that can't reach `cdn.playwright.dev`, not a substitute for actually running the pinned version somewhere that can.
- CI on GitHub is unaffected: it always installs the real pinned Chromium from `cdn.playwright.dev`.
- Evidence/reports produced this way must record which Chromium build actually ran — for example `"$CHROME_BIN" --version` alongside the pinned version the dry-run printed — since it's not the pinned one.
- Never edit `scripts/verify.sh`, `apps/web/e2e/playwright.config.ts`, or the pinned `@playwright/test` version to work around this; the fallback only ever adds files under a scratch `PLAYWRIGHT_BROWSERS_PATH`.
