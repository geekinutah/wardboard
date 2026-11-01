# B-074: Start-proposal e2e matches the Current radio as a substring

**Priority:** P3
**Area:** web e2e
**State:** candidate
**Found:** 2026-10-31, T-101 verification
**Promoted to:** —

## Finding

`apps/web/e2e/start-proposal.spec.ts` finds the source radio with `getByRole('radio', { name: 'Current' })`. Playwright treats that name as a case-insensitive substring. Duplicate sources are labeled `Duplicate "…"`. A proposal whose name contains "current" makes the locator match more than one radio, and the test fails with a strict-mode violation.

## Risk

A later e2e test that creates a proposal with "current" in the name can fail this unrelated spec. T-101 hit it and worked around it by naming its proposal `Phone profile locked`.

## Direction

Match that radio with `exact: true`. Do not change T-101's proposal name as the fix.

## Evidence

- `apps/web/e2e/start-proposal.spec.ts` line 46, `getByRole('radio', { name: 'Current' })`.
- T-101 verifier, round 1, candidate `24e8970`. The full e2e suite still passed `start a proposal from Current and land on its tab`.
