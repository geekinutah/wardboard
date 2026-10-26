# B-004: parseConfig strips only one trailing slash

**Priority:** P2  
**Area:** server  
**State:** candidate  
**Found:** 2026-10-25, T-002 verifier  
**Promoted to:** —

## Finding

`parseConfig` removes a single trailing slash from `WARDBOARD_BASE_URL`. `http://h/` becomes `http://h`. `http://h//` is stored as `http://h/`, which still ends in a slash.

## Risk

Low. The contract's required case passes, and nothing in Milestone 1 consumes the base URL yet. A later caller that joins paths onto a slash-terminated base could double a slash.

## Direction

Strip every trailing slash, or reject a base URL that still has one after normalization. Cover `http://h//` with a test.

## Evidence

- `apps/server/src/config.ts` (trailing-slash normalization)
- `docs/tasks/evidence/T-002.md` (verifier Notes)
