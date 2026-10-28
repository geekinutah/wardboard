# T-073: Out-of-unit members in the dugout, second-calling and search rules

**Milestone:** 2 — Board domain (promoted from backlog B-030)
**Depends on:** T-007, T-008, T-014, T-019 (all `done`).
- No shared files with in-flight T-037, T-040, T-041, T-042, T-046, T-047, T-053, T-054, T-055, T-063. The only shared file is the barrel `packages/core/src/derive/index.ts` if you add a new module (one export line).
- T-074 (Out-of-unit card) depends on this task.

**Spec refs:** SPEC.md §3 Multiple callings (**CONFIRMED 2026-10-28:** outside callings count toward the second-calling confirmation), §4 Starting board groups item 9 (Out-of-Unit area), §5 Dugout (**CONFIRMED 2026-10-28:** an outside calling counts as a calling for automatic dugout membership), §7 (`Member.externalCallings`), §14 (Out-of-Unit report decisions). Decision record: `docs/tasks/backlog/B-030-out-of-unit-members-unavailable.md`.

## Goal
In `packages/core`, an outside calling (`member.externalCallings`) counts as a calling: such members leave the automatic dugout and the search "no calling" filter, a new derived view lists them for the Out-of-Unit area, and a ward-aware second-calling check counts their outside callings. Existing functions keep their signatures.

## Design decisions (binding)

### 1. `dugout(board, ward)` (`packages/core/src/derive/views.ts`)
Automatic membership becomes: `removedDate === null`, holds no position on this board, **and `externalCallings.length === 0`**. Explicit inclusion is unchanged (an out-of-unit member in `board.dugoutInclusions` appears with `explicit: true`). `DugoutEntry` keeps its exact shape (no new fields); the UI reads outside callings from `ward.members`.

### 2. New derived view `outOfUnitMembers(ward)`
In `packages/core/src/derive/out-of-unit.ts` (export from `derive/index.ts`):
```ts
export interface OutOfUnitEntry {
  readonly memberId: MemberId;
  readonly callings: readonly ExternalCalling[]; // the member's externalCallings, in stored order
}
export function outOfUnitMembers(ward: Ward): readonly OutOfUnitEntry[];
```
- Every member with `externalCallings.length > 0` and `removedDate === null`, regardless of any board (it is profile data, the same on Current and every proposal).
- Sorted the same way as the dugout: case-insensitive name, then id (reuse the existing comparator in `views.ts`; export it internally if needed, do not duplicate it).
- Returns a new frozen array; never mutates `ward`.

### 3. Ward-aware second-calling check (`packages/core/src/rules/second-calling.ts`)
Leave `secondCallingNotices(before, after)` and `SecondCallingNotice` **unchanged**. Add:
```ts
export interface OutsideAwareNotice extends SecondCallingNotice {
  /** The member's outside callings, which count toward countBefore/countAfter. */
  readonly outside: readonly ExternalCalling[];
}
export function secondCallingNoticesWithOutside(before: Board, after: Board, ward: Ward): readonly OutsideAwareNotice[];
```
- For each member, count = positions held on that board + `ward.members[id].externalCallings.length` (0 for an unknown id).
- A notice is produced exactly when `countAfter > countBefore && countAfter > 1`, as today. `existing` lists the ward callings kept, as today; `outside` lists the outside callings.
- Ordering of notices matches `secondCallingNotices`.
- T-035 (drag and drop) will call this function; nothing else changes callers in this task.

### 4. Search "no calling" filter (`packages/core/src/search/search.ts`)
`filters.noCalling` also excludes members with `externalCallings.length > 0`. Nothing else in search changes (outside-calling text matching stays as is).

### Authorized change to one existing test
SPEC §5 changed, so exactly one assertion in `packages/core/test/derive/derive.test.ts`, test `dugout includes members with no callings`, is now wrong: the expected **dugout** names change from `['Ivy Notreal', 'Jay Storybook', 'Kai Fictional', 'Tai Demo']` to `['Ivy Notreal', 'Jay Storybook', 'Tai Demo']`. The `unplaced` assertion in the same test (members holding no ward position, still four names including Kai Fictional) must stay as is. Make that edit with a minimal diff and name it in your report. If any **other** existing test fails, stop and report it; do not edit it.

## Scope
May change:
- `packages/core/src/derive/views.ts`, `packages/core/src/derive/out-of-unit.ts` (new), `packages/core/src/derive/index.ts` (one export line)
- `packages/core/src/rules/second-calling.ts`
- `packages/core/src/search/search.ts`
- `packages/core/test/derive/out-of-unit.test.ts` (new), `packages/core/test/rules/second-calling-outside.test.ts` (new), `packages/core/test/search/no-calling-outside.test.ts` (new)
- `packages/core/test/derive/derive.test.ts` (only the authorized assertion above)

Must not change:
- `packages/core/src/fixtures/**`, `packages/core/src/model/**`, other core files and tests, `packages/importer/**`, `apps/**`, `docs/**`, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | New core tests | `pnpm --filter @wardboard/core exec vitest run test/derive/out-of-unit.test.ts test/rules/second-calling-outside.test.ts test/search/no-calling-outside.test.ts` | exits 0; every test listed below passes |
| 2 | All core tests | `pnpm --filter @wardboard/core test` | exits 0 (including the one authorized assertion change) |
| 3 | Only the authorized existing-test edit | `git diff main -- packages/core/test/derive/derive.test.ts` | exactly one changed line: the expected dugout name list drops `'Kai Fictional'` |
| 4 | Old API untouched | `grep -c "export function secondCallingNotices(before: Board, after: Board): readonly SecondCallingNotice\[\]" packages/core/src/rules/second-calling.ts` | prints `1` |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 (web and server tests that use `dugout()` still pass) |

## Unit tests to write
Use `buildFixtureWard()` / `buildFixtureProposal()` and real core operations (`placeInPosition`, `addToDugout`, `releaseCalling`). Fixture facts: **Kai Fictional** holds no ward position and one outside calling (`Stake Young Single Adult Adviser · Example Stake`); **Hal Testwell** holds `Temple and Family History Consultant` and one outside calling (`Stake Family History Consultant · Example Stake`).

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `outOfUnitMembers lists Hal Testwell and Kai Fictional with their outside callings` (`out-of-unit.test.ts`) | exactly those two, sorted by name, each with its stored callings | members with ward callings excluded; wrong order |
| `outOfUnitMembers skips removed members and ignores board state` | a ward copy with Kai `removedDate` set → only Hal; the result is the same whatever board exists | removed members listed |
| `outOfUnitMembers returns an empty list for a ward with no outside callings` | ward copy with all `externalCallings` emptied → `[]` | throws or returns undefined |
| `a member with only outside callings is not in the automatic dugout` | Kai absent from `dugout(current, ward)`; Ivy Notreal still present | external callings ignored |
| `an explicitly included out-of-unit member is in the dugout` | after `addToDugout` for Kai: one entry, `explicit: true`, `callings: []` | inclusion ignored for out-of-unit members |
| `releasing Hal's ward calling keeps him out of the automatic dugout` | `releaseCalling` on Hal's TFH position → Hal not in the dugout, still in `outOfUnitMembers` | outside calling not counted after release |
| `placing Kai into a vacant ward calling produces an outside-aware notice` (`second-calling-outside.test.ts`) | `countBefore: 1, countAfter: 2, existing: [], outside: [Kai's calling]` | outside callings not counted (no notice) |
| `the old secondCallingNotices still ignores outside callings` | same before/after → `[]` | old API behavior changed |
| `moving Hal between ward positions does not notify` | move from TFH to a vacant position: 2 → 2, no notice | moves treated as additions |
| `adding a second ward calling to Hal reports both kinds` | place Hal into another vacant position without releasing: `countBefore: 2, countAfter: 3`, `existing` names TFH Consultant, `outside` names the stake calling | `existing` mixes outside callings in |
| `a member with no callings anywhere gets no notice for their first calling` | Ivy into a vacancy → `[]` | threshold wrong |
| `unknown member ids count zero outside callings` | a board copy placing an id absent from `ward.members` → no throw | crash on lookup |
| `no-calling filter excludes members with outside callings` (`no-calling-outside.test.ts`) | `filters: { noCalling: true }` on Current includes Ivy and Jay, excludes Kai and Hal | filter checks positions only |

## Edge cases (each needs a test)
Covered above: removed out-of-unit member, ward with none, explicit inclusion, release leaving only outside callings, move vs addition, first calling, unknown member id, search filter.

## Human checks
none

## Out of scope
- The Out-of-Unit card UI (T-074) and drag-to-dugout wiring (T-035).
- Showing outside callings on dugout cards or in the second-calling dialog (T-035 / T-074 use the data this task provides).
- Populating `externalCallings` from the import (T-055 → T-058).
