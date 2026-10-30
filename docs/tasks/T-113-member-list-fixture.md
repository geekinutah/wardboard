# T-113: Make the Member List fixture readable and consistent with the other fixtures

**Milestone:** 6 — Import and photos (fixture for T-111/T-112)
**Depends on:** Mike's commit `52cdc6f`, which added `fixtures/lcr-reports/member-list-anonymized.pdf` and is merged into this branch.
- Mike, 2026-10-29: "I just want you to fix the new PDF. You can rename it if you want, whatever. I don't want a new script that tries to anonymize things. This isn't going to happen often."
- This changes test data only. No application behavior changes. The proof is the executable structural test named below, plus a mutation.

**Spec refs:** SPEC.md §15 (adult is 18 and over, youth 11–17, under 11 is not imported). AGENTS.md security rules: fixtures are fictional and real data is never committed. `fixtures/lcr-reports/README.md`.

## Problem (controller probe, 2026-10-29)
- The PDF was produced by ReportLab. Its content streams use `ASCII85Decode` and `FlateDecode`. The importer's reader (`packages/importer/src/pdf/pdf-reader.ts`) supports only what LCR emits, and refuses the file: `UNSUPPORTED_PDF: Unsupported compression filter: ASCII85Decode`.
- What already matches the other fixtures:
  - the `Member List` title;
  - the unit line `Cedar 14th Ward (100001)`;
  - the column headings `Name, Gender, Age, Birth Date, Phone Number, Email`, repeated on each page;
  - the footer;
  - 207 phone numbers, all `555`;
  - 233 emails, all `example.*`.
- Only 42 of its 251 names appear in the other three fixtures, and roughly 250 fixture people are missing from it. A Member List is meant to list every ward member, so T-112 can't prove anything with it.

## Goal
`fixtures/lcr-reports/member-list.pdf` (renamed) has the following properties:
- **Readable.** `extractPdf` reads it with no change to the reader.
- **Same people.**
  - It lists exactly one row for every fictional person in the other three fixtures, under the same printed name.
  - Its ages agree with the other fixtures.
  - It may also hold extra fictional rows for children under 11, who appear in no other report.
- **Same look.** It keeps the page layout Mike supplied (title, unit line, column positions, repeated header, footer, rows per page).
- **Fictional only.** Every phone number uses `555`. Every email is `@example.com`. No real-looking value remains.

## Design decisions (binding)

**Done by hand, not by a committed tool.** Do the work with throwaway scripts in the session scratchpad. Commit only the PDF, the README change and the test. Do not add an anonymizer, a generator or a new dependency to the repo. Python's standard library (`zlib`) or Node built-ins are fine for the scratch work. Run Python with `-I`.

**Encoding.** Rewrite every content stream so it uses only filters the importer already supports: `FlateDecode`, or no filter. Read `pdf-reader.ts` to confirm what is supported. Rebuild the cross-reference table so the byte offsets are correct. Keep PDF 1.4. Set `/Producer (WardBoard fixture)` and drop ReportLab metadata.

**Rows.** Build one row for each distinct person name printed in the three existing fixtures. Use the importer's own parsers to list them, for example `parseWithoutCallings`, `parseOrganizations` and `parseOutOfUnit` via `extractPdf`. Rules:
- **Order.** Alphabetical by printed name (`Last, First`), as LCR prints. Children rows are interleaved alphabetically too.
- **Age.**
  - If the person appears in Members without Callings, use the age printed there, so the category matches.
  - Otherwise, a person whose callings are all youth callings (titles containing `Quorum` with `Deacons` or `Teachers`, `Priests Quorum Assistant`, `Priests Quorum Secretary`, or `Class` in Young Women) gets a youth age of 12–17.
  - Everyone else gets an adult age of 19–85.
  - Pick ages deterministically, for example from a hash of the name.
- **Birth date.** It must agree with the age as of the report date printed in the PDF's footer, in the existing `DD Mon YYYY` format.
- **Gender.** It must agree with the fictional first name, as the README promises for the other fixtures. Take it from the Members without Callings gender if that report prints one. Otherwise:
  - Relief Society, Young Women and Primary presidency callings → `F`.
  - Bishopric, Elders Quorum, Aaronic and quorum callings → `M`.
  - Any remaining person gets a gender consistent with their first name. List those people in the report.
- **Phone and email.** Keep the existing fictional style: `(801) 555-NNNN`, and `first.lastNN@example.com` derived from the fictional name. Some rows may be blank, as now.
- **Children.** You may keep some rows for under-11 children with new fictional names that appear in no other fixture, and say how many. They prove the parser's exclusion.
- **Layout.** Keep the rows-per-page, fonts, x positions and repeated header as Mike's file has them. Change only text and the number of pages.

**`Westdale, Gus`.** He appears in both Callings by Organization and Members without Callings in the existing fixtures. Mike says that can't happen in real reports. This task does not fix the other three fixtures. He gets exactly one Member List row, with the youth age from Members without Callings. Note this in the README.

**Rename.** Use `git mv` to rename it to `member-list.pdf`.

**README.** Add the file to the table: `Reports → Member List → Print → Download PDF`. Add a short provenance note:
- Mike supplied the layout on 2026-10-29.
- The rows were rewritten to the existing fictional identities.
- The streams were re-encoded so the importer can read them.
- Mark the menu path as unconfirmed: Mike called the report "Member Directory".

## Structural test (the executable check)
Add `packages/importer/test/member-list-fixture.test.ts`. It uses only `extractPdf` and the existing parsers; the Member List parser comes later in T-111. Test names:

| Test name | What it checks | A realistic defect it catches |
|---|---|---|
| `the member list fixture is readable` | `extractPdf` succeeds; page 1 has `Member List`, `Cedar 14th Ward (100001)` and the six headings in order | ASCII85 left in place; broken xref |
| `every fixture person appears exactly once` | the set of printed names from the three other fixtures (via their parsers) is a subset of the Member List's name cells, each exactly once | the original 42-of-251 mismatch; duplicates |
| `ages agree with members without callings` | for each Members without Callings candidate, the Member List age gives the same `categoryForAge` | a re-aged person |
| `birth dates agree with ages` | each row's birth date and age are consistent as of the footer date | random dates |
| `contact details are fictional` | every phone cell matches `\(\d{3}\) 555-\d{4}`; every email ends `@example.com`; no other `@` or phone-shaped text | a real-looking value |

Read the cells by column x-position from the header row; don't guess from text. Keep the helper inside the test file.

## Scope
May change:
- `fixtures/lcr-reports/member-list-anonymized.pdf`, renamed to `fixtures/lcr-reports/member-list.pdf`
- `fixtures/lcr-reports/README.md`
- `packages/importer/test/member-list-fixture.test.ts` (new)

Must not change:
- the other three PDFs
- `packages/importer/src/**` (the reader stays as it is)
- every existing test
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Structural test | `pnpm --filter @wardboard/importer exec vitest run test/member-list-fixture.test.ts` | all five tests pass |
| 2 | Mutation | in a disposable worktree at the candidate, restore Mike's original PDF bytes under the new name (`git show 52cdc6f:fixtures/lcr-reports/member-list-anonymized.pdf > fixtures/lcr-reports/member-list.pdf`), then run check 1 | `the member list fixture is readable` fails (and the others fail or error); remove the worktree |
| 3 | No real-looking data | the structural test, plus `grep -a -c "ReportLab" fixtures/lcr-reports/member-list.pdf` | test passes; grep prints `0` |
| 4 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 5 | Scope | `git diff --name-only origin/main...HEAD` | only the paths under May change (the rename shows as the old and new PDF names), plus this contract and the ledger |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Human checks
- Open `fixtures/lcr-reports/member-list.pdf` in Preview and confirm it looks like the printed Member List you see in LCR.

## Out of scope
- Fixing the `Westdale, Gus` overlap in the other three fixtures.
- The Member List parser (T-111) and import wiring (T-112).
- Any reusable anonymizer.
