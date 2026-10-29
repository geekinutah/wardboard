# T-057: Identity reconciliation

**Milestone:** 6 — Import and photos
**Depends on:** T-056 (done). The three parsers and `allowListImport` are done.
- No shared files with any in-flight task. T-091 is done.

**Spec refs:** SPEC.md §8 (exact unique name match reuses the local member; namesakes, changed names, and resembling names are not silently merged; name comparison only; no Church identifier), §14 (detect duplicate reports; the same person may have several external callings; a person in both a calling row and Members without Callings is not a safe silent merge), §15 (adult/youth category already decided by the without-callings parser; age is not reconciled again; reproducible match decisions; unknown identities are review items, not guesses).

## Goal
`reconcile` turns one allow-listed import bundle plus the ward's existing members into deterministic decisions: matched, new, ambiguous, or absent. It never picks a winner among namesakes or resemblances. Duplicate report fingerprints and disagreeing report headers are flagged. Names do not appear in logs.

## Design decisions (binding)

### Module: `packages/importer/src/reconcile/reconcile.ts`
No new dependencies. Do not import `@wardboard/core`. Do not change the parsers or the allow-list.

Name normalization, used for every compared name, matches `packages/core/src/search/normalize.ts`: NFKD, strip combining marks, `toLocaleLowerCase('en')`, collapse whitespace, trim. After that, a name that matches `/^(.+?), (.+)$/` with both sides non-empty keeps the comma form. Any other name stays as the normalized string. That string is the canonical key.

| Input | Key |
|---|---|
| `Stanley, Zed` | `stanley, zed` |
| `Stanley,  Zed` | `stanley, zed` |
| `Áda Fictional` | `ada fictional` |
| `Zed Stanley` | `zed stanley` |

`stanley, zed` and `zed stanley` are different keys.

**Resemblance.** Two different keys resemble each other when their last-name tokens are equal and their given-name token sets intersect. The last-name token is the text before the comma, or the last word when there is no comma. Given tokens are the remaining words. `stanley, zed` resembles `zed stanley` and `stanley, zed paul`. It does not resemble `stanley, zoe` or `smith, anna` versus `smith, ann`. An equal key is a match, not a resemblance.

**People in the bundle.** One person per canonical key. Collect occupants (skip `null`), without-callings candidates, and external-calling names. Ignore vacancies. First-appearance order is organizations document order, then without-callings order, then out-of-unit order. The decision's `name` is that first printed string. `sources` lists the kinds that contained the key, in that same order, once each.

`externalCallings` copies `{ section, calling, servingUnit }` for that key in report order.

`category` is the without-callings category when every such row agrees. It is `null` when the person is not in that report. Two different categories, or the same key both occupying a calling and appearing as a without-callings candidate, is `report_conflict`. Out-of-unit plus an organization calling is not a conflict.

**Existing members.** Read only `id` and `name`. Extra keys are ignored. Compare each member's canonical key with each bundle key. Do not compare members with each other.

For a bundle person who is not `report_conflict`, let `exact` be the existing members with that key, in input order, and let `similar` be the existing members who resemble that key, are not in `exact`, and whose key is not an exact key of any bundle person, in input order.

- `exact` has one member and `similar` is empty: `{ kind: 'matched', memberId }` of that member.
- `exact` has two or more: `{ kind: 'ambiguous', reason: 'namesake', candidates: [...exact, ...similar] }`. Do not match.
- `exact` has one member and `similar` is not empty: `{ kind: 'ambiguous', reason: 'resembles', candidates: [...exact, ...similar] }`. Do not match. A resembling member blocks automatic reuse.
- `exact` is empty and `similar` is not empty: `{ kind: 'ambiguous', reason: 'resembles', candidates: similar }`. Do not match.
- Both are empty: `{ kind: 'new' }`.
- `report_conflict` is always `{ kind: 'ambiguous', reason: 'report_conflict', candidates: [] }`, even when an existing member has the exact key. Do not attach that member or anyone who only resembles that key.

`absent` lists existing members, in input order, whose key is not an exact key of any bundle person and whose id is not in any `similar` list. An exact-key member of a `report_conflict`, and a member who only resembles a `report_conflict` key, are omitted from both `candidates` and `absent`. That omission is not removal.

**Reports.** `inconsistentReports` is true when `canonicalName` of the three `unitName` strings is not all equal, or the three `reportDate` strings are not all equal. Compare dates as exact strings. Decisions are still returned. An empty unit name is not an `invalid_name` error.

`reportFingerprint` returns the lowercase SHA-256 hex of `JSON.stringify` of that report object, using the object's own key order. `previousFingerprints` is an optional partial record keyed by report kind. A kind is listed in `duplicates`, in the order organizations, without-callings, out-of-unit, when its previous hex is present and equal. A missing previous hex is not a duplicate. People are still reconciled.

On success, if `log` is passed, call it once with exactly `reconcile matched=<N> new=<N> ambiguous=<N> absent=<N> duplicates=<N>`. The counts are the number of decisions of each kind, `absent.length`, and `duplicates.length`. No names, dates, phones, or callings. Do not call `console.*`. A thrown error does not log.

An empty canonical name on a non-null occupant, a without-callings candidate, an external-calling name, or an existing member throws `ReconcileError` `invalid_name` with exactly `reconcile name is empty`. Set `this.name` to `ReconcileError`. Check every such name before logging or returning.

```ts
export class ReconcileError extends Error {
  readonly code: 'invalid_name';
}

export type ReportKind = 'organizations' | 'without-callings' | 'out-of-unit';

export interface ExternalCallingRef {
  readonly section: OutOfUnitSection;
  readonly calling: string;
  readonly servingUnit: string | null;
}

export type PersonDecision = {
  readonly name: string;
  readonly key: string;
  readonly category: 'adult' | 'youth' | null;
  readonly sources: readonly ReportKind[];
  readonly externalCallings: readonly ExternalCallingRef[];
} & (
  | { readonly kind: 'matched'; readonly memberId: string }
  | { readonly kind: 'new' }
  | {
      readonly kind: 'ambiguous';
      readonly reason: 'namesake' | 'resembles' | 'report_conflict';
      readonly candidates: readonly { readonly memberId: string; readonly name: string }[];
    }
);

export interface ReconcileResult {
  readonly decisions: readonly PersonDecision[];
  readonly absent: readonly { readonly memberId: string; readonly name: string }[];
  readonly duplicates: readonly ReportKind[];
  readonly inconsistentReports: boolean;
}

export function canonicalName(name: string): string;

export function reportFingerprint(
  report: OrganizationsReport | WithoutCallingsReport | OutOfUnitReport,
): string;

export function reconcile(input: {
  readonly bundle: ImportBundle;
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly previousFingerprints?: Readonly<Partial<Record<ReportKind, string>>>;
  readonly log?: (line: string) => void;
}): ReconcileResult;
```

Export `reconcile`, `reportFingerprint`, `canonicalName`, `ReconcileError`, and these types from `packages/importer/src/index.ts` by adding `export * from './reconcile/reconcile.ts';`.

## Scope
May change:
- `packages/importer/src/reconcile/**` (new)
- `packages/importer/src/index.ts` (one export)
- `packages/importer/test/reconcile.test.ts` (new)

Must not change:
- Parsers, allow-list, fixtures, `packages/core/**`, `apps/**`, `docs/tasks/**`, existing tests, anything else.

New dependencies allowed: none. `node:crypto` is allowed.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Reconcile tests | `pnpm --filter @wardboard/importer exec vitest run test/reconcile.test.ts` | every test below passes |
| 2 | Importer tests | `pnpm --filter @wardboard/importer test` | exits 0 |
| 3 | Scope | `git diff --name-only origin/main...HEAD` | only the three paths under May change |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Build the smallest valid `ImportBundle` values in the test. Use `importReports` on the fictional fixtures only for the fixture test.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `canonicalName folds case, marks, space, and comma spacing` | the four examples in the table | keeping the accent; treating `zed stanley` as `stanley, zed` |
| `exact unique name matches and reuses the member id` | occupant `Stanley, Zed` and one existing member with that name, and nobody resembles → one `matched` decision, `memberId` set, not absent | creating a new member; matching a different id |
| `namesakes are not merged` | two existing members with key `stanley, zed` → `ambiguous` `namesake` with both ids, in input order; kind is not `matched` | picking the first id |
| `a resemblance stays beside namesakes` | those two exact members plus `Zed Stanley` → `namesake` candidates are the two exact ids, then the reversed id; the reversed id is not absent | dropping the reversed member into `absent` |
| `a reversed name resembles and is not matched` | existing `Zed Stanley`, bundle `Stanley, Zed` → `resembles` with that id; that id is not in `absent` | exact-matching across word order; listing them absent |
| `a unique exact match with a resemblance is not automatic` | existing `Stanley, Zed` and `Stanley, Zed Paul`, bundle `Stanley, Zed` → `resembles` with the exact id first, then the longer name; neither is absent | returning `matched` and listing Zed Paul absent |
| `a different given name is new` | existing `Stanley, Zoe`, bundle `Stanley, Zed` → `new`; Zoe is `absent` | treating every shared last name as a resemblance |
| `a shared given token resembles` | existing `Stanley, Zed Paul`, bundle `Stanley, Zed` → `resembles` | requiring the full given name |
| `a calling and a without-callings row conflict` | same name as an occupant and as a youth candidate → `report_conflict`, `category` null, `candidates` empty, not `matched` even if an existing member has the exact name | attaching notes to a guessed member |
| `external callings stay on one person` | one name with two external rows and one ward calling → one decision, `sources` includes both kinds, both external records in order, `category` null | a decision per calling; dropping `servingUnit` |
| `vacancies and empty imports create no people` | a null occupant and a bundle with no people → no decisions; every existing member is absent | a person named from the vacancy marker |
| `duplicate fingerprints are flagged and people remain` | a matching organizations fingerprint adds `organizations` and the occupant is still decided; a different title does not match | dropping the report's people; hashing a name into the log |
| `disagreeing headers are flagged` | different `reportDate` → `inconsistentReports` true and decisions still returned | throwing away the bundle |
| `an empty name throws without logging` | a whitespace occupant throws `ReconcileError` `invalid_name` with the exact message and `name === 'ReconcileError'`; a second call with a valid occupant and an existing member named ` ` also throws; neither call logs | interpolating the raw name |
| `the log is counts only` | the success line matches the counts and does not contain `Stanley` or `Zed`; `console.*` is not called | `JSON.stringify` of a decision in the log |
| `fixture reconciliation is deterministic and leaks no phone` | `importReports` of the three fictional PDFs, no existing members: two calls `toStrictEqual`; a decision named `Stanley, Zed` is `new`; no decision name is `Calling Vacant`; `JSON.stringify(result)` and the log do not contain `555-0100` | merging two fixture namesakes; logging a phone |

## Edge cases (each needs a test)
Covered above: unique match, namesake, resemblance beside namesakes, reversed name, exact match blocked by a resemblance, different given name, shared given token, report conflict, several external callings, vacancy, empty import, duplicate fingerprint, header mismatch, empty name, log leakage, fixture phones.

## Human checks
none

## Out of scope
- Replacing Current, writing `removed_date`, or preserving notes and tags (T-058).
- The import preview UI (T-059).
- Photo matching (T-061).
- Editing a parser because a fixture name looks ambiguous. Assert the actual decision.
