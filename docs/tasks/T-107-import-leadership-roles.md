# T-107: Imported callings get their leadership roles and presidency groups

**Milestone:** 6 — Import and photos
**Depends on:** T-058 (import replace on the server), T-102 (first import). Done.
- From Mike's first-import feedback on 2026-10-29: "the Bishopric populates, but it doesn't show the little circles with the bishop and his two counselors."
- Root cause:
  - `apps/server/src/import/apply.ts` creates every new assignment with `prominent: false, leadershipRole: null`. The ward overview shows leaders only for `prominent` assignments (`packages/core/src/derive/overview.ts`).
  - It creates every new calling group with `kind: 'other'`. The organization view's leadership card needs `presidency` or `bishopric` (`packages/core/src/derive/organization.ts:39`).
  - Worse, the presidency release rule (`packages/core/src/ops/presidency.ts:46-51`) keys on `leadershipRole`. On an imported ward, releasing a president never releases the counselors and secretary. That breaks SPEC §5.
- Runs in parallel with T-105, T-106 (web) and T-108 (sync). None of them edits a file listed here.

**Spec refs:**
- SPEC.md §5: releasing a president also releases that presidency's counselors and secretary, per Handbook 30.6. Clerks and the executive secretary are not released with the bishop.
- SPEC.md §4: the ward view shows leaders' photos; Bishopric includes the bishop and two counselors.
- SPEC.md §4, the Aaronic note: the bishop presides over the priests quorum by office. That is a reference card, not a duplicate slot.
- SPEC.md §8: imports replace occupants while preserving the configured catalog. Matched existing slots keep their configuration.

## Goal
When an import creates new calling groups and assignments, it classifies them from the LCR titles and group names:
- presidents and counselors are leaders shown in the ward overview;
- presidency and bishopric groups get their kind;
- presidents, counselors and secretaries get the roles the presidency release rule uses.

Slots that matched an existing position keep whatever they already had.

## Design decisions (binding)

### `apps/server/src/import/roles.ts` (new, pure)
```ts
export function classifyAssignment(title: string): { leadershipRole: LeadershipRole | null; prominent: boolean };
export function classifyCallingGroup(name: string): CallingGroupKind; // 'bishopric' | 'presidency' | 'other'
```
Matching is case-insensitive, on the title trimmed and with internal whitespace collapsed.

**`classifyAssignment`, checked in this order:**
1. `Bishop` exactly → `{ president, prominent: true }`.
2. Contains `Executive Secretary`, or contains `Clerk` → `{ null, false }`.
3. Contains `First Counselor` or `Second Counselor` → `{ counselor, prominent: true }`.
4. Ends with `President` → `{ president, prominent: true }`. This includes, for example, `Elders Quorum President`, `Relief Society President`, `Primary President`, `Deacons Quorum President`. It excludes `Assistant to the President`-style titles, because they don't end with `President`, and anything containing `Assistant`.
5. Ends with `Secretary` → `{ secretary, prominent: false }`.
6. Otherwise → `{ null, false }`.

**`classifyCallingGroup`:**
- `Bishopric` exactly → `bishopric`.
- Ends with `Presidency` → `presidency`.
- Otherwise → `other`.

The **planner/apply** (`apply.ts`) uses these only for assignments and calling groups it creates. Assignments and groups that already exist keep their stored values.

**Bishopric layout.** If the LCR organizations report puts the bishop, counselors and executive secretary in one group named `Bishopric`, that group becomes `bishopric`. The bishop is the president and the counselors are counselors. The executive secretary and clerks have no role, so the release rule leaves them alone (SPEC §5).

**Priests quorum.** The import must not create a second bishop slot. If the reports list the bishop under the priests quorum, follow what `plan.ts` does today and report what you see under Notes. Do not change `plan.ts` matching in this task.

**Scope of the change.** The only change to `apply.ts` is replacing the hard-coded `prominent: false`, `leadershipRole: null` and calling-group `kind: 'other'` with the classifier results. If the classification has to happen in `plan.ts` instead (for example, because creations are typed there), change only the creation records' new fields. Report that under Notes.

## Scope
May change:
- `apps/server/src/import/roles.ts` (new), `apps/server/src/import/apply.ts`, and `apps/server/src/import/plan.ts` only if needed as described above
- `apps/server/test/import/roles.test.ts`, `apps/server/test/import/leadership-import.test.ts` (new)

Must not change:
- every existing test file
- `packages/**` (the core rules stay as they are; this task only feeds them correct data)
- `apps/server/src/store/**`, `ws/**`, `photos/**`, `server.ts`, `http.ts`
- `apps/web/**`, `fixtures/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Tests | `pnpm --filter @wardboard/server exec vitest run test/import` | every new test passes; existing tests pass unmodified |
| 2 | Mutation A | in a disposable worktree at the candidate, make `classifyAssignment` return `leadershipRole: null` always, then run check 1 | `releasing an imported president releases the counselors and secretary` fails |
| 3 | Mutation B | same worktree, reset, make `classifyCallingGroup` return `other` always | `imported presidencies and the bishopric get their kinds` fails; remove the worktree |
| 4 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 5 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Tests to write

**`roles.test.ts` (pure):**

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `classifyAssignment recognizes presidents and the bishop` | `Bishop`, `Elders Quorum President`, `Primary President`, `deacons quorum president` (case) → president, prominent | case-sensitive; bishop missed |
| `classifyAssignment recognizes counselors` | `Bishopric First Counselor`, `Relief Society Second Counselor` → counselor, prominent | counselors not prominent |
| `classifyAssignment keeps executive secretaries and clerks out` | `Ward Executive Secretary`, `Ward Clerk`, `Assistant Ward Clerk--Membership` → null, not prominent | executive secretary as secretary (would be released with the bishop) |
| `classifyAssignment gives presidency secretaries the secretary role` | `Elders Quorum Secretary` → secretary, not prominent | secretary prominent; missing role |
| `classifyAssignment leaves other callings alone` | `Primary Teacher`, `Assistant to the Bishop in the Priests Quorum`, `Sunday School Teacher` → null, not prominent | substring matching on "President"/"Bishop" |
| `classifyCallingGroup` | `Bishopric` → bishopric; `Elders Quorum Presidency` → presidency; `Teachers`, `Bishopric Support` → other | prefix matching |

**`leadership-import.test.ts`:** a real store with no Current, a first import of the fixture PDFs through the same functions or route `first-import.test.ts` uses (copy its helpers), with every identity resolved.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the imported bishopric shows the bishop and two counselors as leaders` | `wardOverview` (core) on the stored Current gives the Bishopric tile three leaders whose titles are the bishop and the two counselors, all occupied | still `prominent: false` |
| `imported presidencies and the bishopric get their kinds` | the stored calling group named `Bishopric` is `bishopric`; every group named `… Presidency` is `presidency` | kinds stay `other` |
| `releasing an imported president releases the counselors and secretary` | in a proposal from the imported Current, `releaseCalling` (core) on the Elders Quorum President also vacates that presidency's counselors and secretary | roles missing |
| `releasing the imported bishop keeps the clerks and executive secretary` | releasing the bishop leaves clerk and executive secretary placements | executive secretary given the secretary role |
| `a re-import keeps existing slot configuration` | importing over a seeded Current whose matched assignments have custom `prominent`/role values leaves those values unchanged | overwriting existing slots |

Read the fixture PDFs' real titles and group names (`fixtures/lcr-reports/`, parsed with the importer) before you write the integration tests. Name the exact titles you assert in a comment. If the fixture's titles don't fit the rules above (for example, the bishopric counselors are titled differently), stop and report BLOCKED with the titles, rather than changing the rules.

## Edge cases (each needs a test)
Covered above: case, executive secretary and clerks, assistants, secretaries, non-leader titles, group-name prefixes, re-import of existing slots.

## Human checks
- `pnpm dev -- --empty --reset`, then import. The Bishopric tile and each presidency show their leader circles. In a proposal, release the Elders Quorum President and confirm the counselors and secretary are released too.

## Out of scope
- Handbook-label aliasing for re-imports onto the seeded board (B-054).
- Which leaders each tile shows beyond presidents and counselors (SPEC §4 lists this as OPEN).
- Gender restrictions (pending Mike).
- Changing core rules or the web views.
