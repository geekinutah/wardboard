# T-056: Allow-list and leakage checks

**Milestone:** 6 — Import and photos
**Depends on:** T-053, T-054, T-055 (all done). T-052's extractor is done.
- No shared files with in-flight T-049, T-050, T-051 (phone features), or T-091 (`scripts/e2e-slot.pl`, `apps/web/package.json`, the `scripts/verify.sh` header, `docs/gui-verification.md`).

**Spec refs:** SPEC.md §8 (normalize and allow-list before persistence), §9 (no contact details or birth dates stored), §15 "Data collection and retention boundary" and "Verification required before shipping collectors" (only names, youth/adult classification, organization/calling/placement structure including vacancies, and external calling context leave the importer; age is used then discarded; no Church identifiers, contact details, addresses, birth dates, or raw PDF text; canary personal fields in fictional fixtures must be absent from output and logs, and the check must fail if those values leak — do not merely search for field names).

## Goal
`allowListImport` is the only shape that leaves the importer. It deep-copies the three parsed reports and keeps only the allow-listed fields. `importReports` parses the three extracted documents and then allow-lists them. Disallowed values planted on the objects, in a log, or in extra cells of the fictional fixtures never appear in the bundle or in any log line.

## Design decisions (binding)

### Module: `packages/importer/src/allowlist/import.ts`
No new dependencies. Do not change the three parsers. Call them; do not reimplement them.

```ts
export class AllowListError extends Error {
  readonly code: 'wrong_kind' | 'invalid_value';
}

export interface ImportBundle {
  readonly organizations: OrganizationsReport;
  readonly withoutCallings: WithoutCallingsReport;
  readonly outOfUnit: OutOfUnitReport;
}

export function allowListImport(
  input: {
    readonly organizations: OrganizationsReport;
    readonly withoutCallings: WithoutCallingsReport;
    readonly outOfUnit: OutOfUnitReport;
  },
  log?: (line: string) => void,
): ImportBundle;

export function importReports(
  docs: {
    readonly organizations: PdfDocument;
    readonly withoutCallings: PdfDocument;
    readonly outOfUnit: PdfDocument;
  },
  log?: (line: string) => void,
): ImportBundle;
```

`importReports` calls `parseOrganizationsReport`, `parseWithoutCallingsReport`, and `parseOutOfUnitReport`, then `allowListImport`. A parser error propagates unchanged. `log` is not called when a parser throws or when `allowListImport` throws.

### Fields that may leave
Copy only these keys, in this order, onto new objects. Drop every other key. Do not copy prototypes or non-enumerable extras. The returned bundle does not share nested objects with the input.

| Object | Keys |
|---|---|
| organizations report | `kind`, `unitName`, `reportDate`, `organizations` |
| organization | `name`, `groups` |
| group | `name`, `positions` |
| position | `title`, `custom`, `occupant` |
| without-callings report | `kind`, `unitName`, `reportDate`, `listedCount`, `excludedUnder11`, `candidates` |
| candidate | `name`, `category` |
| out-of-unit report | `kind`, `unitName`, `reportDate`, `externalCallings` |
| external calling | `section`, `name`, `calling`, `servingUnit` |

`kind` must be `'organizations'`, `'without-callings'`, or `'out-of-unit'` on the matching report. A different `kind` throws `AllowListError` `wrong_kind` with exactly one of:

- `organizations report has the wrong kind`
- `without-callings report has the wrong kind`
- `out-of-unit report has the wrong kind`

Checked in that order. The message does not include the offending value.

Other invalid values throw `AllowListError` `invalid_value` with a fixed message and no interpolated value:

| Case | Message |
|---|---|
| a required string field is not a string (`unitName`, `reportDate`, `name`, `title`, `calling`) | `allow-list field is not a string` |
| `occupant` or `servingUnit` is neither a string nor `null` | `allow-list field is not null or a string` |
| `custom` is not a boolean | `allow-list field is not a boolean` |
| `listedCount` or `excludedUnder11` is not a non-negative integer | `allow-list field is not a count` |
| `category` is not `'adult'` or `'youth'` | `allow-list category is not adult or youth` |
| `section` is not `'stake'`, `'serving-outside-unit'`, or `'living-outside-unit'` | `allow-list section is not a known section` |
| `organizations`, `groups`, `positions`, `candidates`, or `externalCallings` is not an array | `allow-list field is not a list` |

On any throw, `log` is not called.

### Log
On success, if `log` is provided, call it once with exactly:

`allow-list organizations=<P> candidates=<C> external=<E>`

`<P>` is the number of positions across every group. `<C>` is `candidates.length`. `<E>` is `externalCallings.length`. No other log line. Do not log names, dates, callings, raw PDF text, or the input. Do not call `console.log`, `console.info`, `console.warn`, `console.error`, or `console.debug`.

Export both functions and `AllowListError` from `packages/importer/src/index.ts`.

## Scope
May change:
- `packages/importer/src/allowlist/**` (new)
- `packages/importer/src/index.ts` (export the allow-list module only)
- `packages/importer/test/allowlist.test.ts` (new)

Must not change:
- The three parsers, the PDF extractor, fixtures, `apps/**`, `packages/core/**`, `scripts/**`, `docs/tasks/**`, existing tests, anything else.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Allow-list tests | `pnpm --filter @wardboard/importer exec vitest run test/allowlist.test.ts` | every test in the table below passes |
| 2 | Importer tests | `pnpm --filter @wardboard/importer test` | exits 0 |
| 3 | Scope | `git diff --name-only origin/main...HEAD` | only paths under `packages/importer/src/allowlist/`, `packages/importer/src/index.ts`, and `packages/importer/test/allowlist.test.ts` |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Use the fictional fixtures in `fixtures/lcr-reports/` (`organizations-and-callings.pdf`, `members-without-callings.pdf`, `out-of-unit-callings.pdf`) and `extractPdf`. Canary values, spelled exactly:

- `CANARY-MRN-998877665`
- `CANARY-PHONE-555-0199`
- `CANARY-DOB-1974-01-31`
- `CANARY-ADDR-1-SECRET-LANE`
- `canary.email@example.invalid`

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `drops extra keys and canary values at every level` | Build the smallest valid three-report input, then add the five canaries as extra keys on the report, on one organization, group, position, candidate, and external calling. The bundle's `JSON.stringify` contains none of the canaries. `Object.keys` at each level equals the table above. The log line is `allow-list organizations=<P> candidates=<C> external=<E>` for that input and contains no canary. | `return input`; spreading unknown keys; logging `JSON.stringify(input)` |
| `does not share nested objects with the input` | After a successful call, changing an input position title leaves the bundle's title unchanged | shallow copy |
| `rejects a bad kind, category, section, and non-string without echoing the value` | Each case throws `AllowListError` with the code and exact message in the table. The thrown message does not include `CANARY`. `log` is not called | interpolating the bad value into the message; logging before the throw |
| `importReports matches the fictional fixtures and keeps allowed data` | Bundle unit name `Cedar 14th Ward` and report date `2026-10-25` on all three reports; 11 organizations and 244 positions; `listedCount` 145, 112 candidates, `excludedUnder11` 33; 37 external callings. `JSON.stringify(bundle)` does not contain `100001` or `200002` | dropping allowed rows; keeping the unit number |
| `real fixture phones, emails, and printed dates do not survive` | From the raw extracted without-callings document, collect every `/\b\d{3}-\d{4}\b/` match and every email. At least one phone and one email exist in that raw document. None of those strings appear in `JSON.stringify(bundle)` or in the log line. Every raw text item matching `/^\d{1,2} [A-Za-z]{3,9} \d{4}$/` (at least one exists) is absent from the bundle JSON. The out-of-unit raw text contains `1 Jan 2026`, and the bundle JSON does not | copying a disallowed cell into a kept field; logging raw text |
| `extra cells on a member row do not enter the bundle or the log` | Clone the extracted without-callings document. On the first member row, append text items at `x: 2000` whose texts are the five canaries. `importReports` with the other two real documents returns 112 candidates. Bundle JSON and the one log line contain none of the five canaries | joining every cell into the name; logging the page |
| `a parser error does not log` | `importReports` with `organizations.title` set to `Not a report` throws the organizations parser's `WRONG_REPORT`. The log callback is not called | catching the error and logging the document |
| `is deterministic and does not use the console` | Two `importReports` calls on the fixtures `toStrictEqual`. Spying on `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` shows no calls during `importReports` | hidden `console.log` of a row |

## Edge cases (each needs a test)
Covered above: empty extra-key objects are not required; a wrong kind, a non-string, a bad category, a bad section, a parser failure, extra PDF cells, and the real fixture's own phone, email, and printed dates.

## Human checks
none

## Out of scope
- Identity reconciliation (T-057).
- Changing what the three parsers extract. If a parser already puts a disallowed value into an allow-listed string field, this task's fixture test fails and the task is BLOCKED; do not edit the parser.
- Server import, preview UI, photos.
