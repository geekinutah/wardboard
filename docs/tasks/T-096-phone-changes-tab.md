# T-096: Phone changes tab and Accept

**Milestone:** 5 — Phone
**Depends on:** T-092 (phone layout at `/`), T-051 (`PhoneChanges` and `buildPhoneChangesModel`), T-095 (Search and Dugout on the live shell). All done.
- This is the last phone-shell task. Do not start another one from this contract.

**Spec refs:** SPEC.md §3 (a proposal is accepted or returned to Draft; acceptance is refused while removed items or unapproved placements remain) and §10 (the phone Changes tab). Artboard `docs/design/ui-canvas/PhoneChanges.dc.html`. The T-051 component already matches that artboard. This task mounts it in the live app and sends `setProposalStatus`.

## Goal
On the live phone app at `/`, the Changes tab replaces its placeholder. Current explains that it has no proposed changes. A Draft lists the net changes and can Accept when the existing model says it is eligible. An Accepted proposal shows `Accepted · read-only` and can return to Draft.

## Design decisions (binding)

### What is already built
Do not rewrite `PhoneChanges` or `buildPhoneChangesModel`. Do not edit `apps/web/src/features/phone-changes/**`.

`PhoneChanges` takes `model: PhoneChangesModel | null`, `onAccept`, and optional `onReopen`.

- `model === null` renders `Changes` and `Current is the baseline reference board and has no proposed changes.` It does not render `Accept proposal`.
- A draft model renders the subtitle, `Removed from Current · {n}` when there are removed items, and the three `<details>` sections `Suggested callings`, `Suggested releases`, and `Position changes`. Suggested callings starts open when that list is not empty. The other two start open only in the cases the component already implements.
- `Accept proposal` is enabled only when `model.canAccept` is true. A block reason is the model's `acceptBlockReason` text.
- An accepted model renders `Accepted · read-only`. `Return to Draft` renders only when `onReopen` is passed.

`buildPhoneChangesModel(proposal, current, ward)` needs a core `Proposal` whose `baseline` and `board` are the open proposal's boards, plus the Current board. An empty `createdAt` produces the subtitle `{name} · net only`. A parseable UTC `createdAt` produces `{name} vs. its {MMM D} baseline · net only`. On the Spring adjustments fixture, the model has one calling (`Ivy Notreal`, `Relief Society · Relief Society Teacher`), one release (`Ari Sample`, `Primary · Second Counselor`), one position change (`Added`, `Sunday School · Gospel Doctrine Teacher`), no removed items, and `canAccept === true`.

`useCurrentBoard()` already loads the Current board while a proposal is open. Use that value. Do not add another fetch for it, and do not edit `board-levels.tsx`.

`useSyncClient().setProposalStatus(proposalId, status)` sends `{ type: 'setProposalStatus', requestId, proposalId, status }` and resolves on `{ type: 'statusChanged', requestId, status }`. `getProposal(proposalId)` sends `{ type: 'getProposal', requestId, proposalId }` and resolves on `{ type: 'proposalDetail', requestId, proposal }`. A `rejected` reply resolves `{ ok: false, message }`. Do not edit `apps/web/src/sync/**`.

The snapshot's `ProposalView` has no `createdAt`. `getProposal`'s detail does.

### Changes replaces the placeholder
In `PhoneApp`, `activeTab === 'changes'` no longer renders `Placeholder`. Delete `Placeholder` and `TAB_TITLES` once nothing uses them. The app must not render `This screen isn't on phones yet.` or `Use desktop layout`.

When `board` or `ward` is null, keep the existing `Loading board…` paragraph.

When the open board is Current (`proposal === null`), render `PhoneChanges` with `model={null}`. Do not call `getProposal` or `setProposalStatus`.

When the open board is a proposal, render `Loading board…` until `baseline`, `board`, `ward`, and `useCurrentBoard()` are all non-null. Then render `PhoneChanges` with the model below. Do not render a partial model.

Build the core proposal the way `PhoneEditing`'s private helper does (`accepted: null`, `tabOrder: 0`, `updatedAt: ''`, `baseline`, `board`, and the view's id, name, rationale, and status), with `createdAt` from the `getProposal` detail for this proposal id. Until that reply, and when the reply fails, `createdAt` is `''`. Show no alert for a failed or missing detail. Request `getProposal` once per open proposal id while Changes is selected. Applying the detail must not send another `getProposal` for that id during the visit. Leaving Changes may ignore a late reply. Re-entering may request again. A detail for a different proposal id must not be shown.

### Accept and return to Draft
Read `me` as today. Call `setProposalStatus` only when `me !== null`.

- `onAccept` sends `setProposalStatus(proposal.id, 'accepted')` once. A second click before that promise settles sends nothing.
- Pass `onReopen` only when `me !== null` and `proposal.status === 'accepted'`. It sends `setProposalStatus(proposal.id, 'draft')` with the same one-at-a-time rule.
- When `me === null`, `onAccept` sends nothing. Omit `onReopen`, so `Return to Draft` stays hidden. Do not change `canAccept` to fake that.
- The screen follows the snapshot. A successful reply does not by itself flip Draft to Accepted. After the next snapshot whose `proposal.status` is `accepted`, the existing component shows `Accepted · read-only`. The same is true for a return to Draft.
- A refused call shows `role="alert"` with the server `message` and leaves the current snapshot's status on screen. No second sentence. An `ok: false` result with no message shows no alert.

Search, Dugout, and the Board tab stay as T-095 left them. Switching tabs still clears the person sheet and the pending organization.

### Allowed edits to existing tests and captures
`apps/web/src/shell/phone-app.test.tsx` may change only the Changes portion of `placeholder tabs link to the desktop layout`. Search still shows the search field and the helper sentence, and Dugout still shows its subtitle. Changes, on Current, shows `Current is the baseline reference board and has no proposed changes.` and does not show the placeholder sentence or `Use desktop layout`. The test may be renamed. Do not change its Search or Dugout assertions.

`apps/web/e2e/phone-search-live.spec.ts` may change only the Changes steps at the end of `search, dugout, and changes on the live phone` (the desktop-link lines). Expect the Current sentence instead of `Use desktop layout`. Leave every earlier step in that test, and leave `a draft can add to the dugout and place from it`, unchanged.

`apps/web/e2e/gui/phone-app.capture.ts` may change only the shot that currently clicks Changes and expects `Use desktop layout`. On Current's Changes tab, expect the Current sentence, expect no desktop link, keep the no-horizontal-overflow check, and write `changes-current` instead of `placeholder`. Leave the board, switcher, proposal, and desktop shots as they are.

Do not edit any other existing test, spec, or capture. If another existing test fails, stop and report BLOCKED. In particular, leave `e2e/phone-changes.spec.ts`, `e2e/phone-app.spec.ts`, and `e2e/start-proposal.spec.ts` alone.

New e2e proposal names must not contain `current` in any case (B-074). Do not accept the seeded `Spring adjustments` proposal from a browser test. Accept only a proposal the test creates.

## Scope
May change:
- `apps/web/src/shell/PhoneApp.tsx`
- `apps/web/src/shell/phone-app.css` (only a rule that keeps the Changes footer above the bottom tabs)
- `apps/web/src/shell/phone-app.test.tsx` (the Changes assertions named above, and new tests)
- `apps/web/e2e/phone-search-live.spec.ts` (the Changes steps named above)
- `apps/web/e2e/gui/phone-app.capture.ts` (the placeholder shot becomes `changes-current`)
- `apps/web/e2e/phone-changes-live.spec.ts` (new)
- `apps/web/e2e/gui/phone-changes-live.capture.ts` (new)

Must not change:
- `apps/web/src/features/phone-changes/**`, `PhoneEditing.tsx`, `PhoneSearch.tsx`, `PhoneDugout.tsx`, `PhoneBoard.tsx`, `apps/web/src/sync/**`, `apps/web/src/shell/board-levels.tsx`, `apps/server/**`, `packages/**`, `docs/**`, `playwright.config.ts`, `e2e/phone-changes.spec.ts`, `e2e/phone-app.spec.ts`, `e2e/start-proposal.spec.ts`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/shell/phone-app.test.tsx src/features/phone-changes` | every new test below passes; existing tests in those paths pass, with only the Changes assertion update named above |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/phone-changes-live.spec.ts e2e/phone-search-live.spec.ts` | passes on phone-chromium and phone-webkit; desktop-chromium and tv-chromium skip with `Phone changes apply to the phone projects` on the new spec and the existing `Phone search and dugout apply to the phone projects` on the search spec |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-changes-live/` has `changes-draft` PNGs for both `phone-chromium` and `phone-webkit`; `apps/web/gui-artifacts/phone-app/` has `changes-current-phone-chromium.png` and `changes-current-phone-webkit.png` |
| 4 | Red before green | run the updated Current Changes assertion before `PhoneApp` renders `PhoneChanges` | it fails because the Current sentence is absent and the placeholder is still there. Record that output. An import error is not the red result |
| 5 | Mutation | in a disposable worktree at the candidate, make `onAccept` send nothing, then run `src/shell/phone-app.test.tsx` | `Accept sends setProposalStatus accepted` fails; remove the worktree |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

The shell starts in the shared checkout. `cd` to this task's worktree first. Run at most one of `./scripts/verify.sh`, `pnpm --filter web run test:e2e`, and `gui:capture` in that worktree at a time. Playwright outside pnpm needs `PATH="$PWD/node_modules/.bin:$PATH"`, or run `./node_modules/.bin/playwright` from `apps/web`.

Open the new phone screenshots and compare them with `PhoneChanges.dc.html`. Overlap, clipping, horizontal scroll at 390px, the Accept control under the bottom tabs, or a touch target under 44px fails this task.

## Unit tests to write
`phone-app.test.tsx` uses the existing fake-socket harness, `openProposal`, and `receiveBaseline`. Reply to `getProposal` with `{ type: 'proposalDetail', requestId, proposal }` whose `createdAt` is `2026-01-04T00:00:00.000Z` and whose id is the open proposal. Reply to `setProposalStatus` with `{ type: 'statusChanged', requestId, status }`. Operation frames are not how status changes are sent.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Current changes has no proposal and does not fetch one` | on Current, Changes shows the baseline sentence, no `Accept proposal`, and no `getProposal` frame | rendering the placeholder, or fetching a proposal for Current |
| `a draft lists the net changes before the detail returns` | on Spring adjustments, before `proposalDetail`, Ivy Notreal is visible and the subtitle is `Spring adjustments · net only`. One `getProposal` frame uses that proposal id. After the Jan 4 reply, the subtitle is `Spring adjustments vs. its Jan 4 baseline · net only`. No second `getProposal` follows the reply | waiting forever on the detail, or using a hard-coded date |
| `a rejected proposal detail does not alert` | a `rejected` reply leaves `Spring adjustments · net only` and shows no alert | rendering the rejection message |
| `Accept sends setProposalStatus accepted` | with `me` set, one click sends one `{ type: 'setProposalStatus', proposalId, status: 'accepted' }`. A second click before the reply sends nothing. After `statusChanged` and a snapshot with `status: 'accepted'`, `Accepted · read-only` and `Return to Draft` are visible | flipping the screen before the snapshot, or sending two frames |
| `a refused accept stays on the draft` | a `rejected` reply with message `Resolve the 1 removed item to accept` shows that message in an alert, and `Accept proposal` remains | hiding the button after a refusal |
| `a signed-out accept sends nothing` | without `me`, clicking `Accept proposal` sends no `setProposalStatus` frame | accepting from a signed-out session |
| `Return to Draft sends setProposalStatus draft` | on an accepted proposal with `me` set, `Return to Draft` sends `status: 'draft'`. After that snapshot, `Accept proposal` is back. Without `me`, `Return to Draft` is absent | omitting `onReopen` for a signed-in accepted proposal |
| `changes waits for the Current board` | on a proposal, before the Current `getBoard` reply, Changes shows `Loading board…` and not Ivy Notreal | building the model without Current |

## Edge cases (each needs a test)
- Current shows the baseline sentence and sends nothing.
- The change lists render before `getProposal` returns. A rejected detail does not alert.
- Accept and Return to Draft each send one `setProposalStatus`, and only after `me` is set.
- A refusal stays on the snapshot's status and shows the server message.
- The screen follows the next snapshot, not the `statusChanged` reply alone.
- A proposal's Changes tab shows `Loading board…` until the Current board has loaded.

## Human checks
On an iPhone at `/`, open Changes on a Draft. Expand and collapse a section. The Accept bar should sit above the bottom tabs and stay usable with one hand. This check is pending. Do not claim it was performed.

## Out of scope
- The desktop Status screen and `AcceptedMode.tsx`.
- Changing eligibility rules, the diff, or the wording inside `PhoneChanges`.
- Search, Dugout, and the person sheet (T-095).
- Accepting the seeded Spring adjustments proposal from Playwright.
- `docs/**`, including STATUS.md.
