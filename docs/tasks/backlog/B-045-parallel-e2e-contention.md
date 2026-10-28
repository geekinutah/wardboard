# B-045: e2e tests fail when two worktrees run Playwright at once

**Priority:** P2  
**Area:** web e2e / quality gate  
**State:** accepted  
**Found:** 2026-10-28, T-086 implementer round 1  
**Promoted to:** T-091

## Finding

`apps/web/e2e/editing.spec.ts:107` and `:134` (desktop-chromium drag tests) failed during a full `./scripts/verify.sh` while another worktree's Playwright run was active. Run alone, `playwright test e2e/editing.spec.ts --project=desktop-chromium` passed 4/4. The same thing then happened on specs that don't drag: `out-of-unit.spec.ts:3` (T-086 round 2, passed 4/4 alone) and `proposals.spec.ts:14` (T-089 verification).

The runs do not share a browser, a server or data. Each `playwright test` launches its own headless browsers, and `global-setup.ts` starts a server for that checkout only, on an ephemeral port with its own temporary data directory. They share the CPU. `apps/web/e2e/playwright.config.ts` sets no `workers`, so each run uses Playwright's default of half the logical cores (8 on a 16-core Mac). Two gates at once means about 16 headless browsers plus two servers and builds. The likely cause is CPU contention: timing-sensitive steps (fixed-step mouse drags, the default 5 s `expect` timeout) miss under load.

## Risk

AGENTS.md and `docs/agents/controller.md` say parallel worktree gates must be concurrency-safe. Gates that fail at random when controllers run in parallel cost rounds and erode trust in the gate.

## Direction

Decided with Mike on 2026-10-28: a machine-wide pool of Playwright worker slots, enforced by a small Perl wrapper. All of the logic lives in the wrapper.

- 2 fixed slots of 6 workers each (12 workers, 75% of a 16-core Mac). No per-caller sizing: every caller gets exactly one slot and runs with `--workers=6`.
- One lock file per slot in a fixed shared directory outside every checkout. The wrapper tries each slot with a non-blocking `flock`, retries every second when all are taken, then `exec`s Playwright with the lock still held. The OS releases the lock when Playwright exits or dies. Lock files are created when missing and never deleted. The wrapper is idempotent and needs no setup or cleanup.
- `test:e2e:playwright` and `gui:capture` call the wrapper. Nothing else in the gate changes: no sharding, no config change.
- Rejected alternatives: raising timeouts; a global lock that runs e2e steps one at a time; a remote browser pool; per-worker locks inside Playwright; per-caller `--want` sizing; one-worker slots with `--shard` (needs a gate overhaul).

## Evidence

- docs/tasks/evidence/T-086.md, round 1 note 3 and round 2 AC5 run 1
- docs/tasks/evidence/T-089.md, verifier notes (`proposals.spec.ts:14`)
- `apps/web/e2e/playwright.config.ts` (no `workers` setting), `apps/web/e2e/checkout-server.ts` (ephemeral port, `mkdtemp` data directory)
