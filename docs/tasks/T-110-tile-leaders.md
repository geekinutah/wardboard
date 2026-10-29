# T-110: Ward tiles show only the presidency's three leaders, on the organizations that have one

**Milestone:** 4 — Desktop board (ward overview and presentation)
**Depends on:** T-107. Done.
- Mike's decision, 2026-10-29: "Circles for presidents should show on Bishopric, Elders Quorum, Primary, Sunday School and Young Women. Three circles for the presidents. Refer to the design guidance htmls. Young men's doesn't show a presidency, neither do Outside the Ward or General ward callings."
- The artboard `docs/design/ui-canvas/Presentation.dc.html` also shows three circles on **Relief Society**, so this contract includes Relief Society. The controller asked Mike to confirm that in the same message; if he says otherwise, this is a one-line change before implementation.
- Runs in parallel with T-109, which is server import only.

**Spec refs:**
- SPEC.md §4: the ward view shows organization tiles with leaders' photos. "Which leaders' photos appear in each overview area" was OPEN, and this task resolves it.
- SPEC.md §10: presentation shows leadership photos.
- Artboards: `Presentation.dc.html` lines 72–78 (Bishopric, Elders Quorum, Relief Society, Young Women, Primary, Sunday School: president and two counselors, with an empty circle for a vacancy) and `Main.dc.html`.

## Goal
`wardOverview` (core) gives leaders only to these tiles: Bishopric, Elders Quorum, Relief Society, Young Women, Primary and Sunday School. Each of those tiles gets exactly three leaders: the president (the bishop for the Bishopric), the first counselor and the second counselor of that organization's own presidency. A vacant seat still gets a circle, shown as vacant. Every other tile shows no leader circles: Aaronic Priesthood / Young Men, Ward-wide, Out-of-Unit, and any custom board group. Class and quorum presidencies are never tile leaders. Presentation mode and the desktop ward view use this one derivation.

## Design decisions (binding)
All changes are in `packages/core/src/derive/overview.ts`, plus SPEC.md.

**Tiles with leaders.** A board group gets leaders only when its `key` is one of `bishopric`, `elders_quorum`, `relief_society`, `young_women`, `primary` or `sunday_school`. Every other tile has `leaders: []`.

**The leadership group.** Among the calling groups whose parent is that board group:
- For `bishopric`: the group with `kind === 'bishopric'`.
- For the others: the `presidency` group whose name, compared case-insensitively after trimming, equals `${boardGroup.name} Presidency`. If no group matches by name, use the first `presidency` group by `order`, then by `id`.
- If no group qualifies, the tile has `leaders: []`.

**Leaders.** From that group's enabled single assignments, take:
1. the one with `leadershipRole === 'president'`;
2. then the counselors (`leadershipRole === 'counselor'`) in assignment `order`;
3. stop at 3 in total.

Each leader keeps today's `OverviewLeader` shape. `memberId` is the occupant of the assignment's position, or `null` when vacant, and `proposed` is computed as today.

**`prominent`.** The overview no longer reads `assignment.prominent`. Don't remove the field.

**SPEC.md.** In §4, replace the OPEN sentence about which leaders' photos appear with:

> **CONFIRMED (2026-10-29):** Bishopric, Elders Quorum, Relief Society, Young Women, Primary and Sunday School tiles show their presidency's three leaders (president or bishop, first and second counselor), including vacant seats. Other areas (Aaronic Priesthood/Young Men, Ward-wide, Out-of-Unit) show no leader photos.

Keep the rest of that paragraph.

## Authorized test changes
`packages/core/test/derive/overview.test.ts` has the test `leaders are prominent positions at any depth in structural order`, which asserts that the Aaronic tile includes the teachers and deacons quorum presidents. That contradicts Mike's decision. Replace only that test with `the Aaronic tile has no leaders`.

Search `packages/**`, `apps/web/src/**` and `apps/web/e2e/**` for any other test, spec or capture that asserts leader circles on a tile this task empties, or leaders taken from a non-presidency group. For each one you find:
- change only that assertion to match the decision;
- list it in the report with its file:line and the reason.

Do not change any other existing test.

## Scope
May change:
- `packages/core/src/derive/overview.ts`
- `packages/core/test/derive/tile-leaders.test.ts` (new)
- the authorized assertion replacements described above
- `apps/web/e2e/gui/tile-leaders.capture.ts` (new)
- `SPEC.md` (the one sentence)

Must not change:
- `packages/core/src/fixtures/**` and `apps/web/src/preview/**` fixtures. If the fixture data can't express a case, build it in the test.
- `apps/server/**`
- view components (`WardOverview.tsx`, `Presentation.tsx`) unless a view filters leaders itself. If one does, stop and report BLOCKED.
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Core tests | `pnpm --filter @wardboard/core test` | every new test passes; existing tests pass, with only the authorized replacements |
| 2 | Web tests | `pnpm --filter web test` | pass, with only the authorized assertion replacements |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/tile-leaders/` has `ward-overview-desktop-chromium.png` and `presentation-tv-chromium.png` |
| 4 | Mutation | in a disposable worktree at the candidate, drop the board-group key filter (every tile gets leaders), then run check 1 | `the Aaronic tile has no leaders` and `ward-wide and custom tiles have no leaders` fail; remove the worktree |
| 5 | Authorized test edits only | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | only files listed in the report as authorized replacements, each diff limited to the contradicting assertion |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`tile-leaders.test.ts`)
Use the core fixture (`buildFixtureWard`), plus boards built in the test where needed.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the six presidency tiles show president and two counselors` | for each of the six keys, leaders' titles are [president or Bishop, first counselor, second counselor] in that order | wrong group or order |
| `the Aaronic tile has no leaders` | `aaronic_priesthood` → `[]`, even though its quorum presidents have roles | quorum presidents shown |
| `ward-wide and custom tiles have no leaders` | `ward_wide` and a custom board group (key `null`) → `[]` | key filter missing |
| `class presidencies are never leaders` | a Young Women board group with a `Young Women Presidency` and a `Young Women Class Presidency` (both `presidency`) shows only the main presidency's three | including class presidencies |
| `the presidency is found by name before order` | if the class presidency comes first by `order`, the named `… Presidency` still wins | order-only choice |
| `a vacant counselor still gets a circle` | releasing a counselor leaves three leaders, one with `memberId: null` | dropping vacancies |
| `no presidency group means no leaders` | a keyed tile with no presidency group → `[]` | crash or wrong leaders |
| `prominent no longer matters` | flipping `prominent` on a quorum president or a presidency counselor changes nothing | still reading `prominent` |

## GUI verification
Required. At `/`, on desktop-chromium, capture the ward overview. On tv-chromium, capture presentation mode. Compare both with `Presentation.dc.html` and `Main.dc.html`. Fail on any of these:
- circles on Aaronic, Ward-wide or Out-of-Unit;
- more than three circles on a tile;
- a vacant seat with no circle;
- a tile whose layout breaks with zero leaders.

## Human checks
- In `pnpm dev`, and in presentation mode on the TV, confirm the six tiles show three circles and the others show none, and that it reads well.

## Out of scope
- Import changes (T-107 and T-109 handle the roles).
- Removing `prominent` from the model.
- Leader photos in organization detail views.
