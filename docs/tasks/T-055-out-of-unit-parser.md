# T-055: Out-of-Unit Callings parser

**Milestone:** 6 — Import and photos
**Depends on:** T-052 (PDF extraction harness — `done`).
- Runs in parallel with T-053 and T-054. Each owns its own `src/reports/*` files and test file. The only shared file is the barrel `packages/importer/src/index.ts`, where each task adds exactly one export line; the controller resolves that one-line conflict at merge.

**Spec refs:** SPEC.md §7 (ExternalCalling: brief member-linked context, not a ward placement), §14 "Supplied PDF sample inspection" (three sections, different columns per section; the middle section has serving unit plus calling; **external service must not be mistaken for a local ward placement because its title names a ward role**; keep multiple external callings per member; **Living outside of Unit needs a nonempty sample or an explicit mapping decision before its handling can be verified**), §15 (deterministic; allow-list; actionable errors, never guessed rows).

## Goal
`parseOutOfUnitReport(doc)` turns an extracted Out-of-Unit Callings PDF into external-calling records: member display name, calling title, the section it came from, and the serving unit where the report gives one. Sustained dates and unit numbers are dropped. Every section's rows are reconciled against its `Count: N`. The output type has no way to express a ward placement. A non-empty Living outside of Unit section is refused with a typed error until Mike decides how to map it.

## Design decisions (binding)

### Files
- `packages/importer/src/reports/out-of-unit.ts` — parser and its error class.
- `packages/importer/src/index.ts` — add exactly one line: `export * from './reports/out-of-unit.ts';`.
- `packages/importer/test/out-of-unit-report.test.ts` — tests.

Do not create a shared `reports/index.ts` or shared error module (T-053 and T-054 run in parallel).

### Public API
```ts
import type { PdfDocument } from '../pdf/index.ts';

export type OutOfUnitReportErrorCode =
  | 'WRONG_REPORT'
  | 'COUNT_MISMATCH'
  | 'UNRECOGNIZED_LAYOUT'
  | 'UNSUPPORTED_SECTION';

export class OutOfUnitReportError extends Error {
  readonly code: OutOfUnitReportErrorCode;
  readonly page: number; // 1-based
  constructor(code: OutOfUnitReportErrorCode, page: number, message: string);
}

export type OutOfUnitSection = 'stake' | 'serving-outside-unit';

export interface ExternalCallingRecord {
  readonly section: OutOfUnitSection;
  /** Display name exactly as printed, e.g. 'Melford, Leo'. */
  readonly name: string;
  /** Calling title exactly as printed. */
  readonly calling: string;
  /** 'Serving in Unit' value for 'serving-outside-unit' (e.g. 'Cedar Peak Utah Temple'); null for 'stake'. */
  readonly servingUnit: string | null;
}

export interface OutOfUnitReport {
  readonly kind: 'out-of-unit';
  /** Unit name with the unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** Report date from the footer as ISO `YYYY-MM-DD`. */
  readonly reportDate: string;
  /** Report order: all Stake Callings rows, then Serving outside of assigned unit rows. */
  readonly externalCallings: readonly ExternalCallingRecord[];
}

export function parseOutOfUnitReport(doc: PdfDocument): OutOfUnitReport;
```

### Layout rules (observed in `fixtures/lcr-reports/out-of-unit-callings.pdf`, 1 page)
1. `doc.title` must be exactly `'Out-of-Unit Callings'`, else `WRONG_REPORT` (page 1).
2. Ignore rows with `y < 30` (unit, title, stake) and `y > 770` (footer). `unitName` from the header item `'Cedar 14th Ward (100001)'` → `'Cedar 14th Ward'`; `reportDate` from the footer `'25 Oct 2026'` → `'2026-10-25'` (accept `D Mon YYYY` and `Month D, YYYY`). Missing either → `UNRECOGNIZED_LAYOUT`.
3. Sections are identified by their exact header text, not position: `Stake Callings`, `Serving outside of assigned unit`, `Living outside of Unit`. All three must be present, each followed by its own bold column header row and closed by `Count: N`. A missing section, an unknown section header, or a data row outside a section → `UNRECOGNIZED_LAYOUT`.
4. Columns are located from each section's own bold header row by `x`:
   - Stake Callings: `Calling / Name / Sustained` → `calling`, `name`, `servingUnit: null`.
   - Serving outside of assigned unit: `Serving in Unit / Calling / Name / Sustained` → `servingUnit`, `calling`, `name`.
   - Living outside of Unit: `Calling / Name / Sustained`. If its `Count:` is greater than 0 (or any data row appears), throw `UNSUPPORTED_SECTION` with a message saying the section needs a mapping decision. Do not return its rows.
5. The Sustained column is read only to recognize the column and is dropped. No logging.
6. Each section's row count must equal its `Count: N`, else `COUNT_MISMATCH` naming the section (no personal values in the message).
7. Rows are records, not placements: never merge duplicates. A member with two out-of-unit callings produces two records.
8. Deterministic.

### Expected fixture result (counts match T-052's verified extraction; your tests must assert them)
- `unitName: 'Cedar 14th Ward'`, `reportDate: '2026-10-25'`.
- 37 records: 11 `stake`, then 26 `serving-outside-unit`. Living outside of Unit has `Count: 0` and parses cleanly.
- First stake record: `{ section: 'stake', name: 'Melford, Leo', calling: 'Stake Sports Specialist', servingUnit: null }`.
- First serving record: `{ section: 'serving-outside-unit', name: 'Lynton, Piper', calling: 'Stake Activities Committee Member', servingUnit: 'Lakeview Utah YSA 3rd Stake' }`. Last: `Dalton, Lois` / `Temple Worker` / `Cedar Peak Utah Temple`.
- `Ivydale, Ryder` has two serving records: `Bishop` and `Priests Quorum President`, both with `servingUnit: 'Lakeview Married Student 8th Ward'`.
- `Birchwood, Edie` has two stake records (`FamilySearch Center Coordinator`, `Stake Temple and Family History Consultant`).
- If your parser disagrees, do not change the test to match. Report the evidence under Notes / blockers.

## Scope
May change:
- `packages/importer/src/reports/out-of-unit.ts` (new)
- `packages/importer/src/index.ts` (add the one export line only)
- `packages/importer/test/out-of-unit-report.test.ts` (new)

Must not change:
- `packages/importer/src/pdf/**`, existing tests, `packages/importer/package.json`, `fixtures/**`, `packages/core/**`, `apps/**`, `docs/**`, `scripts/**`, other `src/reports/*` files, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Parser tests | `pnpm --filter @wardboard/importer exec vitest run test/out-of-unit-report.test.ts` | exits 0; every test listed below passes |
| 2 | Package scripts | `pnpm --filter @wardboard/importer test && pnpm --filter @wardboard/importer typecheck && pnpm --filter @wardboard/importer lint` | exits 0, 0 warnings |
| 3 | Fixtures untouched | `git diff main --stat -- fixtures` | empty output |
| 4 | No logging in the parser | `grep -nE "console\.|process\.std" packages/importer/src/reports/out-of-unit.ts` | no output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
In `packages/importer/test/out-of-unit-report.test.ts`. Extract the fixture once; build error cases by copying the `PdfDocument` and editing rows. For the non-empty Living outside of Unit case, insert a three-item row (`Calling`, `Name`, `Sustained` columns at the header's `x` values, fictional text) and change `Count: 0` to `Count: 1`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `reads unit name and report date` | values above; no `100001`/`200002` in the output | unit number kept |
| `parses 11 stake and 26 serving-outside-unit records in report order` | counts, first/last records above | one fixed table for the whole page; Count rows parsed as records |
| `uses each section's own columns` | stake records have `servingUnit: null`; serving records' `servingUnit` is the left column and `calling` the second | serving unit read as the calling; columns shifted |
| `keeps ward-role titles as external records` | `Ivydale, Ryder`'s `Bishop` record has `section: 'serving-outside-unit'` and the Lakeview unit; the result type has no placement field | external Bishop treated as a ward calling |
| `keeps multiple callings for one member` | Ivydale (2 serving) and Birchwood Edie (2 stake) | de-duplication by name |
| `drops sustained dates` | `JSON.stringify(report)` contains none of `May 2026`, `Aug 2021`, `Sustained`; `Object.keys` of each record is exactly `['section','name','calling','servingUnit']` | dates carried along |
| `accepts an empty Living outside of Unit section` | fixture parses with no error and no third-section records | Count: 0 section treated as an error |
| `refuses a non-empty Living outside of Unit section` | edited copy throws `UNSUPPORTED_SECTION`; message contains `mapping decision` and not the inserted name | rows silently mapped or dropped |
| `rejects another report as WRONG_REPORT` | the extracted `members-without-callings.pdf` throws `WRONG_REPORT` | empty result instead of error |
| `throws COUNT_MISMATCH when a row is missing` | delete one serving row → `COUNT_MISMATCH` mentioning `Serving outside of assigned unit` | count unchecked |
| `throws UNRECOGNIZED_LAYOUT when a section header is missing or unknown` | (a) remove the `Stake Callings` header; (b) rename it `Ward Callings` | guessed section; rows attached to the wrong section |
| `is deterministic` | two parses `toStrictEqual` | shared state |

## Edge cases (each needs a test)
Covered above: empty section, non-empty unsupported section, sections with different column sets, duplicate member names, ward-role titles in external service, wrong report, missing row, missing or unknown section header.

## Human checks
none

## Out of scope
- Deciding how Living outside of Unit rows map (open question for Mike; this task refuses them).
- Linking records to members (T-057) and storing them as `ExternalCalling` (T-058).
- Cross-parser allow-list and canary checks (T-056).
