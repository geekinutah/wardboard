# T-043: Accepted proposal view

**Milestone:** 4 — Desktop board
**Depends on:** T-018 (core accepted summary), T-017/T-015 (acceptance eligibility, unapproved placements), T-025 (server proposal lifecycle and frozen summary), T-042 (summary page), T-070 (preview harness). All `done`.
- Standalone over the T-070 preview harness, like T-042. No shell mounting and no sync wiring in this task. The web sync client has no `setProposalStatus`/`getProposal` methods yet; mounting and wiring is a later integration task (B-042).
- Shares no files with in-flight T-074, T-078, T-081, T-084 or T-085, or with T-039.

**Spec refs:**
- SPEC.md §3: status **Draft** (editable) or **Accepted** (read-only). Accepting only changes status. It is reversible by changing the status back to Draft. Past accepted proposals stay viewable in an Accepted list. Record who accepted and when.
- SPEC.md §3: a proposal cannot be accepted while it places a removed member, contains a removed position, or has an unapproved placement that requires approval.
- SPEC.md §3: accepting produces a callings-and-releases summary split by overseeing bishopric member, as plain text for copying, with a copy action per bishopric member. While Accepted, the summary is frozen.
- SPEC.md §12: acceptance scenarios (blocked by removed items or unapproved placements; accepting makes it read-only and adds it to the Accepted list; Draft makes it editable).
- Artboard 26 (`docs/design/ui-canvas/Accepted.dc.html`). Tokens in `docs/design/README.md`.

## Goal
- A standalone `<AcceptedView>` in `apps/web/src/features/accepted/`, matching artboard 26. It has:
  - a sidebar with the Accepted list;
  - a header with status, accepting user and date;
  - a Status selector that reopens to Draft or accepts. Accepting is blocked, with listed reasons, when core rules forbid it;
  - for an accepted proposal, one plain-text block per frozen summary group, each with Copy, plus Copy all.
- A preview at `/__preview/accepted`.

## Design decisions (binding)

### Pure helpers: `apps/web/src/features/accepted/acceptance.ts`
- `acceptBlockReasons(proposal: Proposal, current: Board, ward: Ward): string[]`. Uses only core `acceptanceEligibility` and `unapprovedPlacements` (plus `rootBoardGroupOf` for labels). Order: the eligibility reasons in core order, then the unapproved placements in core order.
  - `removed_member` → `{name} is no longer in the ward`.
  - `removed_position` → `{org} · {title} no longer exists in Current`. Look up the position, its assignment and its root board group on `proposal.board`.
  - Unapproved placement → `{name} needs approval as {org} · {title}`.
  - An accepted proposal returns `[]`.
- `formatAcceptedDate(iso: string): string | null`: `Intl` en-US `{ month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }` (`Oct 26, 2026`). Null when unparseable.
- `sortHistory(entries: { id; name; acceptedAt }[])`: by `acceptedAt` descending, then by name. Returns a new array.
- Copy text comes from core `summaryText(group)` and `summaryAllText(groups)` unchanged. Do not build a second text format. The artboard's per-group proposal-name prefix and "areas" line are not in the frozen core summary, so they are not shown (the frozen summary must not be recomputed from live oversight).

### `<AcceptedView history selectedId proposal blockReasons onSelect onSetStatus copy onExit />`
```ts
type AcceptedViewProps = {
  history: { id: string; name: string; acceptedAt: string }[];
  selectedId: string | null;
  proposal: {
    name: string;
    status: 'draft' | 'accepted';
    accepted: { byLogin: string; at: string; summary: SummaryGroup[] } | null;
  } | null;
  blockReasons: string[];
  onSelect: (id: string) => void;
  onSetStatus: (status: 'draft' | 'accepted') => Promise<RequestResult>; // type-only import from sync/protocol.ts
  copy: (text: string) => Promise<void>; // injected clipboard; preview uses navigator.clipboard.writeText
  onExit: () => void;
};
```
- **Sidebar** (`<nav aria-label="Accepted proposals">`):
  - a `← Back to board` button (`onExit`) and the heading `Accepted proposals`;
  - one button per `sortHistory(history)` entry, showing the name and `Accepted {date}`. The selected entry has `aria-current="page"`. Clicking calls `onSelect(id)`;
  - an empty history shows `No accepted proposals yet.`
- **No proposal** (`proposal === null`): the main area shows `Select an accepted proposal.`
- **Header:**
  - a badge `ACCEPTED` or `DRAFT` (text, not color alone), then an `h1` with the name;
  - Accepted: the subtitle `Accepted {date} by {byLogin} · read-only`. Omit `{date} ` when `formatAcceptedDate` is null;
  - Draft: the subtitle `Draft · editable`.
- **Status selector:** a native `<select>` labelled `Status` with options `Accepted (read-only)` (value `accepted`) and `Draft (editable)` (value `draft`). The value is `proposal.status`.
  - Choosing the other value calls `onSetStatus(value)`. The select is disabled while pending.
  - When `onSetStatus` resolves `{ ok: false }`, a `role="alert"` shows its `message` and the select shows `proposal.status` again.
  - When `proposal.status === 'draft'` and `blockReasons` is non-empty:
    - the `Accepted (read-only)` option is `disabled`;
    - a section with heading `Can't accept yet` lists each reason as a list item.
- **Accepted body:**
  - The heading `Callings & releases by bishopric member`, the sub-line `Grouped by who extends each calling.`, and a `Copy all` button that copies `summaryAllText(summary)`.
  - One `<section>` per group in frozen order, labelled by an `h3` of `group.heading`. It contains a `<pre>` with `summaryText(group)` and a button with accessible name `Copy {heading}` and visible text `Copy`.
  - An empty summary shows `No suggested callings or releases.` (the core text) and no group sections. `Copy all` still copies that sentence.
- **Draft body:** `Accepting freezes a callings-and-releases summary for each bishopric member.` No summary groups.
- **Copy feedback:**
  - After `copy` resolves, the clicked button's visible text is `Copied`, and a polite live region announces `Copied {heading}` (or `Copied all`). The button returns to `Copy` when another copy happens or the proposal changes. No timers are needed.
  - When `copy` rejects, show a `role="alert"`: `Couldn't copy. Select the text and copy it manually.`
- **Layout:**
  - Every button and the select are at least 44 px tall.
  - At ≤ 600 px the sidebar stacks above the main area. There is no horizontal scroll, and `<pre>` wraps (`white-space: pre-wrap`).

### Preview: `features/accepted/preview.tsx`
- Title `Accepted proposal`.
- State starts with the harness proposal accepted:
  - `accepted = { byLogin: 'mike.s', at: '2026-10-26T18:00:00Z', summary: acceptedSummary(proposal, ward) }`;
  - `history` = that proposal plus two fictional entries (`Summer youth leaders`, `2026-07-12T18:00:00Z`; `Elders Quorum reorganization`, `2026-04-03T18:00:00Z`). Selecting a fictional entry shows that name with an empty summary.
- `onSetStatus` updates local state and resolves `{ ok: true }`:
  - Draft clears `accepted` and removes the entry from the history;
  - Accepted re-freezes the summary with `acceptedSummary` and re-adds the entry.
- `blockReasons` = `acceptBlockReasons(proposal, current, ward)` while Draft.
- `copy` = `navigator.clipboard.writeText`.

## Scope
May change:
- `apps/web/src/features/accepted/**` (new)
- `apps/web/e2e/accepted.spec.ts`, `apps/web/e2e/gui/accepted.capture.ts` (new)

Must not change:
- Existing tests, `packages/**`, `apps/server/**`, `apps/web/src/sync/**` (type-only import allowed), `apps/web/src/design/**`, `apps/web/src/preview/**`, `apps/web/src/shell/**`, `App.tsx`, `main.tsx`, other `features/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Pure helpers | `pnpm --filter web exec vitest run src/features/accepted/acceptance.test.ts` | every `acceptance.test.ts` test in the table passes |
| 2 | Components | `pnpm --filter web exec vitest run src/features/accepted` | all pass |
| 3 | Existing tests untouched | `git diff origin/main --stat -- 'apps/web/src/**/*.test.ts' 'apps/web/src/**/*.test.tsx' ':!apps/web/src/features/accepted'` | empty output |
| 4 | Scope | `git diff origin/main --name-only` | only paths listed under "May change" |
| 5 | E2E | `pnpm --filter web run test:e2e` | exits 0, including `accepted.spec.ts` on desktop-chromium, phone-chromium, phone-webkit (TV is out of scope; do not add it) |
| 6 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `apps/web/gui-artifacts/accepted/` has desktop and phone (Chromium + WebKit) PNGs of the accepted state and the Draft state. Inspected against artboard 26 per `docs/gui-verification.md` |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File › test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `acceptance.test.ts` › `eligible draft → no reasons` | empty case | phantom reasons |
| `acceptance.test.ts` › `removed member placed → "{name} is no longer in the ward"` | removed member | wrong member or missing |
| `acceptance.test.ts` › `removed position → "{org} · {title} no longer exists in Current"` | removed position | org looked up on the wrong board |
| `acceptance.test.ts` › `unapproved needs-approval placement listed after removal reasons; approved one is not` | approval rule and order | listing approved placements |
| `acceptance.test.ts` › `formatAcceptedDate formats in UTC and returns null for junk` | date | local-time off-by-one |
| `acceptance.test.ts` › `sortHistory newest first, ties by name, input not mutated` | list order | in-place sort |
| `AcceptedView.test.tsx` › `accepted header: badge, name, "Accepted {date} by {login} · read-only"` | header | missing who/when |
| `AcceptedView.test.tsx` › `one section per frozen group with the core summaryText and Copy {heading}` | blocks | rebuilt text format |
| `AcceptedView.test.tsx` › `Copy and Copy all pass the core texts to copy and show Copied` | copy | Copy all copying one group |
| `AcceptedView.test.tsx` › `copy rejection shows the manual-copy alert` | error path | swallowed rejection |
| `AcceptedView.test.tsx` › `choosing Draft calls onSetStatus('draft'); refusal shows alert and select reverts` | reopen | optimistic stuck state |
| `AcceptedView.test.tsx` › `draft with reasons: Accepted option disabled and Can't accept yet lists reasons` | acceptance block | accept allowed while blocked |
| `AcceptedView.test.tsx` › `draft without reasons: choosing Accepted calls onSetStatus('accepted')` | accept | option always disabled |
| `AcceptedView.test.tsx` › `sidebar: sorted history, aria-current on selected, click calls onSelect; empty text` | Accepted list | unsorted, or no current marker |
| `AcceptedView.test.tsx` › `empty frozen summary shows the core no-changes sentence` | empty | blank page |
| `accepted.spec.ts` › `Copy all puts the summary on the clipboard (desktop-chromium, clipboard permissions granted)` | real clipboard | broken copy wiring |
| `accepted.spec.ts` › `set Status to Draft then back to Accepted with the keyboard; list updates` | real input | state not round-tripping |
| `accepted.spec.ts` › `phone: no horizontal scroll; controls at least 44px tall` | phone layout | overflow from `<pre>` |

## Edge cases (each needs a test)
- Empty history.
- `proposal` null.
- Empty frozen summary.
- Unparseable `accepted.at` (date omitted from the subtitle).
- Status refusal from the server.
- Clipboard rejection.
- Both removal and approval reasons at once (order).

## Human checks
none

## Out of scope
- Mounting in the shell (status strip or summary entry point) and sync and server wiring (a later integration task. See B-042).
- Phone changes screen with Accept (T-051).
- Changing the core summary text format or adding oversight "areas" to the frozen summary.
- Printing (SPEC §3).
