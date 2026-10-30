# T-111: Parse the LCR Member List report for youth/adult

**Milestone:** 6 — Import and photos
**Depends on:** the fictional Member List fixture `fixtures/lcr-reports/member-list.pdf`, supplied by Mike and made consistent with the other fixtures by T-113 (done, on `main`). It has 293 rows on 7 pages, including two namesake pairs: `Westdale, Gus` (11 and 39) and `Fairwell, Sage Casey Kendall Reagan` (14 and 16). Both rows of each pair must be kept. Also T-053–T-056 (the existing parsers and allow-list), which are done.
- Promoted from B-069. Mike decided on 2026-10-29 to add a full ward directory report, option (a): a fourth report used only for youth/adult. On 2026-10-30 Mike made it required, not optional (T-112). The LCR path is Reports → Member Directory → Print; the printed title is `Member List`.
- T-112 wires this parser into the import. It depends on this task.

**Spec refs:**
- SPEC.md §15: the deterministic report parsers, and the allow-list (adult is 18 and over, youth is 11–17, under 11 is not imported). Discarded fields must not reach storage, logs or backups.
- SPEC.md §8: matching is by name only, never a Church identifier.
- `fixtures/lcr-reports/README.md`: the fixture rules.

**Report layout** (from Mike's screenshot of the printed report, 2026-10-29; the real data in it was not kept):
- The title is `Member List`.
- Under the title, the unit line: `<Unit name> (<unit number>)`, for example `Cedar 14th Ward (100001)` in the fixtures.
- A table with the columns `Name`, `Gender`, `Age`, `Birth Date`, `Phone Number` and `Email`.
- Names are printed `Last, First`.
- Treat the fixture PDF as the layout contract, including page breaks, wrapped names and the footer, the way `without-callings.ts` treats its report.

## Goal
`parseMemberList(doc)` in `packages/importer` reads the Member List PDF. It returns, for each listed person aged 11 or over, the printed name and the category derived from age. Nothing else leaves the parser: gender, the numeric age, birth date, phone number and email never appear in its output, errors or logs.

## Design decisions (binding)
New file `packages/importer/src/reports/member-list.ts`. Export it from the package index.

```ts
export interface MemberListEntry { readonly name: string; readonly category: MemberCategory }
export interface MemberListReport {
  readonly kind: 'member-list';
  readonly unitName: string;        // unit number removed
  readonly reportDate: string | null; // ISO date if the footer prints one, else null
  readonly listedCount: number;     // rows listed; equals any printed count
  readonly excludedUnder11: number; // no names kept for them
  readonly entries: readonly MemberListEntry[];
}
export class MemberListReportError extends Error { readonly code: 'UNRECOGNIZED_LAYOUT' | 'COUNT_MISMATCH' | 'INVALID_AGE'; readonly page: number }
export function parseMemberList(doc: PdfDocument): MemberListReport;
```

- Use `categoryForAge` from `without-callings.ts`. Do not write a second copy of the age rule.
- Recognition:
  - The report is accepted only if page 1 has the `Member List` title and the column headings in order.
  - Otherwise throw `UNRECOGNIZED_LAYOUT`.
  - Never guess from the filename.
- Ages must be whole numbers. Otherwise throw `INVALID_AGE` with the page number, and nothing else from the row.
- **Error messages and logs** may name a page and a column, but never a person's name or any value from the row.
- **Allow-list:**
  - Add a `member-list` source to `packages/importer/src/allowlist/` whose kept fields are only `name` and `category`, following how the without-callings source is allow-listed.
  - The leakage tests (T-056 style) must prove that the fixture's gender, birth dates, phone numbers and emails are absent from the allow-listed output.
- Gender is parsed only so it can be discarded. Mike may later decide to keep it (`HUMAN_BACKLOG.md` "Gender and gender-limited callings", B-068); that is not part of this task.

## Scope
May change:
- `packages/importer/src/reports/member-list.ts` (new)
- `packages/importer/src/index.ts` (exports)
- `packages/importer/src/allowlist/**` (the new source only)
- `packages/importer/test/member-list-report.test.ts` (new)
- `packages/importer/test/member-list-allowlist.test.ts` (new)

Must not change:
- every existing test file
- the other parsers
- `fixtures/**`
- `apps/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Tests | `pnpm --filter @wardboard/importer test` | every new test passes; existing tests pass unmodified |
| 2 | Mutation | in a disposable worktree at the candidate, make the parser keep under-11 rows as youth, then run check 1 | `children under 11 are counted, not kept` fails; remove the worktree |
| 3 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Tests to write

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `parses the fixture member list` | unit name, listed count and entries; a few named fictional rows from the fixture have the expected category (named in a comment) | wrong columns |
| `children under 11 are counted, not kept` | `excludedUnder11` equals the fixture's under-11 rows, and none of their names appears | keeping children |
| `the age boundaries map to the SPEC categories` | ages 10, 11, 17 and 18 map to excluded, youth, youth and adult. Use built `PdfDocument` rows, as the other parser tests do | an off-by-one error |
| `wrapped names and page breaks parse` | rows across a page break and any wrapped name in the fixture parse once | duplicates or splits |
| `another report is refused` | each of the three other fixture PDFs throws `UNRECOGNIZED_LAYOUT` | filename trust |
| `a bad age is refused without leaking the row` | a built row with age `x` throws `INVALID_AGE`, and the message contains no name | leaking values |
| `the output keeps only name and category` | the serialized report contains none of the fixture's genders, ages, birth dates, phone numbers or emails (pick values from the fixture text in the test) | leaking discarded fields |
| `the allow-list keeps only name and category` | the allow-listed member-list source keeps only those two fields | an allow-list gap |

## Human checks
none (T-112 carries the end-to-end check).

## Out of scope
- Wiring the report into preview and replace, or the UI (T-112).
- Storing gender (B-068).
- Creating members who appear only in the Member List.
