# B-012: Model has no place for Current's import date or proposal reopen audit

**Priority:** P1  
**Area:** core model  
**State:** candidate  
**Found:** 2026-10-26, T-007 verifier  
**Promoted to:** —

## Finding

SPEC §7 `CurrentBoard` includes an import date/version and §3 says to display the import date prominently; §3 (PROPOSED) records who accepted or reopened a proposal and when. The T-007 `Board` has only `version`, and `Proposal` records acceptance only.

## Risk

T-023 (persistence), T-025 (proposal lifecycle), T-041 and T-058 need these; deciding late means reshaping the model under several tasks.

## Direction

Before T-023: add import metadata (date, import version) to Current boards or a separate import record, and a reopen record on proposals, via a small model task.

## Evidence

- `docs/tasks/evidence/T-007.md` (verifier Note 4)
