# B-011: createProposal keeps unknown `accepted` keys and allows shared board ids

**Priority:** P2  
**Area:** core model  
**State:** candidate  
**Found:** 2026-10-26, T-007 verifier  
**Promoted to:** —

## Finding

`createProposal` shallow-spreads `accepted` (`packages/core/src/model/proposal.ts:101`), so extra keys survive, unlike every other constructor's fresh copy. A proposal's baseline and board may also share the same board id.

## Risk

Low: inconsistent copy policy; ambiguous board identity if persistence keys by board id.

## Direction

Copy only `by`, `at`, `summary`; reject equal baseline/board ids with `invalid_field`.

## Evidence

- `docs/tasks/evidence/T-007.md` (verifier Notes 2–3)
