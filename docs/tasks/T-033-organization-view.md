# T-033: Level 2 — organization

**Milestone:** 4 — Desktop board
**Depends on:** T-070 (preview harness), T-008, T-016, T-018 (done).
- PLAN lists T-031 as a dependency. This task drops it on purpose, for the same reason as T-032.
- Runs alongside T-032 and T-034. Its only shared file is the one-line export in `packages/core/src/derive/index.ts`.

**Spec refs:**
- SPEC.md §4 (Organization detail):
  - Leadership shown as cards.
  - Each group (class, committee, quorum) shown as a one-line summary with filled and vacant counts.
  - Keep enough organization context visible that people know where they are.
  - Bishopric support roles are clearly labeled as support roles.
- SPEC.md §4 (oversight): "Overseen by" appears on each affected organization or quorum.
- SPEC.md §5: vacancies are labeled "Vacant".
- Artboard 17 (`Zoom.dc.html`), level 2. Artboard 2 (`OrgDetail.dc.html`) for card styling.

## Goal
A pure core function `organizationView` returns, for one board group:
- Its overseer.
- Its leadership positions.
- One summary row per non-leadership top-level calling group, with filled and vacant counts and the overseer.

`<OrganizationView>` renders this as leadership cards and group rows. Each row is a zoom target. A preview at `/__preview/org-view` shows every organization of the fixture proposal.

## Design decisions (binding)

### Core: `packages/core/src/derive/organization.ts`
```ts
export interface OrgLeadershipCard { readonly positionId: PositionId; readonly assignmentId: AssignmentId; readonly title: string; readonly memberId: MemberId | null; readonly proposed: boolean }
export interface OrgGroupRow { readonly callingGroupId: CallingGroupId; readonly name: string; readonly filledCount: number; readonly vacantCount: number; readonly overseer: Overseer }
export interface OrganizationView {
  readonly boardGroupId: BoardGroupId; readonly name: string; readonly overseer: Overseer;
  readonly leadership: readonly OrgLeadershipCard[]; readonly groups: readonly OrgGroupRow[];
}
export function organizationView(board: Board, boardGroupId: BoardGroupId, baseline: Board | null): OrganizationView;
```
- **Leadership groups**: the board group's top-level calling groups whose `kind` is `presidency` or `bishopric`.
  - `leadership` lists every position of their enabled assignments, in structural order, including secretaries.
  - Leadership groups produce no row.
- **Rows**: every other top-level calling group, ordered by `order` (then id).
  - Counts roll up the group and all of its nested groups. Only enabled assignments count.
  - `overseer = overseerOf(board, { kind: 'callingGroup', id })`.
- **Overseer** of the view: `overseerOf(board, { kind: 'boardGroup', id: boardGroupId })`.
- **`proposed`**: the position is in `diffBoards(baseline, board).callings`. Always false when `baseline` is null.
- **Errors**: an unknown `boardGroupId` throws `TypeError`, matching the `overseerOf` convention.
- Add one export line to `derive/index.ts`.

### Web: `apps/web/src/features/org-view/`
- **Component**: `OrganizationView.tsx` exports `<OrganizationView board ward baseline boardGroupId selectedId? />`. It renders:
  - **Context line**: "Ward / <org name>" (the breadcrumb text), "Overseen by <Bishop|First Counselor|Second Counselor>", and "<n> vacant" for the whole organization.
  - **Leadership**: a section headed "Leadership". Each card shows:
    - Occupied: a `PersonCard` with name, title, and `proposed`.
    - Vacant: a `VacancySlot` titled with the position's title.
    - Every card wrapper carries `data-position-id`. Occupied cards also carry `data-member-id`, so double-click opens notes in T-031.
  - **Groups**: a section headed "Groups". Each row is one line, an element with `data-zoom-target="group:<callingGroupId>"` and `aria-label="<name>"`, showing:
    - The name.
    - "<filled> filled · <vacant> vacant". When vacant is 0 it shows "<filled> filled", with no vacancy text.
    - "Overseen by <…>", but only when the row's overseer differs from the organization's overseer.
    - `aria-current="true"` plus the accent border when selected.
  - **Bishopric**: in the Bishopric organization, the support group (`group_key = 'bishopric_support'`) row carries the visible text label "Support roles", from SPEC §4.
- **Overseer text**: `bishop` → "Bishop", `first_counselor` → "First Counselor", `second_counselor` → "Second Counselor".
- **Layout**: the view never causes horizontal page scroll. At TV size, row names are ≥20 px.
- **Preview**: `preview.tsx` default-exports `{ title: 'Organization view', render }`. It renders the view for every visible board group of the proposal, stacked, each under its own heading.

## Scope
May change:
- `packages/core/src/derive/organization.ts` (new), `packages/core/src/derive/index.ts` (one export line), `packages/core/test/derive/organization.test.ts` (new)
- `apps/web/src/features/org-view/**` (new)
- `apps/web/e2e/gui/org-view.capture.ts` (new)
- `apps/web/e2e/preview.spec.ts` and `apps/web/e2e/gui/preview.capture.ts` (remove only the `No previews yet.` line from T-070 so the index e2e/capture pass once feature previews exist; the zero-previews case remains covered by `src/preview/preview.test.tsx`)

Must not change:
- Other `packages/core/**` files, `apps/web/src/App.tsx`, `main.tsx`, `apps/web/src/design/**`, `apps/web/src/preview/**`, other `features/**`, `apps/server/**`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Core | `pnpm --filter @wardboard/core exec vitest run test/derive/organization.test.ts` | all pass |
| 2 | Component | `pnpm --filter @wardboard/web exec vitest run src/features/org-view` | all pass |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | `gui-artifacts/org-view/desktop-chromium.png` and `tv-chromium.png`; inspected against artboards 17 (level 2) and 2 |
| 4 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
`organization.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `presidency positions become leadership, including the secretary` | Relief Society: 4 cards in order President, First, Second, Secretary | prominent-only filter that drops the secretary |
| `bishopric group is leadership; support group is a row` | — | support roles shown as bishopric members |
| `rows roll up nested groups` | add a nested group with a vacancy under a class via `addCallingGroup` + `addAssignment` → parent row's vacant +1, and no separate row | nested groups listed as rows, or not counted |
| `disabled assignments are not counted` | — | — |
| `row overseer follows oversight with inheritance` | in Aaronic Priesthood the priests quorum row is `bishop` (fixed), and another quorum shows its assigned counselor | ignoring oversight entries |
| `org overseer defaults to bishop` | — | — |
| `proposed flag only for diff callings, none without baseline` | — | — |
| `unknown board group throws TypeError` | — | silent empty view |

`OrganizationView.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `context line shows breadcrumb, overseer and vacancy count` | — | — |
| `vacant leadership seat renders Vacant with its title` | — | — |
| `occupied leadership cards carry member and position ids` | — | the canvas can't open notes |
| `each group row is a labeled group zoom target` | — | — |
| `row hides vacancy text at zero and Overseen by when same as the org` | — | noisy rows |
| `bishopric support row is labeled Support roles` | — | — |
| `selected row has aria-current` | — | — |

## Edge cases (each needs a test)
- An organization with no leadership group: the Leadership section shows "No leadership positions."
- An organization with no rows: the Groups section shows "No groups."
- `baseline` null: no proposed markers.

## GUI verification
Required. Capture the preview at desktop and TV. Use one phone capture only to check for no horizontal scroll; phones get their own screens in T-048. Check:
- Cards align.
- Rows are one line at desktop width, or wrap without overlap.
- "Vacant" is visible.
- The "Overseen by" text is readable.

## Human checks
none beyond the T-032 TV readability check, which covers this view too once mounted.

## Out of scope
- Mounting in the canvas or shell.
- Dragging leaders or the hover-to-open behavior (T-035).
- Editing oversight (T-044).
- Removed markers (T-040).
- The person inspector (T-037).
