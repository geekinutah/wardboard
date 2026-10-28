# T-044: Aaronic Priesthood view and oversight changes

**Milestone:** 4 — Desktop board
**Depends on:** T-018 (core oversight, `overseerOf`, `setOversight`, `clearOversight`), T-024 (operation registry), T-033 (`overseerLabel`), T-070 (preview harness). All `done`.
- Runs alongside T-071, T-040 and T-045, and shares no files with them. T-071 edits `ws/channel.ts`; this task edits only `ws/operations.ts`.

**Spec refs:**
- SPEC.md §4: oversight. Bishop → priests quorum is fixed by office. Counselor oversight of the other quorums can be changed.
- SPEC.md §7: Oversight is board-owned and is not a calling. Bishop → priests quorum is fixed; every other entry is editable.
- SPEC.md §12:
  - The bishop appears in the priests quorum as a fixed, linked reference.
  - Reassigning counselor oversight produces no suggested callings or releases.
- Artboard 16 (`docs/design/ui-canvas/Aaronic.dc.html`).

## Goal
- Clients can change oversight through the operation channel, using two new op kinds, `setOversight` and `clearOversight`. These map to the existing core functions. A fixed target is refused.
- A standalone `<AaronicView>` shows each Aaronic quorum, matching artboard 16:
  - its positions;
  - an "Overseen by" label;
  - a Change control on every non-fixed quorum.
  - In the priests quorum, the bishop appears as a fixed linked card.
- Choosing an overseer emits a request shaped exactly like core's `SetOversightRequest`. Sending it is T-030's job.
- A preview is available at `/__preview/aaronic`.

## Design decisions (binding)

### Server registry (`apps/server/src/ws/operations.ts`)
- Register `setOversight` with request `{ target: { kind: 'boardGroup' | 'callingGroup', id }, overseer: 'bishop' | 'first_counselor' | 'second_counselor' }`, and `clearOversight` with request `{ target }`.
- Validate the shape strictly, the same way as existing entries. Unknown keys or values → `bad_request`.
- Core's `fixed_oversight` error passes through unchanged as the rejection code.
- Update the comment that says oversight is absent.
- No change to `channel.ts`.

### Component (`apps/web/src/features/aaronic/`)
`<AaronicView board ward baseline boardGroupId readOnly onSetOversight={(req: SetOversightRequest) => void} />`
- Renders the board group `boardGroupId`. For each top-level calling group in it (quorums, in `order`):
  - a heading;
  - an `Overseen by {overseerLabel(overseerOf(...))}` line;
  - the group's positions, the same way as T-034 cards: occupant name and calling title, vacancies labeled `Vacant`, and `+ Proposed` from the diff against `baseline`.
- **Fixed entry.** For a calling group with a `fixed: true` oversight entry (the priests quorum):
  - The line reads `Overseen by Bishop · fixed by office`, with no Change control.
  - The group shows a **linked bishop card**: the member who holds the bishop position on this board (or `Vacant`), with the text `Presides by office · linked from Bishopric`.
  - That card is a link-style `<button>` that calls `onOpenBishopric()` (an optional prop). It is not a placement in this group and is never counted in this group's vacancy or filled counts.
- **Non-fixed quorums** have a `Change` button (at least 44 px).
  - It opens an inline radio group: Bishop, First Counselor, Second Counselor, with the current overseer checked.
  - Confirm emits `onSetOversight({ target: { kind: 'callingGroup', id }, overseer })`. Cancel closes the group without emitting.
  - Choosing the current overseer and confirming emits nothing.
- `readOnly` hides every Change control.
- Never color-only. Touch targets are at least 44 px.

### Preview (`features/aaronic/preview.tsx`)
The fixture proposal's Young Men / Aaronic Priesthood board group. Emitted requests are appended as JSON text under the view, the same pattern as the T-034 preview.

## Scope
May change:
- `apps/server/src/ws/operations.ts` (two registry entries and the comment)
- `apps/server/test/ws/oversight.test.ts` (new)
- `apps/web/src/features/aaronic/**` (new)
- `apps/web/e2e/aaronic.spec.ts`, `apps/web/e2e/gui/aaronic.capture.ts` (new)

Must not change:
- `apps/server/src/ws/channel.ts`, `packages/**`, existing tests, other `features/**`, `apps/web/src/design/**`, `apps/web/src/preview/**`, `App.tsx`, `main.tsx`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Oversight ops over the channel (real server, ephemeral port, fixture identity) | `pnpm --filter @wardboard/server exec vitest run test/ws/oversight.test.ts` | every `oversight.test.ts` test in the table passes |
| 2 | Component | `pnpm --filter web exec vitest run src/features/aaronic` | every `features/aaronic` test passes |
| 3 | Existing tests unchanged and green | `git diff main --stat -- apps/server/test/ws/registry.test.ts apps/server/test/ws/operations.test.ts && pnpm --filter @wardboard/server test && pnpm --filter web test` | empty diff; both runs exit 0 |
| 4 | E2E | `pnpm --filter web run test:e2e` | exits 0, including `aaronic.spec.ts` on all four projects |
| 5 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/aaronic/` has desktop, phone and TV PNGs (default and Change open), inspected against artboard 16 |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `oversight.test.ts` › `setOversight on teachers quorum commits, broadcasts, and overseerOf changes` | wiring | not registered |
| `oversight.test.ts` › `setOversight on the priests quorum → rejected fixed_oversight, version unchanged` | fixed by office | bypassing core |
| `oversight.test.ts` › `oversight change produces no suggested callings or releases (diff empty vs before)` | SPEC §12 | oversight leaking into diff |
| `oversight.test.ts` › `clearOversight reverts to the inherited overseer` | clear | wrong target matching |
| `oversight.test.ts` › `bad overseer value or extra keys → bad_request` | strict shape | permissive parse |
| `oversight.test.ts` › `setOversight on an Accepted proposal → not_editable` | read-only | skipping status check |
| `AaronicView.test.tsx` › `priests quorum shows the linked bishop card text and no Change control` | fixed display | Change shown on fixed |
| `AaronicView.test.tsx` › `bishop card is not counted in the priests quorum filled/vacant counts` | not a placement | counting it |
| `AaronicView.test.tsx` › `vacant bishop shows Vacant on the linked card` | edge | crash on vacancy |
| `AaronicView.test.tsx` › `Change → pick Second Counselor → confirm emits SetOversightRequest exactly` | request shape | wrong target kind |
| `AaronicView.test.tsx` › `confirming the current overseer emits nothing; Cancel emits nothing` | no-op | duplicate commits |
| `AaronicView.test.tsx` › `readOnly hides Change` | read-only | always editable |
| `AaronicView.test.tsx` › `Overseen by label follows inheritance when a quorum has no own entry` | uses `overseerOf` | reading only direct entries |
| `aaronic.spec.ts` › `change oversight in the preview and see the emitted JSON; no horizontal scroll` | e2e on all viewports | broken interaction on phone |

## Edge cases (each needs a test)
- Vacant bishop.
- A quorum with no oversight entry of its own (inherited).
- Setting the overseer that is already current.
- Accepted proposal, fixed target, and invalid overseer value.

## Human checks
none

## Out of scope
- Sending requests and mounting in the shell (T-030).
- Oversight editing outside the Aaronic board group.
- Summary regrouping, which core T-018 already derives.
