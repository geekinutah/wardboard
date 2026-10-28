# T-036: Dugout panel

**Milestone:** 4 — Desktop board
**Depends on:** T-008 and T-011 (done). T-004 components and T-070 previews are done.
- PLAN lists T-030 as a dependency. This task drops it on purpose. The panel is a standalone preview, the same way T-032 through T-034 were. T-030 is in progress and its scope is the shell, which does not mount this panel. Mounting it is a later task.
- No shared files with T-030, T-038, or T-040.

**Spec refs:**
- SPEC.md §5 Dugout: people with no remaining callings appear automatically. Explicit inclusion keeps remaining callings visible. The dugout is not a measure of availability.
- SPEC.md §6: Needs approval is shown as text.
- Artboard 1 (`docs/design/ui-canvas/Main.dc.html`), the dugout aside only.

## Goal
`<DugoutPanel>` lists the derived dugout for one board, with the artboard filters, and shows remaining callings on an explicit inclusion. A preview at `/__preview/dugout` renders it. Nothing is sent to the server.

## Design decisions (binding)

`apps/web/src/features/dugout/DugoutPanel.tsx` exports `<DugoutPanel board ward />`.

It calls `dugout(board, ward)` from `@wardboard/core`. It does not copy that function and it does not mutate `board` or `ward`.

**Chrome**
- `<aside aria-label="Dugout">` with `data-drop-target="dugout"`. Drag-and-drop behavior is T-035. This task only marks the region.
- Heading text `Dugout · {n}`, where `n` is the number of rows after the current filter.
- The sentence `People with no calling in this proposal, plus anyone placed here on purpose. Not a measure of availability.`

**Filters** (local state, default All, Weekday off)
- `All`, `Adults`, and `Youth` are one group. Exactly one is pressed. The pressed button has `aria-pressed="true"` and a non-color indicator (filled background plus bold weight).
- `Weekday` toggles independently. Pressed means the same non-color treatment.
- All keeps every row. Adults keeps `category === 'adult'`. Youth keeps `category === 'youth'`.
- Weekday keeps members who have a ward tag named exactly `Weekday availability`. Combined with the category choice, both must match.
- A filter never changes the board. Re-rendering with the same board returns the same rows.

**Rows**, in `dugout()` order
- One `<article data-member-id={id}>` per row, using `PersonCard`.
- The name line includes `Adult` or `Youth`.
- Tag names are visible text. `needsApproval` shows the text `Needs approval`.
- Explicit inclusion with one or more callings: `Placed here · still serves as {titles}` with titles joined by `, ` in `callings` order.
- Explicit inclusion with no callings: `Placed here`.
- An automatic row (not explicit) shows neither phrase.
- The first 6 filtered rows are shown. When more remain, a button reads `Show {remaining} more`. Activating it shows every filtered row and removes the button. Changing a filter collapses back to 6.

**Empty**
- No rows before filtering: `No one is in the dugout.`
- Rows exist but the filter matches none: `No one matches this filter.`

**Controls** are at least 44px tall. The artboard draws shorter chips; this task does not.

**Preview** `preview.tsx` default-exports `{ title: 'Dugout', render }`. It renders the panel for `data.proposal.board` after a successful `addToDugout` of one member who already holds a calling and is not already in `dugoutInclusions`. The operation uses `sequentialIds`. A failed operation throws. The comment names the member.

## Scope
May change:
- `apps/web/src/features/dugout/**` (new)
- `apps/web/e2e/dugout.spec.ts`, `apps/web/e2e/gui/dugout.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, other `features/**`, `packages/**`, `apps/server/**`, and anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component | `pnpm --filter @wardboard/web exec vitest run src/features/dugout` | all pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `dugout.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/dugout/` has desktop, phone, and TV PNGs, inspected against the dugout aside on artboard 1 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`DugoutPanel.test.tsx`. Use `buildFixtureWard()` and real core operations, plus the empty board described below.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `lists automatic members with Adult or Youth and no Placed here line` | fixture current dugout | invented membership |
| `explicit inclusion with a calling shows Placed here and the calling title` | `addToDugout` on an occupant | title dropped |
| `explicit inclusion with no callings says Placed here only` | include a member who holds nothing | "still serves" with no title |
| `All, Adults, Youth, and Weekday filter without changing the board` | Youth leaves Tai Demo and hides an adult; Weekday leaves Jay Storybook; board JSON is unchanged | filter mutates placements |
| `Youth and Weekday together show the empty-filter message` | fixture current | OR semantics |
| `Show more reveals rows after the sixth and a filter collapses them` | release non-presidency occupants on a copy until `dugout` returns at least 7 | always showing everyone, or a stale expansion |
| `removed-only ward shows No one is in the dugout` | `createWard` of one member with `removedDate: '2026-01-02'` and `createBoard` with empty collections | treats removed members as automatic |
| `aside is labelled Dugout and marked data-drop-target` | the attribute equals `dugout` | region missing for T-035 |
| `Needs approval is text` | `addToDugout` for Cy Mockup, who has `needsApproval` | icon only |

`e2e/dugout.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `preview shows an explicit inclusion, and Youth hides the adults` | `/__preview/dugout` shows `Placed here · still serves as`; after Youth, Tai Demo remains and an adult name that was visible is gone | preview not wired, filter local-only |

## Edge cases (each needs a test)
Covered above: empty dugout, filter that matches nothing, explicit with and without callings, more than six rows.

## GUI verification
Required. Capture `/__preview/dugout` at desktop, phone (Chromium and WebKit), and TV. Compare the panel with artboard 1's dugout aside:
- The count, the availability sentence, and the four filter chips are visible.
- An explicit row shows the remaining calling as text.
- No horizontal page scroll. Buttons are at least 44px. Needs approval, when present, is not color alone.
- The ward canvas, header, and status strip are outside this preview. Do not treat their absence as a defect.

## Human checks
none

## Out of scope
- Mounting the panel in `BoardShell`.
- Dragging a card into the panel (T-035). That task owns the drop behavior; this task only marks `data-drop-target`.
- Add to dugout from search (T-038).
- Releasing, moving, or any server operation.
