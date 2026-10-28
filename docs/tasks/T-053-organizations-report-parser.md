# T-053: Callings by Organization parser

**Milestone:** 6 — Import and photos
**Depends on:** T-052 (PDF extraction harness — `done`).
- Runs in parallel with T-054 and T-055. Each owns its own `src/reports/*` files and test file. The only shared file is the barrel `packages/importer/src/index.ts`, where each task adds exactly one export line; the controller resolves that one-line conflict at merge.
- No shared files with in-flight web tasks (T-037, T-040, T-041, T-042, T-046, T-047) or T-063.

**Spec refs:** SPEC.md §7 (CallingGroup, CallingAssignment with standard/custom origin, vacancies), §8 (Import and replacement), §14 "Replacement organization PDF inspection" (95 "Calling Vacant" markers; roster sections are not placements; carry context across page breaks), §15 (deterministic parsing; allow-list: names, organization/calling structure, placements and vacancies only; no Church identifiers; actionable errors for unknown layouts, never guessed rows).

## Goal
`parseOrganizationsReport(doc)` turns an extracted Organizations and Callings PDF (`extractPdf` output) into organizations → groups → positions, each position occupied by a display name or vacant. Member-roster sections, contact fields, dates, set-apart marks, room numbers and unit numbers never appear in the output. Every calling table's row count is reconciled against its `Count: N` footer, and an unrecognized layout throws a typed error.

## Design decisions (binding)

### Files
- `packages/importer/src/reports/organizations.ts` — parser and its error class.
- `packages/importer/src/reports/organizations-types.ts` (optional) — output types, if you want them separate.
- `packages/importer/src/index.ts` — add exactly one line: `export * from './reports/organizations.ts';`.
- `packages/importer/test/organizations-report.test.ts` — tests.

Do not create a shared `reports/index.ts` or shared error module (T-054 and T-055 run in parallel and would collide).

### Public API
```ts
import type { PdfDocument } from '../pdf/index.ts';

export type OrganizationsReportErrorCode = 'WRONG_REPORT' | 'COUNT_MISMATCH' | 'UNRECOGNIZED_LAYOUT';

export class OrganizationsReportError extends Error {
  readonly code: OrganizationsReportErrorCode;
  /** 1-based page where the problem was detected. */
  readonly page: number;
  constructor(code: OrganizationsReportErrorCode, page: number, message: string);
}

export interface OrganizationsReport {
  readonly kind: 'organizations';
  /** Unit name from the page header with the parenthesized unit number removed, e.g. 'Cedar 14th Ward'. */
  readonly unitName: string;
  /** Report date from the page footer as ISO `YYYY-MM-DD`, e.g. '2026-10-25'. */
  readonly reportDate: string;
  readonly organizations: readonly ReportOrganization[];
}

export interface ReportOrganization {
  readonly name: string;                       // e.g. 'Elders Quorum'
  readonly groups: readonly ReportGroup[];     // document order
}

export interface ReportGroup {
  /** Bold group heading, e.g. 'Teachers', 'Valiant 10, Valiant 9'. When an organization's calling table follows its organization heading directly (Bishopric, Ward Missionaries, Temple and Family History, Young Single Adult), the group name equals the organization name. */
  readonly name: string;
  readonly positions: readonly ReportPosition[]; // table row order
}

export interface ReportPosition {
  /** Calling title with any leading custom marker '* ' removed. */
  readonly title: string;
  /** True when the row's title begins with the report's custom-calling marker '* '. */
  readonly custom: boolean;
  /** Display name exactly as printed ('Last, First Middle'), or null when the row is the italic 'Calling Vacant' marker. */
  readonly occupant: string | null;
}

export function parseOrganizationsReport(doc: PdfDocument): OrganizationsReport;
```
The output object is the only output; the parser does no logging and writes nothing.

### Layout rules (observed in `fixtures/lcr-reports/organizations-and-callings.pdf`)
Use `page.rows` from `extractPdf`. Coordinates below are top-down points.
1. **Report identity.** `doc.title` must be exactly `'Organizations and Callings'`, otherwise throw `WRONG_REPORT` (page 1).
2. **Page furniture.** Ignore rows with `y < 30` (unit/stake/title header) and rows with `y > 775` (footer: date, copyright, page number). `unitName` comes from the page-1 header item matching `/^(.+?) \(\d+\)$/` that is not the stake (the first such item on page 1; the stake line ends in `Stake (…)`). `reportDate` comes from the page-1 footer date item (`25 Oct 2026` → `2026-10-25`; accept `D Mon YYYY` and `Month D, YYYY`). Missing either → `UNRECOGNIZED_LAYOUT`.
3. **Headings** are rows whose first item sits at the left margin (`x` within 2 pt of the first `Calling` header's `x`, ≈35) and that have one item, or one item plus a `Room: …` item (dropped). Footnote rows whose text starts with `*` (`* custom calling`, `** Unbaptized…`, `* out of default class assignment`) are ignored, not headings.
   - If the next non-furniture row is a bold `Name` table header, the heading starts a **member-roster section** (whatever its boldness).
   - Else if the heading is not bold, it starts a new **organization**.
   - Else (bold) it names the next **group** in the current organization.
4. **Calling table header**: a row whose first item is bold `Calling` (columns `Calling / Name / Sustained / Set Apart`). It opens a calling table for the pending group, or for an implicit group named after the organization when no group heading is pending. A header repeated at the top of the next page continues the same table (no new group).
5. **Calling rows**: rows inside a calling table. Item 0 is the title; item 1 is either the italic `Calling Vacant` marker (→ `occupant: null`) or the name. All further items (sustained date, `✓`) are discarded.
6. **Member-roster tables**: header row with bold `Name` first (`Name / [Gender /] Age / Birth Date / Phone Number / Email`). Every row until its `Count:` footer is skipped entirely — nothing from it reaches the output, including names.
7. **`Count: N`** closes the current table. For calling tables, if the number of calling rows since the header (across page breaks) differs from `N`, throw `COUNT_MISMATCH` naming the group (no personal values in the message). Roster tables are counted the same way and also throw `COUNT_MISMATCH` on mismatch (proves the parser saw the whole roster and did not misfile its rows as callings).
8. A data row outside any table, a calling row whose second item is missing, a table that is never closed by `Count:`, or a calling table with no organization → `UNRECOGNIZED_LAYOUT` with the page number.
9. Deterministic: same input, deep-equal output. No `Date.now()`, randomness, or locale-dependent formatting.

### Expected fixture result (controller computed these with a throwaway prototype on the T-052 rows; your tests must assert them)
- `unitName: 'Cedar 14th Ward'`, `reportDate: '2026-10-25'`.
- 11 organizations, in order: `Bishopric, Elders Quorum, Relief Society, Aaronic Priesthood Quorums, Young Women, Sunday School, Primary, Ward Missionaries, Temple and Family History, Young Single Adult, Other Callings`.
- Group counts per organization: `1, 5, 5, 8, 8, 11, 10, 1, 1, 1, 7` (58 groups total, matching T-052's 58 calling tables).
- Positions per organization: `9, 17, 24, 31, 39, 25, 33, 5, 15, 4, 42` (244 total); vacant per organization `1, 6, 5, 9, 21, 5, 10, 1, 6, 2, 29` (95 total, matching the 95 italic markers); 149 occupied; 129 distinct occupant names; 31 custom positions, 21 of them vacant.
- Bishopric group `Bishopric` begins `Bishop / Stanley, Zed`, `Bishopric First Counselor / Holwood, Wade`, `Bishopric Second Counselor / Marwell, Jonah`, and its 6th position is `Ward Assistant Executive Secretary` vacant.
- Elders Quorum groups: `Elders Quorum Presidency, Teachers, Ministering, Activities, Service`.
- If your parser disagrees with any of these numbers, do not change the test to match your parser. Inspect the rows; if you believe a number above is wrong, report it under Notes / blockers with evidence.

## Scope
May change:
- `packages/importer/src/reports/organizations.ts` (new)
- `packages/importer/src/reports/organizations-types.ts` (new, optional)
- `packages/importer/src/index.ts` (add the one export line only)
- `packages/importer/test/organizations-report.test.ts` (new)

Must not change:
- `packages/importer/src/pdf/**`, `packages/importer/test/pdf-extract.test.ts`, `packages/importer/package.json`, `fixtures/**`, `packages/core/**`, `apps/**`, `docs/**`, `scripts/**`, other `src/reports/*` files, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Parser tests | `pnpm --filter @wardboard/importer exec vitest run test/organizations-report.test.ts` | exits 0; every test listed below passes |
| 2 | Package scripts | `pnpm --filter @wardboard/importer test && pnpm --filter @wardboard/importer typecheck && pnpm --filter @wardboard/importer lint` | exits 0, 0 warnings |
| 3 | Fixtures untouched | `git diff main --stat -- fixtures` | empty output |
| 4 | No logging in the parser | `grep -nE "console\.|process\.std" packages/importer/src/reports/organizations*.ts` | no output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
In `packages/importer/test/organizations-report.test.ts`. Load the fixture with `extractPdf(readFileSync(...))` once. Build error cases by copying the extracted `PdfDocument` and removing/editing rows (plain object copies; no new PDFs needed).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `reads unit name and report date without the unit number` | `unitName === 'Cedar 14th Ward'`, `reportDate === '2026-10-25'`; `JSON.stringify(report)` contains neither `100001` nor `200002` | unit number kept; stake taken as the unit; date left unparsed |
| `finds the 11 organizations in document order with their group counts` | names and group counts exactly as listed above | roster headings ('Elders Quorum Members') treated as organizations; bold groups treated as organizations |
| `reconciles 244 positions, 95 vacant, 31 custom across all calling tables` | totals and per-organization counts above | vacancy marker read as a name; `* custom calling` footnote counted as a row; rows lost at page breaks |
| `organizations whose table follows the heading directly get one group named after the organization` | Bishopric, Ward Missionaries, Temple and Family History, Young Single Adult each have exactly one group with the organization's name | rows attached to the previous organization's last group |
| `continues a calling table across a page break without starting a new group` | Relief Society `Service` (heading on page 6, rows on page 7) has 9 positions: first two `Relief Society Service Coordinator` and `Relief Society Assistant Service Coordinator` vacant; five custom `Relief Society Compassionate Service Committee` positions, 4 occupied and 1 vacant; Sunday School `Away on Missions` (Count on page 12) has 1 position | repeated page header opens a new group; Count on the next page not matched |
| `strips the custom marker and keeps long titles whole` | the Temple and Family History group includes custom `Temple Prep Instructor` (title without `* `, `custom: true`); Aaronic `Aaronic Priesthood Quorums Specialist - Assistant Camp Director` present as one title | `* ` left in the title; custom flag missing |
| `drops room numbers from class group names` | Primary group names include `Valiant 10, Valiant 9` and `Valiant 8`; no group name contains `Room` | `Room: 115` merged into the name |
| `never emits member-roster names or personal fields` | `JSON.stringify(report)` contains none of: `Lynby, Milo`, `Winton, Wes`, `Fairwell, Cameron Sage Bailey Dakota Skyler` (roster-only people), `@example.com`, `555-`, `Birth`, `✓`, `Jan 2024`, `1974`; and every string value in the output is an organization name, group name, title, or occupant | roster rows parsed as callings; sustained dates or contact fields carried along |
| `rejects a different report as WRONG_REPORT` | the extracted `members-without-callings.pdf` and a copy with `title: 'Something else'` both throw `OrganizationsReportError` with `code: 'WRONG_REPORT'` | parser silently returns an empty report |
| `throws COUNT_MISMATCH when a calling row is missing` | remove the `Bishop` row from page 1 → `COUNT_MISMATCH`, `page: 1`, message mentions `Bishopric` and contains no member name | count not checked; personal value in error text |
| `throws COUNT_MISMATCH when a roster row is missing` | remove one roster row from the Elders Quorum Members table → `COUNT_MISMATCH` | roster tables not reconciled |
| `throws UNRECOGNIZED_LAYOUT for an unclosed table and for a data row outside any table` | (a) remove the `Count: 9` row on page 1; (b) insert a two-item data row before the first heading | guessed rows; silent truncation |
| `is deterministic` | two parses of the same document are `toStrictEqual` | shared mutable state |

## Edge cases (each needs a test)
Covered above: table split across a page break (heading on one page, rows on the next; `Count:` alone at the top of a page), organization with no group heading, roster heading that is not bold, bold roster heading, custom marker, vacancy marker, room suffix, wrong report, count mismatch in calling and roster tables, unclosed table, row outside a table.

## Human checks
none

## Out of scope
- Youth/adult classification and identity matching (T-057). Note: the roster sections this parser discards carry ages that could classify calling holders; whether to use them is a T-057 design question for Mike, not this task.
- Allow-list enforcement across all parsers and canary checks (T-056); this task only guarantees its own output shape.
- Mapping report organizations/groups to WardBoard's board groups (T-058).
- Members without Callings (T-054) and Out-of-Unit (T-055) parsers.
