# B-043: The server accepts two proposals with the same name

**Priority:** P3  
**Area:** server proposals  
**State:** candidate  
**Found:** 2026-10-28, T-084 verifier (round 2, mutation M1)  
**Promoted to:** —

## Finding

`createProposal` accepts a name that another proposal already has. The board then shows several tabs with that exact name. SPEC.md does not require proposal names to be unique. The unique-name rule there is about matching members.

## Risk

A later e2e test that finds a tab by exact name can hit a Playwright strict-mode violation instead of a clear server error. A person can also open two proposals they cannot tell apart from the tab label.

## Direction

Decide whether proposal names must be unique. If they must, reject the duplicate in `createProposal` with the server's message. If they must not, callers that look up a tab by name have to handle more than one match. Do not fold this into an e2e isolation change.

## Evidence

- T-084 mutation M1, `docs/tasks/evidence/T-084.md`: dropping `repeatEachIndex` from `uniqueProposalName` still created the proposals. `getByRole('tab', { name: 'Shell desktop-chromium t0', exact: true })` resolved to 5 elements. Stress run: 38 failed, 2 passed.
- `apps/web/e2e/support/proposals.ts` fails loudly only when the server rejects the create. A duplicate name is not a rejection today.
