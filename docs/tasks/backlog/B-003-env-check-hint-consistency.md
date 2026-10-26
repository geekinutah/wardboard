# B-003: env-check hint can contradict engines.node

**Priority:** P2  
**Area:** tooling  
**State:** candidate  
**Found:** 2026-10-25, T-001 verifier  
**Promoted to:** —

## Finding

When `.node-version` and `engines.node` disagree, `scripts/env-check.mjs` suggests installing the `.node-version` version even if that version is outside the `engines` range (observed "Install Node 26.12.0" with range `>=99 <100`).

## Risk

Low: a repo test keeps the two declarations consistent today, but a careless bump could produce a misleading fix hint.

## Direction

Have env-check (or its tests) assert that `.node-version` satisfies `engines.node`.

## Evidence

- `docs/tasks/evidence/T-001.md` (verifier Notes)
