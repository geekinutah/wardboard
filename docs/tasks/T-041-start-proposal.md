# T-041: Read-only Current and Start proposal

**Milestone:** 4 — Desktop board
**Depends on:** T-025 (done). T-004 components and T-070 previews are done.
- PLAN lists T-030 as a dependency. T-030 is done, but this task does not mount anything in the shell. It is a standalone preview, like T-032 to T-036. Mounting the bar and dialog in `BoardShell`, adding a sync-client method for the server's `createProposal` message, and opening the new proposal's tab is a later integration task.
- T-035 (drag and drop, not started) must use `boardEditability` from this task to decide whether dragging is allowed. This task does not implement dragging.
- No shared files with the in-flight T-038, T-040, T-042, T-072, or T-052, or with T-037.

**Spec refs:**
- SPEC.md §3 Current: Current is read-only. Its cards cannot be dragged and no placement can be edited there. Display the import date prominently. A **Start proposal** button, never a drag action, creates a proposal from Current or duplicates an existing proposal, with a name and an optional rationale.
- SPEC.md §3 Proposed: a duplicate copies its source arrangement and keeps the source's baseline. An Accepted proposal is read-only.
- SPEC.md §12: "Current cannot be edited by dragging; Start proposal creates a proposal from Current or a duplicate."
- Server rules (`apps/server/src/proposals/meta.ts` `validateMeta`; `apps/server/src/ws/channel.ts` `createProposal`): name trimmed, 1 to 80 characters; rationale trimmed, at most 500, empty means `null`; characters counted as `Array.from(s).length`; `source` is `{ kind: 'current' }` or `{ kind: 'proposal', proposalId }`.
- Artboard 15 (`docs/design/ui-canvas/StartProposal.dc.html`).

## Goal
A pure `boardEditability` rule says when a board can be edited and why not. `<CurrentReadOnlyBar>` states that Current is read-only, shows the import date, and offers Start proposal. `<StartProposalDialog>` collects source, name, and rationale and hands the exact `createProposal` body to a callback. A preview at `/__preview/proposals` renders them. Nothing is sent to the server.

## Design decisions (binding)

### `apps/web/src/features/proposals/editability.ts`
```ts
export type Editability =
  | { editable: true }
  | { editable: false; reason: 'current' | 'baseline' | 'accepted' | 'unknown' };

export function boardEditability(
  board: Pick<Board, 'kind'>,
  proposal: { status: ProposalStatus } | null,
): Editability;
```
- `board.kind === 'current'` → `{ editable: false, reason: 'current' }`, whatever `proposal` is.
- `board.kind === 'baseline'` → `{ editable: false, reason: 'baseline' }`.
- `board.kind === 'proposal'` with `proposal?.status === 'accepted'` → `{ editable: false, reason: 'accepted' }`.
- `board.kind === 'proposal'` with `proposal?.status === 'draft'` → `{ editable: true }`.
- `board.kind === 'proposal'` with `proposal === null` (the proposal view has not loaded) → `{ editable: false, reason: 'unknown' }`. It fails closed.
- Uses `assertNever` from `@wardboard/core` for exhaustiveness over `BoardKind`.

### `apps/web/src/features/proposals/CurrentReadOnlyBar.tsx`
Exports `<CurrentReadOnlyBar importedAt onStartProposal />`, with `importedAt: string` (ISO timestamp from `boards.current.importedAt`) and `onStartProposal: () => void`.
- `<section aria-label="Current is read-only">`.
- Text `Current`, then `Read-only · imported {date}`, where `{date}` is `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })`, for example `Oct 24, 2026`. An `importedAt` that does not parse to a valid date shows `Read-only · import date unknown`. No throw, no `Invalid Date`.
- The sentence `Current can't be edited. Start a proposal to plan changes.`
- A primary button `Start proposal` that calls `onStartProposal()`. At least 44px tall.

### `apps/web/src/features/proposals/StartProposalDialog.tsx`
Exports `<StartProposalDialog importedAt proposals initialSource onCreate onClose />`:
- `importedAt: string`, formatted with the same rule as the bar.
- `proposals: readonly { id: string; name: string; status: ProposalStatus; tabOrder: number }[]`
- `initialSource?: { kind: 'current' } | { kind: 'proposal'; proposalId: string }` (default `{ kind: 'current' }`; a `proposalId` not in `proposals` falls back to Current)
- `onCreate: (request: CreateProposalRequest) => Promise<{ ok: true } | { ok: false; message: string }>`, where `CreateProposalRequest = { name: string; rationale: string | null; source: { kind: 'current' } | { kind: 'proposal'; proposalId: string } }` is exported from this folder. It is exactly the server's `createProposal` body without `type` and `requestId`.
- `onClose: () => void`

Behavior:
- `role="dialog"`, `aria-modal="true"`, labelled by the heading `Start a proposal`.
- A `<fieldset>` with legend `Start from`, holding radio buttons (one is always checked):
  - `Current`, with the detail `Baseline is today's Current ({date} import)`.
  - One per proposal, sorted by `tabOrder`: `Duplicate “{name}”`, with the detail `Copies its arrangement; keeps its original baseline`. An accepted proposal adds ` · Accepted` to the detail. Accepted proposals can be duplicated.
  - With no proposals, only `Current` is shown.
- A text input with accessible name `Name`, initially empty, and a textarea with accessible name `Rationale (optional)`, initially empty.
- Validation uses `Array.from(s.trim()).length`:
  - The trimmed name is empty → `Create proposal` disabled, no message.
  - The trimmed name is over 80 → `Name must be 80 characters or fewer.` and the button disabled.
  - The trimmed rationale is over 500 → `Rationale must be 500 characters or fewer.` and the button disabled.
- `Create proposal` calls `onCreate({ name: trimmedName, rationale: trimmedRationale === '' ? null : trimmedRationale, source })` exactly once. While pending, the button is disabled and reads `Creating…`, and further clicks or Enter do not call `onCreate` again.
- On `{ ok: true }`, call `onClose()`.
- On `{ ok: false, message }`, show `Could not create the proposal: {message}` in a `role="alert"` element, keep every input, and re-enable the button.
- `Cancel` and Escape call `onClose()` without calling `onCreate`.
- The name input receives focus when the dialog opens.
- Controls are at least 44px tall.

### Preview
`preview.tsx` default-exports `{ title: 'Start proposal', render }`. It renders a `CurrentReadOnlyBar` with `importedAt: '2026-10-24T15:00:00.000Z'` and a fictional proposals list: `Spring adjustments` (draft, tabOrder 1) and `Youth focus` (accepted, tabOrder 2). Start proposal opens the dialog. `onCreate` resolves `{ ok: true }` and the preview then shows a `role="status"` line: `Created “{name}” from Current` or `Created “{name}” as a duplicate of “{source name}”`. Nothing is sent anywhere.

## Scope
May change:
- `apps/web/src/features/proposals/**` (new)
- `apps/web/e2e/proposals.spec.ts`, `apps/web/e2e/gui/proposals.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit and component tests | `pnpm --filter @wardboard/web exec vitest run src/features/proposals` | all tests in `editability.test.ts`, `CurrentReadOnlyBar.test.tsx`, and `StartProposalDialog.test.tsx` pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `proposals.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `apps/web/gui-artifacts/proposals/` has desktop, phone (Chromium and WebKit), and TV PNGs for the bar and the open dialog, inspected against artboard 15 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`editability.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `current is never editable, even with a draft proposal view` | `{ kind: 'current' }` with `{ status: 'draft' }` → `reason: 'current'` | checks only proposal status (Current draggable) |
| `baseline is never editable` | `reason: 'baseline'` | baseline treated as a proposal |
| `draft proposal is editable; accepted is not` | both statuses on a `proposal` board | accepted proposal editable |
| `proposal board without a proposal view fails closed` | `proposal: null` → `{ editable: false, reason: 'unknown' }` | defaults to editable while the view is loading |

`CurrentReadOnlyBar.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `shows Read-only with the UTC import date` | `2026-10-24T23:30:00-07:00` renders `Oct 25, 2026` (UTC) | local-time formatting |
| `an invalid import date says import date unknown` | `importedAt: 'not a date'` | `Invalid Date` shown, or throws |
| `Start proposal calls back once` | click | not wired |

`StartProposalDialog.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Current is checked by default and its detail names the import date` | detail `Baseline is today's Current (Oct 24, 2026 import)` | no default; date missing |
| `lists proposals in tabOrder with Accepted marked` | given out of order, rendered `Spring adjustments` then `Youth focus`; the second detail includes `· Accepted` | unsorted; accepted omitted |
| `no proposals shows only Current` | empty list | empty fieldset or a crash |
| `initialSource selects a duplicate; an unknown id falls back to Current` | both cases | unknown id leaves nothing checked |
| `creates from Current with a trimmed name and null rationale` | name `  Fall plan  `, rationale blank → `onCreate` called once with `{ name: 'Fall plan', rationale: null, source: { kind: 'current' } }`; then `onClose` | untrimmed; `''` rationale |
| `creates a duplicate with the chosen proposal id and rationale` | choose `Duplicate “Spring adjustments”` → `source: { kind: 'proposal', proposalId }` and the trimmed rationale | wrong source shape (server would reject) |
| `blank name disables Create` | whitespace-only name | allows an empty name |
| `name 80 allowed, 81 refused; rationale 500 allowed, 501 refused` | boundaries, with an emoji to prove code-point counting; messages shown on 81 and 501 | `.length` counting; off-by-one |
| `double click and Enter while pending call onCreate once and show Creating…` | pending promise | double create |
| `failure shows the message and keeps the inputs` | `{ ok: false, message: 'offline' }` → alert `Could not create the proposal: offline`; inputs kept; button re-enabled; `onClose` not called | inputs cleared; closes on failure |
| `Cancel and Escape close without creating` | both paths | Escape ignored; cancel creates |

`e2e/proposals.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `duplicate a proposal from the read-only bar` | `/__preview/proposals`: `Read-only · imported Oct 24, 2026` visible; Start proposal; choose `Duplicate “Youth focus”`; type a name; Create proposal; the dialog closes and the status line reads `Created “{name}” as a duplicate of “Youth focus”` | preview not wired; wrong source |
| `Escape closes the dialog without creating` | no status line appears | Escape ignored |

## Edge cases (each needs a test)
Covered above: no proposals, unknown initial source, invalid import date, UTC date boundary, blank name, name/rationale length boundaries (code points), empty rationale → null, accepted source, double submit, failed create, a proposal board with no proposal view.

## GUI verification
Required. Capture `/__preview/proposals` at desktop, phone (Chromium and WebKit), and TV: the bar alone, and the dialog with `Duplicate “Spring adjustments”` chosen and a name typed. Compare with artboard 15:
- `Read-only · imported {date}` and the Start proposal button are clearly visible.
- The dialog shows `Start from` with the radio options and details, Name, Rationale (optional), Cancel, and Create proposal.
- The checked option is distinguishable by more than color (the radio mark itself).
- No horizontal page scroll on the phone. Controls are at least 44px.
- The shell header and ward tiles in the artboard are outside this preview. Their absence is not a defect.

## Human checks
none

## Out of scope
- Mounting the bar or dialog in `BoardShell`, adding a `createProposal` method to the sync client, and switching to the new proposal's tab (later integration task).
- Disabling drag on Current. T-035 owns dragging and must consume `boardEditability`.
- Renaming, rationale editing, or status changes on existing proposals (T-043 and later).
- Any server change.
