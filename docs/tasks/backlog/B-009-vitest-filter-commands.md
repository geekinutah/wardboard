# B-009: Contract test commands of the form `test -- <name>` do not filter

**Priority:** P2  
**Area:** task contracts  
**State:** candidate  
**Found:** 2026-10-26, T-007 implementer and verifier  
**Promoted to:** —

## Finding

`pnpm --filter <pkg> test -- <name>` runs `vitest run -- <name>`; Vitest ignores arguments after `--`, so the whole package suite runs. Contracts T-002, T-004, T-005 and T-007 use this form.

## Risk

Acceptance commands look file-specific but are not; a missing test file could go unnoticed if other tests pass.

## Direction

New contracts use `pnpm --filter <pkg> exec vitest run <path>` (adopted from T-008 onward). Optionally fix `_TEMPLATE.md`'s example row.

## Evidence

- `docs/tasks/evidence/T-007.md` (implementer Note 1, verifier C1–C4)
