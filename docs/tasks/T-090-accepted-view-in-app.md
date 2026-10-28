# T-090: Accepted view and Accept in the app

**Milestone:** 4 — Desktop board (integration)
**Depends on:** T-087, T-043 (done), T-082 (done). All `done`.
- Promoted from B-042. Runs in parallel with T-088 and T-089, which share none of its files.

**Spec refs:**
- SPEC.md §3:
  - Draft/Accepted status: Accepted is read-only, and setting the status back to Draft reverses it.
  - Accepted list.
  - Acceptance is blocked by removed members or positions and by unapproved placements.
  - The frozen per-bishopric summary with copy actions.
  - Who accepted, and when.
- SPEC.md §12 has the acceptance scenarios.
- Artboard 26 (`Accepted.dc.html`).

### Integration conventions
The T-083 integration conventions apply: put new wiring in a new shell file and keep `BoardShell.tsx` edits minimal; leave existing tests unchanged; use the fake `WebSocketLike` + `SyncClient` pattern; run e2e against the checkout server on all four projects with real input; do the GUI capture of `/`; keep the phone layout unchanged. Per T-084, e2e tests accept and reopen only a Draft proposal they create (`apps/web/e2e/support/proposals.ts`).

## Goal
- On a proposal board, a **Status** button in the status strip opens T-043's `AcceptedView` for that proposal. From there the user can accept it (blocked with reasons when core rules forbid it), return it to Draft, and copy the frozen summary.
- On Current, an **Accepted proposals** button opens the same view on the newest accepted proposal. It shows only when at least one proposal is accepted.

## Design decisions (binding)
- New `apps/web/src/shell/AcceptedMode.tsx`.
- `BoardShell.tsx` keeps a local `acceptedOpen` flag, like `summaryOpen`, and renders `<AcceptedMode>` in place of the canvas area. The header stays visible.
- Switching tabs closes the view. Opening Summary and the accepted view are mutually exclusive.
- The `BoardShell.tsx` edit is limited to: the import, the flag, the two buttons in the status strip, and the conditional render.
- **History:** `boards.proposals` filtered to `status === 'accepted'` with a non-null `acceptedAt`, mapped to `{ id, name, acceptedAt }`. `AcceptedView` sorts it.
- **Selection:**
  - The initial `selectedId` is the open proposal's id when it was opened from a proposal. From Current it is the newest accepted proposal.
  - `onSelect(id)` changes `selectedId` within the view. It does not switch tabs.
- **Detail:**
  - `client.getProposal(selectedId)` runs on open, on selection change, and whenever that proposal's `boards` entry changes (version, status or `acceptedAt`).
  - It maps to `AcceptedView`'s `proposal` prop. Until it arrives, show `Loading…` in place of the view body.
  - A refusal shows a `role="alert"` with the message.
- **blockReasons:**
  - When the selected proposal is the subscribed proposal and is a Draft, compute `acceptBlockReasons(proposal, current, ward)` (T-043 helper). Build the core `Proposal` from the proposal view, `baseline` and `board`, as `SummaryMode` does. `current` comes from `useCurrentBoard()`.
  - While Current is loading, pass `['Loading Current…']`, so Accept stays disabled until eligibility is known.
  - For any other selection, pass `[]`. Other proposals in the list are Accepted, and the server still enforces the rules.
- **onSetStatus:** `client.setProposalStatus(selectedId, status)`, mapped to `RequestResult`. The `statusChanged` and `boards` pushes then refetch the detail through the boards-entry rule above.
- **copy:** `navigator.clipboard.writeText`.
- **onExit:** clears the flag.

## Scope
May change:
- `apps/web/src/shell/AcceptedMode.tsx` (new)
- `apps/web/src/shell/accepted-mode.test.tsx` (new)
- `apps/web/src/shell/BoardShell.tsx` (the minimal edit above)
- `apps/web/e2e/accepted-mode.spec.ts` (new)
- `apps/web/e2e/gui/accepted-mode.capture.ts` (new)

Must not change: `features/**` (including `features/accepted`), `PersonPanel.tsx`, `board-levels.tsx`, `SettingsRoute.tsx`, `sync/**`, server, packages, and existing tests.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/accepted-mode.test.tsx` | all pass |
| 2 | Scope and existing tests | `git diff origin/main --name-only` | only paths under "May change"; no existing `*.test.*` file listed |
| 3 | Browser | `pnpm --filter web run test:e2e` | exits 0, with `accepted-mode.spec.ts` passing on all four projects (confirm with `pnpm exec playwright test -c e2e/playwright.config.ts e2e/accepted-mode.spec.ts`) |
| 4 | GUI | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/accepted-mode/` has the accepted view after accepting (desktop, phone ×2, TV) and the Draft state, compared with artboard 26 |
| 5 | Gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Status button on proposals only; Accepted proposals button on Current only when one is accepted` | entry points | a button that leads to an empty view |
| `opening fetches getProposal for the open proposal and shows its status` | detail wiring | the wrong id |
| `accepting sends setProposalStatus accepted; the boards push refetches and shows the frozen summary` | accept flow | a stale Draft view |
| `draft with a removed member placed: Accepted option disabled with the reason` | SPEC §3 block | accept allowed |
| `while Current loads, Accept is disabled` | race | accepting before eligibility is known |
| `refusal from the server shows the alert` | error path | swallowed |
| `Draft (editable) on an accepted proposal sends setProposalStatus draft` | reopen | — |
| `selecting another history entry fetches it without switching tabs` | Accepted list | a tab switch |
| `switching tabs closes the view; Summary and Status are exclusive` | shell state | a view stuck open |

`e2e/accepted-mode.spec.ts` (real server, its own Draft):
- Open Status, accept, and see `Accepted … by` and the bishopric blocks.
- On desktop-chromium only, with clipboard permissions: Copy all puts text on the clipboard.
- Reopen to Draft, and see the board editable again.

## Edge cases (each needs a test)
Covered above: no accepted proposals (no Current button), Current loading, a removed-member block, a refusal, a tab switch.

## Human checks
none

## Out of scope
- Phone changes screen with Accept (T-051).
- Showing who reopened a proposal (B-012).
- Changing `features/accepted`.
