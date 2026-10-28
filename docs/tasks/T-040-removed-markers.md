# T-040: Removed markers and divergence summary

**Milestone:** 4 — Desktop board
**Depends on:** T-017 (core `removedState`), T-004 (`RemovedCard`), T-033 (`OrganizationView`), T-034 (`GroupDetail`), T-070 (preview harness). All `done`.
- Runs alongside T-071, T-044 and T-045, and shares no files with them.
- T-030 mounts these pieces into the shell later.

**Spec refs:**
- SPEC.md §8, Removed members and positions in proposals:
  - Removal is derived, never stored.
  - The UI adds only two things. First, a removed marker on each affected card: greyed, cross-hatched, a REMOVED or POSITION REMOVED watermark, plus equivalent text for accessibility. Second, a diff-style summary at the top of the proposal listing the affected members and positions.
  - Counts and suggested changes do not change.
- SPEC.md §12: affected cards show the marker, the proposal shows a top summary, and no other placement behavior changes.
- Artboard 9 (`docs/design/ui-canvas/Removed.dc.html`). Tokens are in `docs/design/README.md` ("removed").

## Goal
- A pure web helper turns core's `removedState` into display rows.
- A `<RemovedSummary>` component renders the top summary from artboard 9.
- `<GroupDetail>` (level 3) and `<OrganizationView>` (level 2) accept an optional `removed` prop. When it is given, they render affected member and position cards with the existing `RemovedCard` treatment.
- Without the prop, both views render exactly as they do today.
- A preview at `/__preview/removed` shows the summary and marked cards.

## Design decisions (binding)

### Helper: `apps/web/src/features/removed/rows.ts`
`removedRows(proposal: Proposal, current: Board, ward: Ward): RemovedRows`, where:
```ts
type RemovedRows = {
  members: { memberId; name; removedDate: string; positions: { positionId; title; groupName }[] }[];
  positions: { positionId; title; groupName; occupantName: string | null }[];
  total: number; // members.length + positions.length
};
```
- It calls core `removedState(proposal, current, ward)` and nothing else decides what counts as removed. Do not reimplement the rule.
- `title` is the assignment title. `groupName` is the name of the calling group that directly contains the assignment.
- Row order is the order core returns.

### `<RemovedSummary rows={RemovedRows} />` (`features/removed/RemovedSummary.tsx`)
- When `rows.total === 0`, it renders nothing.
- Otherwise it renders a `<section aria-labelledby>` containing:
  - the heading `Removed from Current since this baseline · {total}`;
  - when there are members, a subsection titled `Ward member removed` with the count, and one line per member and position: `− {name} proposed here as {title}`;
  - when there are positions, a subsection titled `Position removed` with the count, and one line per position: `− {groupName} · {title}` followed by ` held here by {occupantName}` when the position is occupied.
- No Accept button. Acceptance UI is T-041 and T-051.

### View props
- `GroupDetail` gains `removed?: RemovedState | undefined`. `OrganizationView` gains the same prop.
- An occupied position whose `positionId` is listed for a removed member renders that occupant's card through `RemovedCard` with `kind="member"`.
- A position in `removed.positions` renders through `RemovedCard` with `kind="position"`.
- Everything else is unchanged:
  - same order and counts;
  - the same `+ Proposed` text;
  - the same `data-` ids that T-034's tests and T-035 rely on;
  - add controls unchanged.
- Never color alone: the `RemovedCard` text labels are already accessible. Keep them.

### Preview (`features/removed/preview.tsx`)
- Build the scenario from the preview harness's fixture ward and proposal:
  - give one placed member a `removedDate`;
  - derive a `current` board from the proposal's baseline with one occupied position's lineage removed, using core `removeAssignment` or `removePosition` with the harness's id generator.
- Render `<RemovedSummary>` above `<GroupDetail>` for the affected group, with `removed` set.

## Scope
May change:
- `apps/web/src/features/removed/**` (new)
- `apps/web/src/features/group-view/GroupDetail.tsx`, `apps/web/src/features/group-view/group-view.css` (the optional prop and its rendering only)
- `apps/web/src/features/org-view/OrganizationView.tsx`, `apps/web/src/features/org-view/org-view.css` (the same)
- `apps/web/e2e/removed.spec.ts`, `apps/web/e2e/gui/removed.capture.ts` (new)

Must not change:
- Existing tests, `packages/**`, `apps/server/**`, `apps/web/src/design/**`, `apps/web/src/preview/**`, `App.tsx`, `main.tsx`, other `features/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Row helper | `pnpm --filter web exec vitest run src/features/removed/rows.test.ts` | every `rows.test.ts` test in the table passes |
| 2 | Components | `pnpm --filter web exec vitest run src/features/removed src/features/group-view src/features/org-view` | all pass, including the unchanged existing group-view and org-view tests |
| 3 | Existing tests untouched | `git diff main --stat -- 'apps/web/src/**/*.test.ts' 'apps/web/src/**/*.test.tsx' ':!apps/web/src/features/removed'` | empty output |
| 4 | E2E on every viewport | `pnpm --filter web run test:e2e` | exits 0, including `removed.spec.ts` on desktop-chromium, phone-chromium, phone-webkit and tv-chromium |
| 5 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `apps/web/gui-artifacts/removed/` has desktop, phone and TV PNGs, inspected against artboard 9 per `docs/gui-verification.md` |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `rows.test.ts` › `no removed items → total 0, empty lists` | empty case | always listing something |
| `rows.test.ts` › `removed member lists every position they hold here with title and group` | member rows | first position only |
| `rows.test.ts` › `removed occupied position names the occupant; vacant removed position has occupantName null` | position rows | crashing on vacancy |
| `rows.test.ts` › `a member removed and holding a removed position appears in both lists; total counts both` | overlap | dedup across lists |
| `rows.test.ts` › `proposal-only position (lineage never in baseline) is not listed` | relies on core rule | reimplementing with "missing from current" |
| `RemovedSummary.test.tsx` › `total 0 renders nothing` | hidden when clean | empty heading |
| `RemovedSummary.test.tsx` › `heading count, both subsections with counts, member line and position line texts` | artboard copy | wrong count; missing "held here by" |
| `RemovedSummary.test.tsx` › `only positions → no member subsection` | conditional sections | rendering empty sections |
| `GroupDetail removed` › `removed member's card shows REMOVED text and Removed from Current; others unchanged` | marker on affected card only | marking all cards of that member's group |
| `GroupDetail removed` › `removed position shows POSITION REMOVED and keeps its occupant name` | position marker | dropping the occupant |
| `GroupDetail removed` › `vacancy counts and + Proposed text unchanged with removed set` | SPEC: nothing else changes | altering counts |
| `OrganizationView removed` › `removed leader card shows REMOVED text` | level 2 marker | level 2 ignored |
| `removed.spec.ts` › `preview shows summary heading and both watermark texts; no horizontal scroll` | e2e on all viewports | layout overflow on phone |

## Edge cases (each needs a test)
- No removed items.
- A removed vacant position.
- One member holding two removed placements.
- A member who is both removed and occupying a removed position.

## Human checks
none

## Out of scope
- Disabling Accept and showing the eligibility reason (T-041, T-051).
- Markers on level-1 overview tiles.
- Mounting into the shell (T-030).
- Clearing `removed_date` (import, T-058).
