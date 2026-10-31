# T-115: Importer parses and reconciles member gender

**Milestone:** 6 — Import and photos
**Depends on:** T-111 and T-112 (Member List parser and import wiring, done on `main`).
- Promoted from B-068 (Mike's decision on 2026-10-30: keep `gender` (`'M' | 'F'`) from both `Member List` and `Members without Callings`).
- Runs in parallel with T-114 (`packages/core`). Neither touches the other's files.

**Spec refs:**
- SPEC.md §7, §8, §15: `Member List` and `Members without Callings` supply `gender` (`'M' | 'F'`). Only name, derived youth/adult category, and gender (`'M' | 'F'`) are kept; numeric age, birth date, phone, and email are discarded before storage.

## Goal
`parseWithoutCallingsReport` and `parseMemberList` in `packages/importer` extract and validate each row's `Gender` column (`'M' | 'F'`), the allow-list keeps `gender`, and `reconcile` settles each person's `gender: 'M' | 'F' | null` using the same uniqueness and agreement rules as `category`.

## Design decisions (binding)

### Parsers (`packages/importer/src/reports/`)
```ts
export type MemberGender = 'M' | 'F';
```
- **`without-callings.ts`:**
  - Export `MemberGender`.
  - `WithoutCallingsCandidate` gains `readonly gender: MemberGender`.
  - Read the text in the `Gender` column (`it.x >= boundNameGender && it.x < boundGenderAge`). It must be `'M'` or `'F'`. Any other value (empty or unknown) throws `WithoutCallingsReportError('UNRECOGNIZED_LAYOUT', pageNum, 'Missing or invalid gender in member row on page ...')` without including the member's name or row text.
- **`member-list.ts`:**
  - `MemberListEntry` gains `readonly gender: MemberGender`.
  - Read the text in the `Gender` column (`cellText(row, header.nameEnd, header.genderEnd)`). For rows aged 11 or over (kept rows) and under-11 rows alike, validate the `Gender` cell is `'M'` or `'F'`; otherwise throw `MemberListReportError('UNRECOGNIZED_LAYOUT', page.pageNumber, 'Invalid gender in the Gender column on page ...')` without leaking the row's name or values.

### Allow-list (`packages/importer/src/allowlist/`)
- `allowListImport` (`import.ts`) and `allowListMemberList` (`member-list.ts`) validate `gender` with `requireGender(value)`: must be `'M'` or `'F'`, otherwise throw `AllowListError('invalid_value', 'allow-list gender is not M or F')`.
- Copy `gender` onto each allow-listed `WithoutCallingsCandidate` and `MemberListEntry`.
- Numeric age, birth date, phone number, and email remain discarded.

### Reconcile (`packages/importer/src/reconcile/reconcile.ts`)
- `PersonDecision` gains `readonly gender: MemberGender | null`.
- `PersonDraft` collects `genders: MemberGender[]` from `without-callings` candidates (just like `categories`).
- `isReportConflict(person)` also returns `true` if `new Set(person.genders).size > 1`.
- `memberListGenders(imported)`: maps canonical name → `MemberGender | null`. A name appearing more than once in `imported.memberList.entries` maps to `null` (same as `memberListCategories`: namesakes in the Member List do not guess which person is which).
- `settledGender(person, listedGenders)`:
  - If `isReportConflict(person)` is true, return `null`.
  - Let `derived` be the single gender from `person.genders` (or `null` if none).
  - Let `fromList = listedGenders.get(person.key) ?? null`.
  - If `fromList === null`, return `derived`.
  - If `derived === null`, return `fromList`.
  - Return `derived === fromList ? derived : null` (if the two reports disagree on gender, return `null` so the review asks).

## Existing tests
Because T-056 and T-111 tested the pre-B-068 rule where `gender` was discarded, only these existing test files in `packages/importer/test/` may be updated, and **only** to move `gender` from the "discarded" assertion to a "kept `'M' | 'F'`" assertion (and add `gender` to hand-built `WithoutCallingsCandidate` / `MemberListEntry` literals in test inputs):
- `packages/importer/test/without-callings.test.ts`
- `packages/importer/test/allowlist.test.ts`
- `packages/importer/test/member-list-report.test.ts`
- `packages/importer/test/member-list-allowlist.test.ts`
- `packages/importer/test/member-list-reconcile.test.ts`
- `packages/importer/test/reconcile.test.ts`

No assertion on numeric age, birth date, phone number, email, or record number may be removed or weakened.

## Scope
May change:
- `packages/importer/src/reports/without-callings.ts`, `packages/importer/src/reports/member-list.ts`
- `packages/importer/src/allowlist/import.ts`, `packages/importer/src/allowlist/member-list.ts`
- `packages/importer/src/reconcile/reconcile.ts`, `packages/importer/src/index.ts`
- The existing test files listed under "Existing tests" above, within that rule.
- `packages/importer/test/gender-import.test.ts` (new)

Must not change:
- `packages/core/**`, `apps/**`, `fixtures/**`, `docs/**`, `SPEC.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New gender tests | `pnpm --filter @wardboard/importer exec vitest run test/gender-import.test.ts` | all new tests pass |
| 2 | Full importer suite | `pnpm --filter @wardboard/importer test` | all tests pass |
| 3 | Mutation A | in a disposable worktree at the candidate, make `settledGender` return `fromList` even when `derived !== fromList`, then run check 1 | `a gender disagreement between without-callings and member-list becomes null` fails; remove the worktree |
| 4 | Mutation B | in a disposable worktree at the candidate, make `allowListMemberList` accept any string for `gender`, then run check 1 | `allow-list rejects a gender other than M or F` fails; remove the worktree |
| 5 | Existing-test edits | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts'` | only files listed under "Existing tests" |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`packages/importer/test/gender-import.test.ts`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `without-callings and member-list parsers extract M and F genders from the fixtures` | every parsed candidate/entry in the fixture PDFs has `gender` equal to `'M'` or `'F'` | wrong column bounds |
| `parsers reject an invalid gender cell without leaking the person's name` | a row with gender `'X'` or `''` throws `UNRECOGNIZED_LAYOUT` and the error message does not contain the person's name | accepting arbitrary strings or leaking PII |
| `allow-list keeps gender and rejects a gender other than M or F` | `allowListImport` and `allowListMemberList` keep `'M'` / `'F'` and throw `AllowListError('invalid_value')` on `'unknown'` or `null` | missing allow-list validation |
| `reconcile settles gender from without-callings and unique member-list rows` | called members get their Member List gender; without-callings candidates keep their gender | gender not wired into `reconcile` |
| `a namesake in the member list without a without-callings row has null gender` | a name appearing twice in the Member List maps to `gender: null` when only in `organizations` | guessing between namesakes |
| `a gender disagreement between without-callings and member-list becomes null` | if without-callings says `'M'` and Member List says `'F'`, `decision.gender` is `null` | one report silently winning |

## Edge cases (each needs a test)
- Invalid/empty gender cell in `without-callings` and `member-list`.
- Namesake in `member-list` (`Westdale, Gus` / `Fairwell, Sage Casey Kendall Reagan`).
- Disagreement between `without-callings` and `member-list` on the same person's gender.
- Report conflict (two rows in `without-callings` with different genders).

## Human checks
none

## Out of scope
- Server persistence and import apply (T-116).
- Web import review UI (T-117).
