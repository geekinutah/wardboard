# B-033: Summary page copy grammar: singular forms for collapsed row and divergence heading

**Priority:** P2  
**Area:** design tokens  
**State:** candidate  
**Found:** 2026-10-28, T-042 round-1 verifier  
**Promoted to:** —

## Finding

Two copy-grammar questions on the proposal summary page (T-042) surfaced from the binding contract templates, which the implementer followed literally:

1. The collapsed vacancies row renders `2 positions across 1 groups` in the preview (one org in the tail). The contract mandated the template `{count} positions across {k} groups` and the unit tests pin `groups: 1` for a single collapsed group; the artboard only shows the plural form ("7 positions across 5 groups").
2. The divergence heading uses a pluralization helper, so total 1 renders `1 difference` instead of the contract's literal `{total} differences` (invisible in the preview, which shows 3).

## Risk

Left undecided, every future copy pass re-litigates the same two phrasings, and the preview will keep showing visibly ungrammatical English (`1 groups`) to anyone who opens `/__preview/summary`.

## Direction

A design-doc decision: pick the copy rules (singular/plural for `k` and `count` in the collapsed row; singular/plural for the divergence total) and apply them to artboard 7, the contract template, and the code together.

## Evidence

- `apps/web/src/features/summary/Summary.tsx` (collapsed-row template; divergence heading helper)
- `apps/web/src/features/summary/rows.test.ts` (pins `groups: 1`)
- `docs/design/ui-canvas/Summary.dc.html` (plural-only examples)
- `docs/tasks/evidence/T-042.md`, round 1 implementer and verifier reports, Notes / blockers
