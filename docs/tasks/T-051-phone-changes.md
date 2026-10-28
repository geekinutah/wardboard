# T-051: Phone changes screen

**Milestone:** 5 — Phone
**Depends on:** T-047 (phone shell), T-016 (net diff), T-017 (removed state and acceptance eligibility), T-015 (unapproved placements). All `done`.
- Standalone preview, same rule as T-047 and T-048. It does **not** change `App.tsx` or mount the phone layout at `/`.
- No shared files with in-flight T-049 (`features/phone-person`) or T-050 (`features/phone-search`, `features/phone-dugout`).

**Spec refs:**
- SPEC.md §3: compare the proposed arrangement with the saved baseline to derive suggested callings, suggested releases, and position changes (net only). A proposal cannot be accepted while it places a removed member, contains a removed position, or has an unapproved placement that requires approval.
- SPEC.md §5: never rely on color alone (`+` for suggested callings, `−` for suggested releases, `±` for position changes, cross-hatch + watermark + text for removed items).
- SPEC.md §8: removed members and positions in proposals are shown with a removed marker and block acceptance until resolved.
- `docs/design/ui-canvas/PhoneChanges.dc.html` (artboard 24).

## Goal
`<PhoneChanges>` renders the phone Changes tab screen: a header naming the proposal and its baseline date (`{name} vs. its {MMM D} baseline · net only`), a `Removed from Current · {n}` section when the proposal has removed members or positions, three collapsible `<details>` sections (`+ Suggested callings`, `− Suggested releases`, `± Position changes`), and an `Accept proposal` action bar that is disabled with a clear reason when removed items or unapproved needs-approval placements remain (or allows accepting / reopening when eligible). A preview at `/__preview/phone-changes` renders it inside `PhoneShell`. Nothing is sent to the server.

## Design decisions (binding)

### Model (`apps/web/src/features/phone-changes/model.ts`)

```ts
export interface PhoneRemovedItemRow {
  readonly key: string;
  readonly kind: 'member' | 'position';
  readonly headline: string; // member: member.name; position: "{org} · {title}"
  readonly detail: string;   // member: "Member removed · {titles joined by ', '} here"; position: "Position removed · held by {name}" or "Position removed · vacant here"
}

export interface PhoneChangeRow {
  readonly key: string;
  readonly who: string;  // callings/releases: member.name; position changes: 'Added' | 'Trimmed'
  readonly what: string; // "{org} · {title}"
}

export interface PhoneChangesModel {
  readonly proposalName: string;
  readonly status: 'draft' | 'accepted';
  readonly subtitle: string; // "{proposalName} vs. its {MMM D} baseline · net only" (or "{proposalName} · net only" if createdAt is unparseable)
  readonly removedItems: readonly PhoneRemovedItemRow[];
  readonly callings: readonly PhoneChangeRow[];
  readonly releases: readonly PhoneChangeRow[];
  readonly positionChanges: readonly PhoneChangeRow[];
  readonly canAccept: boolean;
  readonly acceptBlockReason: string | null;
}

export function buildPhoneChangesModel(
  proposal: Proposal,
  current: Board,
  ward: Ward,
): PhoneChangesModel;
```

- Uses only core `proposalDiff(proposal)`, `removedState(proposal, current, ward)`, `unapprovedPlacements(proposal, ward)`, and `rootBoardGroupOf` to compute changes and eligibility.
- `subtitle`: formats `proposal.createdAt` using `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })` → `${proposal.name} vs. its ${dateStr} baseline \u00B7 net only` (if `Date.parse(proposal.createdAt)` is `NaN`, `${proposal.name} \u00B7 net only`).
- `removedItems`:
  - First, for each entry in `removedState(proposal, current, ward).members`:
    - `member = ward.members[entry.memberId]`.
    - Lookup each `positionId` in `entry.positionIds` on `proposal.board` to get its `assignment.title`.
    - `headline = member.name`, `detail = "Member removed \u00B7 " + titles.join(', ') + " here"`.
  - Next, for each `positionId` in `removedState(proposal, current, ward).positions`:
    - Lookup `slot = proposal.board.positions[positionId]`, `assignment = proposal.board.assignments[slot.assignmentId]`, and root board group `org = proposal.board.boardGroups[rootBoardGroupOf(proposal.board, assignment.groupId)].name`.
    - `occupantId = proposal.board.placements[positionId]`.
    - `headline = "${org} \u00B7 ${assignment.title}"`.
    - `detail = occupantId !== undefined ? "Position removed \u00B7 held by " + ward.members[occupantId].name : "Position removed \u00B7 vacant here"`.
- `callings`: `proposalDiff(proposal).callings` in core order. `who = ward.members[entry.memberId].name`, `what = "${org} \u00B7 ${entry.title}"` where `org` is looked up on `proposal.board`.
- `releases`: `proposalDiff(proposal).releases` in core order. `who = ward.members[entry.memberId].name`, `what = "${org} \u00B7 ${entry.title}"` where `org` is looked up on `proposal.baseline`.
- `positionChanges`: `proposalDiff(proposal).addedPositions` (`who = 'Added'`, `org` on `proposal.board`) followed by `proposalDiff(proposal).removedPositions` (`who = 'Trimmed'`, `org` on `proposal.baseline`).
- `canAccept` and `acceptBlockReason` (for `proposal.status === 'draft'`):
  - Let `removedCount = removedItems.length` and `unapprovedCount = unapprovedPlacements(proposal, ward).length`.
  - If `removedCount > 0 && unapprovedCount > 0`:
    - `canAccept = false`
    - `acceptBlockReason = "Resolve ${removedCount} removed ${removedCount === 1 ? 'item' : 'items'} and ${unapprovedCount} unapproved ${unapprovedCount === 1 ? 'placement' : 'placements'} to accept"`
  - Else if `removedCount > 0`:
    - `canAccept = false`
    - `acceptBlockReason = removedCount === 1 ? 'Resolve the 1 removed item to accept' : 'Resolve the ' + String(removedCount) + ' removed items to accept'`
  - Else if `unapprovedCount > 0`:
    - `canAccept = false`
    - `acceptBlockReason = unapprovedCount === 1 ? 'Approve 1 placement to accept' : 'Approve ' + String(unapprovedCount) + ' placements to accept'`
  - Else:
    - `canAccept = true`, `acceptBlockReason = null`.
  - When `proposal.status === 'accepted'`, `canAccept = false` and `acceptBlockReason = null`.

### `<PhoneChanges>` (`apps/web/src/features/phone-changes/PhoneChanges.tsx`)

```tsx
export interface PhoneChangesProps {
  readonly model: PhoneChangesModel | null; // null when viewing Current
  readonly onAccept: () => void;
  readonly onReopen?: () => void;
}
```
- When `model === null` (viewing `Current`):
  - Renders header `h1` `Changes` and message `Current is the baseline reference board and has no proposed changes.`
- When `model !== null`:
  - **Header**: `h1` `Changes` and subtitle `{model.subtitle}`.
  - **Removed section** (rendered only when `model.removedItems.length > 0`):
    - `<section aria-labelledby={...}>` with `h2`: `Removed from Current · {model.removedItems.length}`.
    - Each item renders on the cross-hatch removed surface with `item.headline`, `item.detail`, and an `aria-hidden="true"` watermark (`REMOVED` for `member`, `POSITION REMOVED` for `position`).
  - **Three `<details>` sections**:
    1. `+` | `Suggested callings` | `{model.callings.length}` (`open` by default when `model.callings.length > 0`).
    2. `−` (U+2212) | `Suggested releases` | `{model.releases.length}` (`open` by default when `model.callings.length === 0 && model.releases.length > 0`).
    3. `±` | `Position changes` | `{model.positionChanges.length}`.
    - Each `<summary>` is at least 44px tall and shows the sign glyph (`+`, `−`, `±`), the section title, and the count.
    - Inside each `<details>`, if its rows are empty, render `None`; otherwise render each row's `who` and `what`.
  - **Footer action bar**:
    - When `model.status === 'draft'`:
      - `<button type="button" disabled={!model.canAccept} onClick={onAccept}>Accept proposal</button>` (at least 44px tall).
      - When `model.acceptBlockReason !== null`, render `<p>{model.acceptBlockReason}</p>`.
    - When `model.status === 'accepted'`:
      - Status line `Accepted · read-only` and, when `onReopen` is provided, a button `Return to Draft` (at least 44px tall) that calls `onReopen()`.

### Preview (`apps/web/src/features/phone-changes/preview.tsx`)
Default-exports `{ title: 'Phone changes', render }`.
- Builds a scenario from `data` (`{ ward, current, proposal }`) that matches artboard 24 (`PhoneChanges.dc.html`):
  - Creates a copy of `ward` where one member placed on `proposal.board` (e.g., `Flo Madeup`, Music Coordinator) has `removedDate: '2026-10-24'`, and a copy of `current` where one occupied position on `proposal.baseline` (e.g., `Livestream Coordinator` held by `Liv Example`) is removed via `removePosition` so `removedState` has 1 removed member and 1 removed position (`Removed from Current · 2`, blocking `Accept proposal` with `Resolve the 2 removed items to accept`).
  - Also includes a second proposal in the `PhoneShell` switcher (`Clean proposal`, with no removed items and no unapproved placements) so toggling or switching to it demonstrates the enabled `Accept proposal` button and accepting/reopening.
  - Starts on the `Changes` tab of the fixture proposal.

## Scope
May change:
- `apps/web/src/features/phone-changes/**` (new)
- `apps/web/e2e/phone-changes.spec.ts`, `apps/web/e2e/gui/phone-changes.capture.ts` (new)

Must not change:
- `apps/web/src/features/phone-shell/**`, `apps/web/src/features/phone-board/**`, `apps/web/src/features/phone-person/**`, `apps/web/src/features/phone-search/**`, `apps/web/src/features/phone-dugout/**`, `App.tsx`, `main.tsx`, `apps/web/src/shell/**`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, `docs/tasks/**`, anything else.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component & model tests | `pnpm --filter @wardboard/web exec vitest run src/features/phone-changes` | all tests in `model.test.ts` and `PhoneChanges.test.tsx` pass |
| 2 | Browser | `pnpm --filter @wardboard/web run build && pnpm --filter @wardboard/web exec playwright test -c e2e/playwright.config.ts e2e/phone-changes.spec.ts` | exits 0; all tests pass on desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/phone-changes/` has PNGs of the blocked changes view and expanded sections for desktop, phone-chromium, phone-webkit, and tv; inspected against `PhoneChanges.dc.html` |
| 4 | Scope | `git diff origin/main --name-only` | only paths under `apps/web/src/features/phone-changes/`, `apps/web/e2e/phone-changes.spec.ts`, and `apps/web/e2e/gui/phone-changes.capture.ts` |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

Run at most one of `verify.sh`, `test:e2e`, or `gui:capture` in this worktree at a time.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `buildPhoneChangesModel computes net callings, releases, and position changes` (`model.test.ts`) | on the preview fixture proposal, `callings` has `Ivy Notreal` (`Relief Society · Relief Society Teacher`), `releases` has `Ari Sample` (`Primary · Second Counselor`), `positionChanges` has `Added` (`Sunday School · Gospel Doctrine Teacher`), and `canAccept` is true | missing section or wrong org lookup |
| `buildPhoneChangesModel flags removed members and removed positions and blocks acceptance` | with 1 removed member and 1 removed position, `removedItems` has 2 rows (`Member removed · …` and `Position removed · held by …`), `canAccept` is false, and `acceptBlockReason` is `Resolve the 2 removed items to accept` | accept allowed with removed items; wrong count |
| `buildPhoneChangesModel blocks acceptance when a needs-approval placement is unapproved` | placing `Cy Mockup` (`needsApproval: true`) without approval sets `canAccept: false` and `acceptBlockReason: 'Approve 1 placement to accept'`; combining with 1 removed item reports both | unapproved placement ignored |
| `renders Removed from Current section, collapsible details, and disabled Accept button when blocked` (`PhoneChanges.test.tsx`) | `Removed from Current · 2` visible; `Suggested callings`, `Suggested releases`, `Position changes` summaries visible with `+`, `−`, `±`; `Accept proposal` button is `disabled` and `Resolve the 2 removed items to accept` is shown | Accept button enabled when blocked; color-only sign |
| `omits Removed section when empty and enables Accept proposal when eligible` | when `removedItems` is empty and `canAccept` is true, `Removed from Current` is absent, `Accept proposal` is enabled, and clicking it calls `onAccept` once | Removed heading rendered with 0 items |
| `accepted status shows Accepted · read-only and Return to Draft button` | when `status === 'accepted'`, `Accept proposal` is absent, `Accepted · read-only` is shown, and clicking `Return to Draft` calls `onReopen` | draft button shown on accepted proposal |
| `null model on Current shows the baseline reference message` | `model={null}` renders `Current is the baseline reference board and has no proposed changes.` | crash on Current |

`e2e/phone-changes.spec.ts` (all four projects):
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `shows removed items, net changes, and blocked Accept button on the preview` | `/__preview/phone-changes`: `Removed from Current · 2`, `Suggested callings`, `Suggested releases`, `Position changes`, and `Resolve the 2 removed items to accept` are visible; `Accept proposal` is disabled; expanding `Suggested releases` reveals `Ari Sample`; no horizontal overflow | preview not wired or horizontal overflow on phone |
| `switching to an eligible proposal enables Accept proposal` | open the board switcher, pick `Clean proposal`, `Accept proposal` is enabled, click it and see `Accepted · read-only` | switcher or accept callback not wired |

## Edge cases (each needs a test)
Covered above: zero removed items (section omitted), 1 vs multiple removed items (singular/plural reason), unapproved needs-approval placement alone and combined with removed items, removed vacant position (`Position removed · vacant here`), zero rows in a `<details>` section (`None`), `status: 'accepted'`, viewing `Current` (`model === null`).

## GUI verification
Required. Capture `/__preview/phone-changes` at desktop, phone-chromium, phone-webkit, and TV for `blocked` (the initial state with `Removed from Current · 2`, open `Suggested callings`, and disabled `Accept proposal` with reason) and `expanded` (with `Suggested releases` and `Position changes` opened). Compare with `PhoneChanges.dc.html`:
- Header shows `Changes` and `Spring adjustments vs. its Jan 4 baseline · net only`.
- `Removed from Current · 2` card shows cross-hatch background, `REMOVED` watermark, and clear text.
- `+ Suggested callings`, `− Suggested releases`, and `± Position changes` show their sign glyph, title, and count, and expand cleanly.
- `Accept proposal` button is disabled with `Resolve the 2 removed items to accept` centered below it.
- No horizontal scroll at 390×844; all interactive summaries and buttons are at least 44px tall.

## Human checks
- After the phone shell is mounted at `/`: on an iPhone, open the Changes tab on a proposal, expand and collapse the sections, and confirm the sticky/bottom Accept bar and bottom nav sit cleanly above the home indicator.

## Out of scope
- Mounting at `/` or changing `phone-shell`.
- Per-bishopric-member frozen summary blocks and clipboard copy on phone (`T-043` owns the full Accepted summary view).
