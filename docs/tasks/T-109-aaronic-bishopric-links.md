# T-109: The import links the Aaronic bishopric rows to the Bishopric instead of creating seats

**Milestone:** 6 — Import and photos
**Depends on:** T-107 (leadership roles on import). Done.
- Promoted from B-070. Mike decided on 2026-10-29: "Yes, linking is the correct approach."
- Can run in parallel with T-110 (core overview leaders), which edits no file listed here.

**Spec refs:** SPEC.md §4.
- Leadership references to the bishopric must not create duplicate independent calling slots.
- The bishop's presidency of the priests quorum is fixed by office (Handbook 7.1.2). It is not editable, and it appears in the priests quorum as a linked reference card, not a draggable calling slot.
- SPEC §12 has the matching acceptance scenario.
- SPEC §8: reports that disagree are surfaced, not silently merged.

## Goal
The LCR organizations report prints two things the import currently turns into seats:
- an Aaronic Priesthood group, `Presidency of the Aaronic Priesthood`, holding the Bishop and the two Bishopric counselors;
- a `Priests Quorum President` row, held by the bishop.

After this task the import creates no seats for those rows. They are references to the Bishopric. The Aaronic view keeps showing the bishop through its existing linked card, which it derives from the Bishopric's `Bishop` seat (`apps/web/src/features/aaronic/AaronicView.tsx:65`). The rest of the Priests Quorum Presidency imports as today: the assistants and the secretary.

## Design decisions (binding)

All changes are in `apps/server/src/import/plan.ts`, plus a new pure helper.

**Reference rows.** These rows are references. Match titles and group names with the planner's existing `canonicalName`.
- In the `aaronic_priesthood` organization (the report's `Aaronic Priesthood Quorums`), any row in the group `Presidency of the Aaronic Priesthood` whose title is `Bishop`, `Bishopric First Counselor` or `Bishopric Second Counselor`.
- In that organization, any row titled `Priests Quorum President`.

**What happens to a reference row.**
- It is not planned as a seat. It does not create a calling group, assignment or position, and it does not fill or match one.
- Its occupant still counts as appearing in the reports, so identity reconciliation is unchanged.

**Consistency check.** Compare each reference row's occupant with the occupant of the corresponding Bishopric row in the same organizations report (`Bishop`, `Bishopric First Counselor`, `Bishopric Second Counselor`). `Priests Quorum President` corresponds to `Bishop`.
- If a reference row names a different person, or names a person while the Bishopric row is vacant, the plan sets `inconsistentReports: true`. The existing preview and replace refusal then applies.
- Two vacant rows agree.

**Empty groups.** If `Presidency of the Aaronic Priesthood` ends up with no rows left, no calling group is created for it.

**Existing Currents are out of scope.** A Current imported before this task may already have these duplicate seats. They are matched slots, so the existing rules keep them, and they become vacant. That is out of scope; see Notes. Dev data is reset with `pnpm dev -- --empty --reset`.

**Helper.** Put the recognition in a pure exported helper:

```ts
// apps/server/src/import/references.ts (new)
export function bishopricReference(organization: string, group: string, title: string):
  'bishop' | 'first_counselor' | 'second_counselor' | null;
```

## Scope
May change:
- `apps/server/src/import/references.ts` (new)
- `apps/server/src/import/plan.ts`
- `apps/server/test/import/references.test.ts` (new)
- `apps/server/test/import/aaronic-links.test.ts` (new)
- **Authorized test edit.** `apps/server/test/import/leadership-import.test.ts` asserts that `Presidency of the Aaronic Priesthood` exists as an `other` group. Change only that assertion so it asserts the group does not exist. Report the exact diff.

Must not change:
- every other existing test file
- `apply.ts`, `roles.ts`, `http.ts`
- `packages/**`, `apps/web/**`, `fixtures/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Tests | `pnpm --filter @wardboard/server exec vitest run test/import` | every new test passes; existing tests pass, with only the one authorized edit |
| 2 | Mutation | in a disposable worktree at the candidate, make the planner ignore `bishopricReference` (plan reference rows as seats), then run check 1 | `the import creates no Aaronic bishopric seats` fails; remove the worktree |
| 3 | Only the authorized test edit | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints only `apps/server/test/import/leadership-import.test.ts`, and its diff is the one assertion |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Tests to write

**`references.test.ts` (pure):**

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `recognizes the Aaronic bishopric rows` | the three titles in `Presidency of the Aaronic Priesthood` under `Aaronic Priesthood Quorums` map to bishop, first and second counselor | wrong mapping |
| `recognizes the priests quorum president as the bishop` | `Priests Quorum President` in that organization → `bishop` | the row still becomes a seat |
| `ignores the real Bishopric and other rows` | `Bishop` in the `Bishopric` organization, `Priests Quorum First Assistant`, `Teachers Quorum President` and the same titles in other organizations → `null` | linking the real Bishopric away |

**`aaronic-links.test.ts`** runs on a real store with no Current and the fixture PDFs, using the first-import helpers (copy them):

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the import creates no Aaronic bishopric seats` | after a first import, no assignment titled `Bishop`, `Bishopric First Counselor`, `Bishopric Second Counselor` or `Priests Quorum President` exists outside the Bishopric organization, and no group named `Presidency of the Aaronic Priesthood` exists | seats still created |
| `the Bishopric keeps its seats and occupants` | the Bishopric's Bishop and both counselors are placed as before | references stealing the occupant |
| `the rest of the priests quorum imports` | `Priests Quorum First Assistant`, `Second Assistant` and `Secretary` exist and are placed as the report says | dropping the whole group |
| `a disagreeing reference blocks the import` | a planner input (built with `plan.test.ts` helpers, copied) whose Aaronic `Bishop` row names someone other than the Bishopric `Bishop` yields `inconsistentReports: true`, and a replace is refused `inconsistent_reports` | silently trusting one row |
| `vacant references agree with a vacant bishopric` | both vacant → no inconsistency | false alarm |
| `releasing the bishop in a proposal leaves no duplicate to release` | in a proposal from the imported Current, `releaseCalling` on the Bishop vacates the two Bishopric counselors, and no other seat held by those three people changes | duplicate cascade |

## Edge cases (each needs a test)
Covered above: the priests quorum president, other organizations, a disagreeing reference, vacant references, the rest of the quorum, the release cascade.

## Human checks
- `pnpm dev -- --empty --reset`, then import the fixture PDFs. Check two things:
  - The Aaronic Priesthood area shows the bishop as the linked card for the priests quorum, with no second bishopric.
  - The Bishopric tile is unchanged.

## Out of scope
- Cleaning duplicate seats out of a Current imported before this task (report a backlog candidate if you think it's needed).
- Which leaders the tiles show (T-110).
- Handbook-title aliasing (B-054).
