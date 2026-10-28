# T-054: Members without Callings parser

**Milestone:** 6 — Import and photos
**Depends on:** T-052 (PDF extraction harness — `done`).
- Runs in parallel with T-053 and T-055. Each owns its own `src/reports/*` files and test file. The only shared file is the barrel `packages/importer/src/index.ts`, where each task adds exactly one export line; the controller resolves that one-line conflict at merge.

**Spec refs:** SPEC.md §2 (Primary children out of scope), §7 (Member: no contact details or date of birth), §8, §14 "Supplied PDF sample inspection" (Without Callings is not a complete roster), §15 (deterministic parsing; allow-list; **age 18+ adult, 11–17 youth, under 11 not imported as candidates; age used only during import and then discarded**; no Church identifiers; actionable errors, never guessed rows).

## Goal
`parseWithoutCallingsReport(doc)` turns an extracted Members without Callings PDF into candidate members with only a display name and an `adult`/`youth` category. Gender, age, birth date and phone number are read only long enough to classify and are not in the output. Members under 11 are excluded and only counted. The row count is reconciled against `Count: N`.

## Design decisions (binding)

### Files
- `packages/importer/src/reports/without-callings.ts` — parser and its error class.
- `packages/importer/src/index.ts` — add exactly one line: `export * from './reports/without-callings.ts';`.
- `packages/importer/test/without-callings-report.test.ts` — tests.

Do not create a shared `reports/index.ts` or shared error module (T-053 and T-055 run in parallel).

### Public API
```ts
import type { PdfDocument } from '../pdf/index.ts';

export type WithoutCallingsReportErrorCode = 'WRONG_REPORT' | 'COUNT_MISMATCH' | 'UNRECOGNIZED_LAYOUT';

export class WithoutCallingsReportError extends Error {
  readonly code: WithoutCallingsReportErrorCode;
  readonly page: number; // 1-based
  constructor(code: WithoutCallingsReportErrorCode, page: number, message: string);
}

export type MemberCategory = 'adult' | 'youth';

export interface WithoutCallingsCandidate {
  /** Display name exactly as printed, e.g. 'Kelley, Kaia'. */
  readonly name: string;
  readonly category: MemberCategory;
}

export interface WithoutCallingsReport {
  readonly kind: 'without-callings';
  /** Unit name with the unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** Report date from the footer as ISO `YYYY-MM-DD`. */
  readonly reportDate: string;
  /** Rows listed in the report (equals the `Count: N` footer). */
  readonly listedCount: number;
  /** Rows dropped because the member is under 11. No names are kept for them. */
  readonly excludedUnder11: number;
  /** Adults and youth in report order. */
  readonly candidates: readonly WithoutCallingsCandidate[];
}

export function parseWithoutCallingsReport(doc: PdfDocument): WithoutCallingsReport;

/** The SPEC §15 mapping. Exported so T-057 and the server can share one rule. */
export function categoryForAge(age: number): MemberCategory | 'excluded';
```
`categoryForAge`: integer `age >= 18` → `'adult'`; `11 <= age <= 17` → `'youth'`; `0 <= age < 11` → `'excluded'`. A negative, non-integer, or non-finite age throws `RangeError`.

### Layout rules (observed in `fixtures/lcr-reports/members-without-callings.pdf`, 4 pages)
1. `doc.title` must be exactly `'Members without Callings'`, else `WRONG_REPORT` (page 1).
2. Ignore rows with `y < 30` and `y > 775` (header and footer). The page-1 header item is `'Cedar 14th Ward (100001) Cedar Utah Stake (200002)'`; `unitName` is the text before the first ` (`. `reportDate` comes from the page-1 footer `'October 25, 2026'` → `'2026-10-25'` (accept `Month D, YYYY` and `D Mon YYYY`). Missing either → `UNRECOGNIZED_LAYOUT`.
3. Each page has a table header row `Name / Gender / Age / Birth Date / Phone Number` (repeated at the top of pages 2–4). Locate columns by the header items' `x`, not fixed numbers. Header row missing on a page that has member rows → `UNRECOGNIZED_LAYOUT`.
4. Member rows: name in the Name column, age in the Age column (digits only). The phone cell is often absent. A member row whose age cell is missing or not `^\d+$` → `UNRECOGNIZED_LAYOUT` (with page; message carries no personal values).
5. `Count: N` on the last page closes the table. Rows counted across all pages must equal `N`, else `COUNT_MISMATCH`. Missing `Count:` → `UNRECOGNIZED_LAYOUT`.
6. The age is converted with `categoryForAge` and then dropped. No gender, age, birth date, or phone value is stored in any field, intermediate array kept on the result, or error message. No logging.
7. Deterministic.

### Expected fixture result (controller computed these from the T-052 rows; your tests must assert them)
- `unitName: 'Cedar 14th Ward'`, `reportDate: '2026-10-25'`, `listedCount: 145`.
- 90 adults, 22 youth, `excludedUnder11: 33`, so 112 candidates. No duplicate names.
- First candidates: `Kelley, Kaia` (adult), `Kelley, Talia` (adult), `Lynton, Joy` (adult). Last candidate: `Dalton, Hal` (adult).
- Boundaries present in the fixture: `Harley, Brielle Bea` (10, excluded), `Holwood, Opal` (11, youth), `Fairfield, Neal Dean` (17, youth), `Fairby, Kent` (18, adult).
- If your parser disagrees, do not change the test to match. Report the evidence under Notes / blockers.

## Scope
May change:
- `packages/importer/src/reports/without-callings.ts` (new)
- `packages/importer/src/index.ts` (add the one export line only)
- `packages/importer/test/without-callings-report.test.ts` (new)

Must not change:
- `packages/importer/src/pdf/**`, existing tests, `packages/importer/package.json`, `fixtures/**`, `packages/core/**`, `apps/**`, `docs/**`, `scripts/**`, other `src/reports/*` files, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Parser tests | `pnpm --filter @wardboard/importer exec vitest run test/without-callings-report.test.ts` | exits 0; every test listed below passes |
| 2 | Package scripts | `pnpm --filter @wardboard/importer test && pnpm --filter @wardboard/importer typecheck && pnpm --filter @wardboard/importer lint` | exits 0, 0 warnings |
| 3 | Fixtures untouched | `git diff main --stat -- fixtures` | empty output |
| 4 | No logging in the parser | `grep -nE "console\.|process\.std" packages/importer/src/reports/without-callings.ts` | no output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
In `packages/importer/test/without-callings-report.test.ts`. Extract the fixture once; build error cases by copying the `PdfDocument` and editing rows.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `reads unit name, report date and listed count` | values above; output has no `100001`/`200002` | stake kept in the unit name; count not read |
| `classifies 90 adults and 22 youth and excludes 33 under 11` | counts above; `candidates.length === 112`; `listedCount === candidates.length + excludedUnder11` | under-11 kept; youth/adult boundary wrong |
| `keeps report order across page breaks` | first three and last candidate as above; `Birchwood, Hallie` (adult, second row of page 2) comes right after `Gilley, Ky Lila` (youth, last page-1 candidate); `Gilley, Iris Velma` (7, first row of page 2) is absent | page 2–4 rows dropped or reordered; repeated header parsed as a member |
| `applies the 10/11/17/18 boundaries to fixture members` | Harley (absent), Holwood Opal (youth), Fairfield Neal Dean (youth), Fairby Kent (adult) | `>` vs `>=` off-by-one |
| `categoryForAge maps the SPEC boundaries and rejects bad ages` | 0, 10 → excluded; 11, 17 → youth; 18, 99 → adult; -1, 10.5, NaN → `RangeError` | off-by-one; silent coercion |
| `candidate objects carry only name and category` | `Object.keys` of every candidate is exactly `['name', 'category']`; `Object.keys(report)` is exactly the seven listed fields | gender/age left on the object |
| `never emits gender, age, birth date or phone values` | `JSON.stringify(report)` contains none of `555`, `Birth`, `Gender`, `1974`, `31 Jan 1974`, `"F"`, `"M"`, and no excluded member's name (`Harley, Brielle Bea`, `Elmfield, Paige Ida`) | disallowed fields kept; under-11 names kept |
| `rejects another report as WRONG_REPORT` | the extracted `out-of-unit-callings.pdf` throws `WithoutCallingsReportError` `WRONG_REPORT` | empty result instead of error |
| `throws COUNT_MISMATCH when a member row is missing` | delete one member row on page 3 → `COUNT_MISMATCH`; the message has no member name | count unchecked; name in error |
| `throws UNRECOGNIZED_LAYOUT for a missing age, a missing header, and a missing Count` | three edited copies | guessed row; silent truncation |
| `is deterministic` | two parses `toStrictEqual` | shared state |

## Edge cases (each needs a test)
Covered above: age boundaries 10/11/17/18, invalid ages, missing phone cells (most rows), repeated headers on pages 2–4, wrong report, missing row, missing age, missing header, missing Count.

## Human checks
none

## Out of scope
- Matching candidates to existing members or to the organizations report (T-057).
- Cross-parser allow-list and canary checks (T-056).
- Organizations (T-053) and Out-of-Unit (T-055) parsers.
