# T-001: Monorepo bootstrap, automated environment setup, and quality gate

**Milestone:** 1 — Foundations
**Depends on:** none
**Spec refs:** SPEC.md §10 (TypeScript pnpm monorepo, portable, no Mac-only runtime dependencies), §16.1; AGENTS.md (Commands, Test stack, Testing rules, Parallel work); `docs/agents/README.md` (Stop hook contract for `scripts/verify-hook.sh`)

## Goal
A fresh clone becomes a working dev environment with one command (`./scripts/setup.sh`). The required toolchain is declared in machine-readable files in the repo, and `./scripts/verify.sh` is a single, concurrency-safe quality gate (toolchain check, frozen install, script self-tests, typecheck, lint, unit tests) that CI also runs on every push.

## Design decisions (binding for this task)
- **Toolchain declaration** (Node's equivalent of `requirements.txt`): `package.json` `packageManager` (`pnpm@12.4.2`) and `engines` (`node` `>=26.12.0 <27`, `pnpm` `>=12.4.2 <13`), `.node-version` containing `26.12.0` (read by fnm, mise, asdf-nodejs and `actions/setup-node`), `pnpm-lock.yaml` committed, `.npmrc` with `engine-strict=true`. Dependencies are pinned through the lockfile; `pnpm install --frozen-lockfile` is the only install form used by scripts and CI.
- **`scripts/env-check.mjs`**: dependency-free Node ESM (it runs before `pnpm install`). Reads the required versions from `.node-version` and the root `package.json` `packageManager`/`engines`; compares them with the running Node (`process.versions.node`) and `pnpm --version`. Exports a pure function `checkToolchain({ required, actual })` returning a list of problems (each naming the tool, required range, found version, and a fix hint); the CLI prints problems and exits 1 if any, else prints one OK line and exits 0. Missing `pnpm` is a problem, not a crash.
- **`scripts/setup.sh`**: `set -euo pipefail`; runs `node scripts/env-check.mjs`, then `pnpm install --frozen-lockfile`. Idempotent. Later tasks append steps (T-003 adds Playwright browser install; T-006 adds a Docker CLI check) — leave a clearly marked extension point.
- **`scripts/verify.sh`**: `set -euo pipefail`; in order: env check, `pnpm install --frozen-lockfile`, `node --test scripts/`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test`. Prints a labeled header per step and fails at the first failing step with that step's name. Uses no fixed ports and writes only inside the checkout (or `mktemp` dirs it removes), so two checkouts can run it at the same time. Leave a marked extension point after unit tests for T-003's e2e step.
- **`scripts/verify-hook.sh`**: harness Stop hook (Claude Code and Grok Build). Reads hook JSON from stdin; if `stop_hook_active` or `stopHookActive` is `true`, exits 0 without running anything (loop guard). Otherwise runs the verify command (default `./scripts/verify.sh`; overridable by env `WARDBOARD_VERIFY_CMD` for tests only); on success exits 0; on failure writes the last 60 lines of gate output to stderr and exits 2. Must not need `jq` (parse with `node`).
- **Workspace packages run TypeScript source directly.** Packages are ESM (`"type": "module"`) and export `./src/index.ts` via `exports`; Node 26 type-stripping and Vite consume source with no build step. Base tsconfig therefore sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`, `module`/`moduleResolution` `nodenext`, `target` `es2024`. Package names: `@wardboard/core` (later `@wardboard/server`, `@wardboard/web`); `pnpm --filter core …` must work.
- **Lint**: ESLint flat config at the root (`eslint.config.js`) with `typescript-eslint` strict type-checked rules for TS and `@vitest/eslint-plugin` with `no-focused-tests` and `no-disabled-tests` as errors (enforces AGENTS.md testing rule 5). Each package's `lint` script is `eslint .` with zero warnings allowed (`--max-warnings 0`). The `scripts/*.mjs` files are linted too (via a root-level lint step inside verify.sh or a root `lint` script invoked by the gate — either is acceptable, but they must be linted).
- **Core skeleton with one real behavior**: `packages/core/src/util/assert-never.ts` exporting `assertNever(value: never, message?: string): never`, which throws an `Error` whose message includes the JSON-serialized value (falls back to `String(value)` if serialization throws). Re-exported from `packages/core/src/index.ts`. This exists for exhaustive switches over operation kinds later.
- **CI**: `.github/workflows/ci.yml` on `push` and `pull_request`: checkout, install pnpm at the `packageManager` version (`pnpm/action-setup`, reading the version from `package.json`), `actions/setup-node` with `node-version-file: .node-version` and pnpm cache, then `./scripts/setup.sh` and `./scripts/verify.sh`. No secrets.
- **README**: a "Requirements and setup" section listing Node (from `.node-version`), pnpm (from `packageManager`), OrbStack (or any Docker engine — needed from T-006), and noting Playwright browsers are installed by setup from T-003; quick start is `./scripts/setup.sh` then `./scripts/verify.sh`. Point at the files rather than duplicating version numbers where practical.

## Scope
May change:
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, `.node-version`, `tsconfig.base.json`, `tsconfig.json` (root, if needed), `eslint.config.js`, `vitest.workspace.ts` or root `vitest.config.ts` (only if needed)
- `scripts/` (new: `env-check.mjs`, `setup.sh`, `verify.sh`, `verify-hook.sh`, and their `*.test.mjs` tests)
- `.github/workflows/ci.yml`
- `packages/core/` (new: `package.json`, `tsconfig.json`, `src/index.ts`, `src/util/assert-never.ts`, `test/util/assert-never.test.ts`, `vitest.config.ts` if needed)
- `.gitignore` (append only)
- `README.md` (add the "Requirements and setup" section only)

Must not change:
- `SPEC.md`, `AGENTS.md`, `docs/**`, `.claude/**`, `.codex/**`, `.grok/**`, `fixtures/**`, `HUMAN_BACKLOG.md`, anything else

New dependencies allowed (devDependencies, root or `packages/core`): `typescript`, `@types/node`, `eslint`, `@eslint/js`, `typescript-eslint`, `@vitest/eslint-plugin`, `globals`, `vitest`. Latest stable versions; recorded in the lockfile.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Fresh-clone setup works | in a fresh `git clone` of the candidate into a temp dir: `./scripts/setup.sh` | exits 0; prints env-check OK line; `node_modules/` created |
| 2 | Toolchain declared | `node -p "require('./package.json').packageManager"`; `cat .node-version`; `node -p "JSON.stringify(require('./package.json').engines)"` | `pnpm@12.4.2`; `26.12.0`; an object with `node` and `pnpm` ranges matching the design section |
| 3 | Env check passes on this machine | `node scripts/env-check.mjs` | exits 0 |
| 4 | Env check refuses a wrong Node | `node --test scripts/` | all tests pass, including the env-check cases below |
| 5 | Core test runs by scope-less filter | `pnpm --filter core test` | `assert-never.test.ts` passes (≥ 2 tests) |
| 6 | Core is importable as TS source with no build | `pnpm --filter core exec node -e "import('@wardboard/core').then(m => console.log(typeof m.assertNever))"` | prints `function` |
| 7 | Focused/skipped tests are lint errors | in a disposable copy, add `it.only(...)` to the core test, run `pnpm --filter core lint` | exits non-zero naming `no-focused-tests` |
| 8 | Strict TS is enforced | in a disposable copy, add `export function f(x) { return x; }` (implicit `any`) to `packages/core/src/index.ts`, run `pnpm -r typecheck` | exits non-zero |
| 9 | Gate passes | `./scripts/verify.sh` | exits 0; output shows each step header (env, install, scripts tests, typecheck, lint, test) |
| 10 | Gate fails loudly | in a disposable copy, break the core test's expected message, run `./scripts/verify.sh` | exits non-zero; last header printed is the unit-test step |
| 11 | Two gates at once don't collide | run `./scripts/verify.sh` concurrently in two separate worktrees of the candidate | both exit 0 |
| 12 | Hook loop guard and failure reporting | `node --test scripts/` | verify-hook tests below pass |
| 13 | CI workflow is well-formed | `node -e` script (or a `scripts/*.test.mjs` test) that parses `.github/workflows/ci.yml` text and asserts it references `.node-version`, `scripts/setup.sh`, and `scripts/verify.sh`, and triggers on `push` | passes |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `assertNever throws with the serialized value` (core, Vitest) | thrown `Error` message contains `{"kind":"bogus"}` for that input | returns instead of throwing; message omits the value |
| `assertNever uses a custom message prefix when given` | message starts with the supplied text and still contains the value | ignores the message argument |
| `assertNever survives unserializable values` | a value with a circular reference still throws an `Error` (not a `TypeError` from `JSON.stringify`) | lets `JSON.stringify` throw |
| `checkToolchain accepts matching versions` (`scripts/env-check.test.mjs`, `node:test`) | node 26.12.0 / pnpm 12.4.2 against the declared requirements → no problems | inverted comparison |
| `checkToolchain rejects an older Node` | node 24.11.0 → one problem naming node, required range, found version | only checks major ≥ |
| `checkToolchain rejects the next Node major` | node 27.0.0 → problem | missing upper bound |
| `checkToolchain rejects a different pnpm major` | pnpm 11.9.0 and 13.0.0 → problems | pnpm not checked |
| `checkToolchain reports missing pnpm` | `pnpm: null` → problem with an install hint, no throw | crashes on null |
| `checkToolchain reads requirements from repo files` | requirements derived from a temp dir's `.node-version` + `package.json` match those files (change the file, the requirement changes) | hard-coded versions |
| `verify-hook exits 0 without running the gate when stop_hook_active is true` (`scripts/verify-hook.test.mjs`) | with `WARDBOARD_VERIFY_CMD` pointing at a script that writes a marker file, stdin `{"stop_hook_active":true}` → exit 0, no marker | guard missing |
| `verify-hook honors Grok's stopHookActive` | stdin `{"stopHookActive":true}` → exit 0, no marker | only the snake_case key checked |
| `verify-hook exits 0 when the gate passes` | stdin `{}`, fake command exits 0 → exit 0, marker present | inverted exit code |
| `verify-hook exits 2 with output tail when the gate fails` | fake command prints 100 numbered lines then exits 1 → hook exits 2, stderr contains line 100 and not line 1 | exits 1; no tail; dumps everything |
| `verify-hook tolerates empty or invalid stdin` | empty stdin and `not json` → runs the gate (treated as not active), no crash | crash on parse |
| `ci workflow runs setup and verify` | structural check from criterion 13 | workflow drops the gate step |

## Edge cases (each needs a test)
- Missing `pnpm` binary (env-check).
- Prerelease/odd version strings like `v26.12.0` (leading `v`) and `26.12.0-nightly` parse without crashing (env-check; the nightly may be accepted or rejected but the result must be deterministic and tested).
- Empty / malformed hook stdin (verify-hook).
- Circular value passed to `assertNever`.

## Human checks
none (Mike may optionally run `./scripts/setup.sh` on the Mac Studio, but nothing here is subjective).

## Out of scope
- `apps/server`, `apps/web`, Playwright, Docker (T-002, T-003, T-006).
- Any domain model in `packages/core` beyond `assertNever` (T-007).
- Prettier or other formatters.
- Editing docs other than the README section.
