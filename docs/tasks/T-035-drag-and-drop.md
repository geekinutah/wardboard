# T-035: Drag and drop with dialogs

**Milestone:** 4 — Desktop board
**Depends on:** T-034 (group detail), T-036 (dugout panel), T-010 (swap / release occupant), T-011 (dugout ops), T-014 (second-calling), T-015 (needs approval), T-040 (removed markers, now in `GroupDetail`) — all `done`. **T-073 (`secondCallingNoticesWithOutside`) must be `done` before this task starts.**
- Standalone, like T-032 to T-038: a `<DndSurface>` that wraps existing views and emits operations through a callback, plus a preview. Mounting it around the canvas in `BoardShell` and sending the operations with the sync client's `send(kind, request)` is a later integration task.
- It reads the data attributes the shipped views already render, so it changes no other feature: group-view cards (`data-position-id`, plus `data-member-id` when occupied), org-view cards (`data-position-id`), the dugout panel (`data-drop-target="dugout"`, rows with `data-member-id`), and tiles/group rows (`data-zoom-target`).
- No shared files with in-flight T-037, T-041, T-042, T-046, T-047, T-053–T-055, T-063, T-073, T-074.

**Spec refs:**
- SPEC.md §3 Multiple callings: dragging from a slot releases only that calling and fills the destination; any placement that leaves a member with more than one calling needs confirmation citing General Handbook 30.1.1; moves and swaps that don't increase the count don't prompt; **outside callings count (CONFIRMED 2026-10-28)**; Add to dugout never warns.
- SPEC.md §5: drop on an occupied single calling offers Swap / Release occupant / Cancel, each describing its result; list drops add without displacing; dragging to the dugout releases that calling and records explicit inclusion.
- SPEC.md §4 item 9: an Out-of-Unit member can be dragged to the dugout with no warning.
- SPEC.md §6: needs-approval placements need explicit approval tied to member, position and proposal; any Editor or Admin may approve.
- SPEC.md §3 Current: Current is read-only; nothing can be dragged there.
- Artboards 2 (`OrgDetail.dc.html`, mid-drag and dugout tray as a drop target), 3 (`DropDialog.dc.html`), 4 (`Approval.dc.html`), 12 (`Confirm.dc.html`).
- Server operation names (read `apps/server/src/ws/operations.ts`, do not change it): `placeInPosition`, `addToList`, `swap`, `releaseOccupant`, `moveToDugout`, `addToDugout`, `approvePlacement` (request `{ memberId, positionId }`; the server fills baseline, approver and time).

## Goal
Pointer drag of a member card onto a position or the dugout produces the right core operation(s), after any required dialog: the occupied-calling choice, the second-calling confirmation (counting outside callings), and the needs-approval confirmation. Hovering a tile or group row while dragging asks the host to open it. A pure resolver holds all the decisions; the component only handles pointer input and dialogs. A preview at `/__preview/dnd` applies the operations locally with core.

## Design decisions (binding)

### Operations emitted (`apps/web/src/features/dnd/types.ts`)
```ts
export type DropOp =
  | { kind: 'placeInPosition'; request: PlaceInPositionRequest }
  | { kind: 'addToList'; request: AddToListRequest }
  | { kind: 'swap'; request: SwapRequest }
  | { kind: 'releaseOccupant'; request: ReleaseOccupantRequest }
  | { kind: 'moveToDugout'; request: MoveToDugoutRequest }
  | { kind: 'addToDugout'; request: AddToDugoutRequest }
  | { kind: 'approvePlacement'; request: { memberId: MemberId; positionId: PositionId } };

export type DragSource =
  | { kind: 'position'; memberId: MemberId; positionId: PositionId } // a card in a calling
  | { kind: 'dugout'; memberId: MemberId }                           // a dugout row
  | { kind: 'member'; memberId: MemberId };                          // any other member card (Out-of-Unit view, inspector)

export type DropTarget = { kind: 'position'; positionId: PositionId } | { kind: 'dugout' };
```
Request types are core's (`@wardboard/core`). Kinds are the server registry names, so the integration task can call `send(op.kind, op.request)` directly.

### Pure resolver (`apps/web/src/features/dnd/resolve.ts`)
```ts
export type DropPlan =
  | { kind: 'none' }                                         // nothing to do (same slot, dugout→dugout)
  | { kind: 'blocked'; message: string }                     // core refused; message from the core error
  | { kind: 'apply'; op: DropOp }                            // ready for preflight
  | { kind: 'choose'; options: readonly { choice: 'swap' | 'release_occupant'; op: DropOp }[] };

export function resolveDrop(board: Board, ward: Ward, source: DragSource, target: DropTarget): DropPlan;

export type Preflight = {
  secondCalling: OutsideAwareNotice | null;             // for the dragged member only
  approvals: readonly { memberId: MemberId; positionId: PositionId }[]; // newly unapproved requirements
};
export function preflight(proposal: Proposal | null, board: Board, ward: Ward, op: DropOp): Preflight;
```
`resolveDrop` rules (`from` = the source position for `position` sources, else `null`; use a deterministic `OperationContext` such as `sequentialIds('dnd-preview')` only to test operations; the ids are thrown away):
1. Target is the dugout: `position` source → `moveToDugout { memberId, from }`; `member` source → `addToDugout { memberId }`; `dugout` source → `none`.
2. Target position equals the source position → `none`.
3. Target position belongs to a **list** assignment (vacant or occupied) → `addToList { memberId, from, assignmentId }`.
4. Target is a **vacant single** position → `placeInPosition { memberId, from, to }`.
5. Target is an **occupied single** position → `choose`, with the options and order from core `occupiedDropOptions(board, ctx, { memberId, from, to })` (swap only when `from !== null`). No options → `blocked` with `That calling is filled and can't be swapped or released here.`
6. For `apply`, run the operation with core; if it fails, return `blocked` with the core error's `message` instead.

`preflight` rules:
- Run `op` with core to get `after` (an `approvePlacement` op never needs preflight).
- `secondCalling`: the entry of `secondCallingNoticesWithOutside(board, after, ward)` (T-073) whose `memberId` is the dragged member, else `null`. `moveToDugout` and `addToDugout` always give `null` (Add to dugout never warns).
- `approvals`: only when `proposal !== null` and `board.kind === 'proposal'`. Compare `unapprovedPlacements({ ...proposal, board }, ward)` with `unapprovedPlacements({ ...proposal, board: after }, ward)`; return the requirements present after but not before, as `{ memberId, positionId }`, in core's order. (A swap can create one for the displaced member.)

### Component (`apps/web/src/features/dnd/DndSurface.tsx`)
`<DndSurface board ward proposal me readOnly onCommit onHoverOpen hoverOpenDelayMs={700} children />`:
- `board: Board`, `ward: Ward`, `proposal: Proposal | null` (null on Current), `me: { displayName: string }`, `readOnly: boolean`
- `onCommit(ops: readonly DropOp[])` — called **once** per completed drop with the full sequence (the operation, then any `approvePlacement` ops). Never called on cancel.
- `onHoverOpen(target: string)` — the `data-zoom-target` value hovered while dragging for `hoverOpenDelayMs` (e.g. `org:…`, `group:…`).

**Sources (event delegation, no changes to wrapped views).** On `pointerdown` (primary button / touch / pen) inside the surface: the nearest ancestor with `data-member-id`. If it also has `data-position-id` → `position` source. Else if it is inside `[data-drop-target="dugout"]` → `dugout` source. Else → `member` source. Nothing else starts a drag. A drag starts only after the pointer moves more than 6px; a plain click still reaches the card (selection, double-click to notes keep working). `readOnly` → no drag ever starts.

**During a drag:**
- A ghost follows the pointer showing the member's name (and `Moving from {title}` for position sources). The page does not scroll or select text.
- The element under the pointer resolves to a target: nearest `[data-position-id]` → position; nearest `[data-drop-target="dugout"]` → dugout. A valid target gets `data-drop-active="true"`, an outline and the text `Drop here` (not color alone). Removed members and positions are allowed to be dragged; core decides.
- Hovering a `[data-zoom-target]` element for `hoverOpenDelayMs` without leaving it calls `onHoverOpen(value)` once per hover.
- Escape or `pointercancel` ends the drag with no effect.

**On drop:** `resolveDrop` →
- `none` → nothing.
- `blocked` → `role="alert"` with `Can't drop here: {message}`, dismissible, auto-cleared on the next drag.
- `choose` → **Drop dialog** (below); the chosen option's op continues to preflight.
- `apply` → preflight.
Then: if `secondCalling` → **Second-calling dialog**; then if `approvals` non-empty → **Approval dialog**; then `onCommit([op, ...approvals.map(approvePlacement)])`. Cancelling any dialog ends the drop with no commit.

All dialogs: `role="dialog"`, `aria-modal="true"`, labelled by their heading, focus moves into them, Escape = Cancel, buttons ≥44px, no `window.confirm`.

**Drop dialog** (artboard 3). Heading `{title} is filled`, subheading `{calling group name} · {title}`. Text `You dropped {A} onto {B}'s calling. Choose what this proposal should show.` A radio group with the available options in resolver order, first selected:
- `Swap` — `{A} takes {title}. {B} takes {source title}.`
- `Release occupant` — `{A} takes {title}. {B} is released from it.`
Then `Applied as one change for everyone viewing.`, `Cancel`, and a confirm button whose text is the selected option's name.

**Second-calling dialog** (artboard 12). Heading `Give {name} a second calling?` when `countAfter === 2`, else `Give {name} another calling?`. One line per `existing` calling `Already serves as {title}`; one line per `outside` calling `Serves outside the ward as {title} · {unit}`; `Adding {destination calling group name} · {destination title}`. Then the guidance, built from core `ONE_CALLING_GUIDANCE`: `The {source} says {text lowercased first letter}` → `The General Handbook 30.1.1 says a member generally serves in only one calling at a time.` Buttons `Cancel` and `Add second calling` (or `Add another calling`).

**Approval dialog** (artboard 4). Heading `Approval needed for this placement`. For each approval: `{name} is marked Needs approval.`, `Member {name}`, `Calling {calling group name} · {title}`, `Proposal {proposal.name}`. Then `Approval applies only to this member, position and proposal. Moving them elsewhere will ask again. WardBoard does not certify eligibility — consult the Handbook and official records outside this app.` A checkbox `I've reviewed this outside WardBoard and approve this placement for discussion.`, the text `Recorded as {me.displayName} · today`, and `Cancel` / `Approve placement` (disabled until checked).

### Preview (`apps/web/src/features/dnd/preview.tsx`)
Default-exports `{ title: 'Drag and drop', render }`. Inside one `<DndSurface>` for `data.proposal` (local React state for the proposal board), it renders: `GroupDetail` for **Relief Society Presidency** (Faye Pretend, Gwen Imaginary, Hana Madeup, Iris Demo) and **Relief Society Teachers** (list with one vacancy), `GroupDetail` for the group holding **Cy Mockup**'s Primary Teacher position (Cy is `needsApproval`), the `DugoutPanel`, and a small preview-only `Out-of-Unit` list (`<article data-member-id>` for **Kai Fictional**; T-074 replaces it later). `onCommit` applies each op in order with core (`approvePlacement` gets the preview baseline, `approvedBy: 'u-preview'`, a fixed `approvedAt`); a failure throws. A status line shows `Applied: {op kinds joined by ", "}`. `onHoverOpen` shows `Would open {target}`. `me.displayName` is `Preview Editor`. A `Show Current` toggle renders the same views for `data.current` with `readOnly`.

## Scope
May change:
- `apps/web/src/features/dnd/**` (new)
- `apps/web/e2e/dnd.spec.ts`, `apps/web/e2e/gui/dnd.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**` (import them, don't edit), `packages/**`, `apps/server/**`, existing tests, anything else

New dependencies allowed: none (no drag-and-drop library; use Pointer Events).

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Resolver and component tests | `pnpm --filter @wardboard/web exec vitest run src/features/dnd` | all tests in `resolve.test.ts` and `DndSurface.test.tsx` pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `dnd.spec.ts` on all four projects (real mouse drags on desktop/TV; touch drags on phone Chromium and WebKit) |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/dnd/` has desktop, phone (Chromium and WebKit) and TV PNGs of: mid-drag over a vacancy, the drop dialog, the second-calling dialog, the approval dialog, and after a dugout drop; inspected against artboards 2, 3, 4, 12 |
| 4 | No browser dialogs or native drag | `grep -rln -e "window.confirm" -e "window.alert" -e "window.prompt" -e "draggable=" apps/web/src/features/dnd` | no output |
| 4b | No new dependency | `git diff main --stat -- apps/web/package.json pnpm-lock.yaml` | empty output |
| 5 | Other features untouched | `git diff main --stat -- apps/web/src/features ':!apps/web/src/features/dnd'` | empty output |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`resolve.test.ts` uses `buildFixtureWard()` / `buildFixtureProposal()` and real core; `DndSurface.test.tsx` uses Testing Library with `fireEvent.pointerDown/Move/Up` (jsdom: stub `document.elementFromPoint` to return the intended element) and `vi.useFakeTimers()` for hover-open.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `vacant single from a calling → placeInPosition with from` | Gwen to a vacant single: op `{ memberId, from: gwenPos, to }` | `from` dropped (both callings kept) |
| `from the dugout → placeInPosition with from null` | Ivy Notreal (dugout) to the same vacancy | dugout source treated as a position |
| `list target adds without displacing, even on an occupied list slot` | drop on Jo Testwell's RS Teacher slot → `addToList` for the RS Teacher assignment | occupied list slot treated as single (swap offered) |
| `occupied single offers Swap then Release occupant from a calling` | Gwen onto Hana → `choose` `['swap','release_occupant']` | wrong order; release missing |
| `occupied single from the dugout offers only Release occupant` | Ivy onto Hana | swap offered with no source slot |
| `dugout target: position → moveToDugout, member → addToDugout, dugout → none` | three cases | Out-of-Unit drag releases nothing but is mapped to moveToDugout |
| `same slot is none; a core refusal is blocked with its message` | drop on own slot; drop that core rejects (e.g. a disabled assignment in a board copy) | silent failure |
| `second calling counts outside callings` | Kai (member source) to the RS Teacher vacancy → `secondCalling.outside` names `Stake Young Single Adult Adviser` | old `secondCallingNotices` used |
| `a move does not prompt; adding to a second calling does` | Gwen move → `null`; Jo Testwell (2 callings), explicitly added to the dugout with core `addToDugout`, then dropped from the dugout into a vacancy → notice with `countAfter: 3` | prompts on moves |
| `dugout drops never prompt` | Hal Testwell's TFH card to the dugout and Kai via addToDugout → `secondCalling: null`, `approvals: []` | warning on Add to dugout |
| `needs approval: Cy's move creates one approval requirement` | Cy to the RS Teacher list → `approvals: [{ Cy, newPosition }]` | requirement missed; existing approvals repeated |
| `no approvals on Current` | `proposal: null` | approval asked on a read-only board |
| `drag starts only after 6px and never when readOnly` (`DndSurface.test.tsx`) | 5px move → click still delivered, no ghost; `readOnly` → no ghost | clicks swallowed; Current draggable |
| `direct drop commits once` | Ivy → vacancy → `onCommit([{ kind: 'placeInPosition', … }])` once | double commit |
| `drop dialog: radio choice, confirm label, Cancel` | Gwen onto Hana: heading `{Hana's calling title} is filled`; selecting Release occupant changes the button text; Cancel → no commit; confirm → one `releaseOccupant` | wrong op; commit on cancel |
| `second-calling dialog names outside callings and the Handbook` | Kai → vacancy: `Serves outside the ward as Stake Young Single Adult Adviser · Example Stake`, `The General Handbook 30.1.1 says…`; `Add second calling` commits `addToList`; Cancel commits nothing | outside callings omitted; guidance text hard-coded differently |
| `approval dialog requires the checkbox and appends approvePlacement` | Cy → RS Teachers: `Approve placement` disabled until checked; commit is `[addToList, approvePlacement{Cy, pos}]`; `Recorded as Preview Editor · today` | placement committed without approval op; approval op without placement |
| `both dialogs appear in order: second calling, then approval` | a needs-approval member gaining a second calling (ward copy setting `needsApproval` on Jo Testwell) | order swapped; one skipped |
| `blocked drop shows an alert and commits nothing` | refused drop → `Can't drop here: …` | silent |
| `hovering a tile opens it after the delay, once` | drag over `[data-zoom-target="org:x"]` 699ms → no call; 700ms → `onHoverOpen('org:x')` once; leaving and returning restarts the timer | fires immediately; fires repeatedly |
| `Escape cancels a drag` | Escape mid-drag, then pointerup over a vacancy → no commit | Escape ignored |

`e2e/dnd.spec.ts` (`/__preview/dnd`)
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `drag from the dugout into a vacancy places the member` | mouse (touch on phone) drag Ivy → RS Teacher vacancy → `Applied: addToList`; Ivy shown in the list | pointer handling broken in a real browser |
| `drop on an occupied calling offers Swap` | Gwen → Hana → dialog → Swap → `Applied: swap` | dialog unreachable |
| `out-of-unit member asks for a second calling` | Kai → vacancy → second-calling dialog → confirm | outside callings not counted |
| `Current cannot be dragged` | `Show Current`, try a drag → nothing changes, no dialog | read-only ignored |

## Edge cases (each needs a test)
Covered above: same slot, dugout→dugout, list vs single, occupied single from calling vs from dugout, core refusal, move vs addition, outside callings, Add to dugout without warning, needs approval (including created by a swap — add a resolver test with a ward copy where the displaced member is `needsApproval`), both dialogs, Current, threshold vs click, Escape, hover-open timing.

## GUI verification
Required. Capture `/__preview/dnd` at desktop, phone (Chromium and WebKit, touch drag) and TV: mid-drag over a vacancy (ghost and `Drop here` visible), the drop dialog, the second-calling dialog, the approval dialog, and the dugout after a drop. Compare with artboards 2, 3, 4, 12:
- Dialog text is complete, unclipped, and fits 390 × 844 with no horizontal scroll; buttons ≥44px.
- The drop target highlight carries text, not only color; the ghost doesn't hide the target.
- The preview's simple Out-of-Unit list is a stand-in; its look is not a defect.

## Human checks
- In Chrome on a desktop (after integration): drag several cards between groups and onto the dugout; confirm the ghost tracks smoothly and the drop target is obvious.
- On an iPhone: the phone uses tap-to-move (T-049); confirm a long press on a card does not start an awkward drag or page scroll in the desktop layout if it is ever shown.

## Out of scope
- Mounting `DndSurface` in `BoardShell`/`Canvas` and sending ops through the sync client (later integration task), including real canvas zoom on `onHoverOpen`.
- Keyboard-driven moves (not in SPEC; phone tap-to-move is T-049).
- Showing preference matches on the ghost (artboard 2 detail): optional polish, not required.
- Changing any shipped view to add drag attributes.
