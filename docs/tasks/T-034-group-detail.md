# T-034: Level 3 — group detail and add position

**Milestone:** 4 — Desktop board
**Depends on:** T-070 (preview harness), T-008, T-012, T-016, T-020 (done).
- PLAN lists T-031 as a dependency. This task drops it on purpose, for the same reason as T-032.
- Runs alongside T-032 and T-033. Its only shared file is the one-line export in `packages/core/src/derive/index.ts`.

**Spec refs:**
- SPEC.md §4, level 3: every position with member cards, tags, preference matches, vacancies, and the add-position (+) control. This is the deepest level.
- SPEC.md §5: single-person callings and lists. A list is presented as a list, not as numbered boxes. Vacancies are labeled.
- SPEC.md §6: calling tags and affinities. A preference is never a requirement.
- SPEC.md §7: adding a position changes only this proposal, and is distinct from releasing.
- Artboards 2 (`OrgDetail.dc.html`) and 13 (`AddPosition.dc.html`).

## Goal
A pure core function `groupDetail` describes one top-level calling group:
- Its sections (the group itself and any nested groups).
- Each enabled assignment with its positions, occupants, member tags, preference matches and proposed flags.
- How many assignments are disabled.

`<GroupDetail>` renders it per artboards 2 and 13, and offers "+ Add position" and "+ Add group". Those controls validate their input and emit requests shaped exactly like core's `AddAssignmentRequest` and `AddCallingGroupRequest`. Sending the requests is T-030's job. A preview at `/__preview/group-view` shows the groups of the fixture proposal.

## Design decisions (binding)

### Core: `packages/core/src/derive/group-detail.ts`
```ts
export interface DetailPosition { readonly positionId: PositionId; readonly memberId: MemberId | null; readonly proposed: boolean; readonly preferenceMatches: readonly TagId[] }
export interface DetailAssignment {
  readonly assignmentId: AssignmentId; readonly title: string; readonly type: AssignmentType;
  readonly callingTagIds: readonly TagId[]; readonly preferredMemberTagIds: readonly TagId[];
  readonly positions: readonly DetailPosition[]; readonly filledCount: number;
}
export interface DetailSection { readonly callingGroupId: CallingGroupId; readonly name: string; readonly depth: number; readonly assignments: readonly DetailAssignment[] }
export interface GroupDetail { readonly callingGroupId: CallingGroupId; readonly name: string; readonly boardGroupId: BoardGroupId; readonly sections: readonly DetailSection[]; readonly disabledAssignmentCount: number }
export function groupDetail(board: Board, ward: Ward, callingGroupId: CallingGroupId, baseline: Board | null): GroupDetail;
```
- **Sections**: the first is the group itself at `depth 0`. Nested groups follow in depth-first `order` (then id), with `depth` equal to the nesting level.
- **Assignments**: only enabled ones, ordered by `order` (then id). Positions are ordered by `order` (then id).
- **`preferenceMatches`**: `preferenceMatches(board, ward, assignmentId, memberId)` for occupied positions; `[]` for vacant ones.
- **`proposed`**: the position is in `diffBoards(baseline, board).callings`. False when `baseline` is null.
- **`disabledAssignmentCount`**: disabled assignments anywhere in the group, including nested groups.
- **Errors**: an unknown group throws `TypeError`.
- Add one export line to `derive/index.ts`.

### Web: `apps/web/src/features/group-view/`
- **Component**: `GroupDetail.tsx` exports `<GroupDetail board ward baseline callingGroupId readOnly onAddPosition onAddGroup />`. It renders:
  - **Header**: "<org name> · <group name>". In nested sections, each section gets its own heading with the section name.
  - **Single assignments**: a titled card. Occupied → `PersonCard` with name, title, member tag names, and `proposed`. Vacant → `VacancySlot` with the title.
  - **List assignments**: a block headed by the title and "List · <filled> of <total> filled", followed by a vertical list of `PersonCard`s, then one `VacancySlot` per vacant position. There are no numbers or position indices.
  - **Preferences**: when an assignment has `preferredMemberTagIds`, it shows the text "Prefers <tag names>". An occupied card with matches shows "Matches preferred: <tag names>". A preference never blocks or warns.
  - **Card ids**: every card wrapper has `data-position-id`. Occupied wrappers also have `data-member-id`.
  - **Disabled assignments**: when `disabledAssignmentCount > 0`, the text "<n> optional roles off · not counted as vacancies".
  - **+ Add position**, per section: a `<button>` labelled "Add position to <section name>". It opens an inline form (not a modal) with:
    - Calling title: a text input with a label.
    - Type: two radio inputs, "Single person" and "List".
    - Positions: a number input with − and + buttons, shown only for List, default 2, range 1–50.
    - The helper text "Adds <n> vacant position(s) to this proposal only. Current and other proposals are unchanged."
    - "Cancel" and "Add position" buttons.

    On submit, it calls `onAddPosition({ groupId, title: title.trim(), type, positionCount })`, where `positionCount` is 1 for Single. An empty trimmed title shows the inline error "Enter a calling title" and does not call. The form closes after a call and resets on Cancel.
  - **+ Add group**, once, at the bottom: a `<button>` "Add group to <group name>". It opens an inline form with a name input and a kind `<select>` (Class, Committee, Quorum, Other → `class`, `committee`, `quorum`, `other`). It calls `onAddGroup({ parent: { kind: 'callingGroup', id: callingGroupId }, name: name.trim(), kind })`. An empty name shows "Enter a group name".
  - **`readOnly`** (Current or Accepted): no add buttons or forms render.
  - **Layout**: every button is ≥44 px tall. The view never causes horizontal page scroll.
- **Preview**: `preview.tsx` default-exports `{ title: 'Group detail', render }`. It renders three groups of the proposal, stacked: the Relief Society teachers group, a Primary group, and the Sunday School group whose list gained a position. It also renders one group with `readOnly`. Callbacks append the received request as JSON text under the view, so GUI capture can prove what was emitted.

## Scope
May change:
- `packages/core/src/derive/group-detail.ts` (new), `packages/core/src/derive/index.ts` (one export line), `packages/core/test/derive/group-detail.test.ts` (new)
- `apps/web/src/features/group-view/**` (new)
- `apps/web/e2e/gui/group-view.capture.ts`, `apps/web/e2e/group-view.spec.ts` (new)

Must not change:
- Other `packages/core/**` files, `apps/web/src/App.tsx`, `main.tsx`, `apps/web/src/design/**`, `apps/web/src/preview/**`, other `features/**`, `apps/server/**`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Core | `pnpm --filter @wardboard/core exec vitest run test/derive/group-detail.test.ts` | all pass |
| 2 | Component | `pnpm --filter @wardboard/web exec vitest run src/features/group-view` | all pass |
| 3 | Real-browser add position | `pnpm --filter web run test:e2e` | all projects pass, including `group-view.spec.ts` |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | `gui-artifacts/group-view/` with a default and an add-position-form-open screenshot at desktop and TV; inspected against artboards 2 and 13 |
| 5 | Typecheck, lint, quality gate | `pnpm -r typecheck && pnpm -r lint && ./scripts/verify.sh` | exit 0 |

## Unit tests to write
`group-detail.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `sections are the group then nested groups depth-first with depth` | — | nested groups dropped or flattened without depth |
| `only enabled assignments, ordered` | — | disabled shown as vacancies |
| `disabled count includes nested groups` | — | — |
| `list positions ordered with filled count` | — | — |
| `preference matches only for occupants with matching tags` | fixture Elders Quorum instructor (prefers Teaches well) occupied by Quinn Mockup (Teaches well) → `[tag]`; vacant → `[]` | matches computed for vacancies, or ignore tags |
| `proposed flag from net diff, none without baseline` | — | — |
| `added list position appears as vacant` | after `addListPosition` | stale structure |
| `unknown group throws TypeError` | — | — |

`GroupDetail.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `list renders as a list with filled of total and no numbering` | no text matching `/#\d|\b\d+\./` inside the list | numbered boxes |
| `vacancies say Vacant with the title` | — | — |
| `prefers and matches text render; nothing blocks` | — | — |
| `add position single emits count 1 with trimmed title` | `'  Pianist '` → `{ groupId, title: 'Pianist', type: 'single', positionCount: 1 }` | count from the hidden field |
| `add position list emits the chosen count; minus stops at 1 and plus at 50` | — | out-of-range count |
| `empty title shows an error and does not emit` | — | — |
| `cancel closes and resets the form` | — | stale input |
| `add group emits parent, trimmed name and kind` | — | — |
| `readOnly hides add controls` | — | editing Current |
| `cards carry position and member ids` | — | — |

`e2e/group-view.spec.ts` (desktop-chromium)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `fill the add position form and see the emitted request` | on `/__preview/group-view`, open the form, choose List, press + once (3), type a title, submit → the page shows the JSON request with `"positionCount":3` | real-browser form wiring |

## Edge cases (each needs a test)
- A group with no enabled assignments: shows "No positions yet." and still shows "+ Add position".
- A list assignment with zero positions: "List · 0 of 0 filled".
- `readOnly`.
- Validation errors, in the tests above.

## GUI verification
Required. At desktop and TV, capture the default view and the view with the form open. Use one phone capture only to check for no horizontal scroll; phones get T-048 and T-049. Check against artboards 2 and 13:
- The list reads as a list.
- Vacant slots are dashed and labeled.
- The form fields have visible labels.
- Buttons are ≥44 px.
- There is no overlap.

## Human checks
none

## Out of scope
- Sending operations, which needs the sync layer (T-030 wires `onAddPosition` and `onAddGroup` to `addAssignment` and `addCallingGroup`).
- Drag and drop (T-035).
- Removing or trimming positions in the UI.
- The tag editor (T-039).
- Removed markers (T-040).
- Notes (T-037).
