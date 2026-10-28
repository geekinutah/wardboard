# T-045: Presentation mode (TV layout)

**Milestone:** 4 — Desktop board
**Depends on:** T-032 (core `wardOverview` tiles), T-016 (diff), T-008 (vacancies), T-070 (preview harness). All `done`.
- Runs alongside T-071, T-040 and T-044, and shares no files with them.
- T-030 mounts it and feeds it the live setting.

**Spec refs:**
- SPEC.md §10, presentation mode:
  - large text, leadership photos, tags, clear organization labels and vacancy markers;
  - editing chrome hidden;
  - the only presentation setting is Show Needs approval (default off, Admin-changed);
  - notes are never shown unless opened;
  - the laptop operator navigates.
- SPEC.md §6: all tags and photos are shown in presentation mode, with no per-tag visibility. Notes are never displayed by default. `needs_approval` visibility in presentation follows the setting.
- Artboard 6 (`docs/design/ui-canvas/Presentation.dc.html`, 1920×1080, TV tokens `#10171E` / `#18222C`).

## Goal
A standalone `<Presentation>` renders a proposal (or Current) at TV scale, matching artboard 6:
- a header with the board's status badge and name, and the `+N callings −N releases N vacant` counts;
- organization tiles with leader cards (name, role, tags), vacancy markers and a proposed-change ring that also carries text;
- a footer naming the baseline date and the `Ring = proposed change` legend.

It has no editing controls. The Needs approval mark appears only when `showNeedsApproval` is true. Member notes are never rendered. The preview is at `/__preview/presentation`.

## Design decisions (binding)

### Component (`apps/web/src/features/presentation/`)
`<Presentation board ward baseline title status baselineCapturedAt showNeedsApproval onExit />`
- `status` is `'current' | 'draft' | 'accepted'`. The badge reads `CURRENT`, `PROPOSED` or `ACCEPTED` as text.
- `title` is the proposal name, or `Current`.
- `baselineCapturedAt` is an ISO string or `null`. The footer reads `Baseline {Mon D, YYYY}` when it is non-null, formatted with `Intl` in `en-US` and UTC.
- **Counts.** `+{callings} callings`, `−{releases} releases` and `{vacant} vacant` come from core: `diffBoards(baseline, board)` for callings and releases, and `vacancies(board).length` for vacant. The callings and releases counts are hidden when `baseline` is null.
- **Tiles** come from core `wardOverview(board, baseline)`. Only visible board groups are shown, in order.
  - Each leader shows initials and name, the role, and the member's tag names.
  - A vacant leader slot shows `Vacant`.
  - A proposed leader gets the ring and the visible text `Proposed`, so the change is not color-only.
  - A tile shows `{n} vacant`.
- **Needs approval.** For a leader whose member has `needsApproval`, show the text `Needs approval` **only when** `showNeedsApproval` is true. Otherwise render nothing for it at all: no hidden element and no `aria` text.
- **Notes.** The component never reads `member.note`. The rendered DOM must never contain a member's note text.
- **No editing chrome.**
  - No add controls, drag handles, inputs, or Change controls.
  - The only interactive element is an `Exit presentation` button (at least 44 px). Pressing `Escape` also calls `onExit`.
- **Layout.**
  - Designed for 1920×1080.
  - At the phone viewport, tiles stack in one column with no horizontal scroll.
  - Body text is at least 24 px at 1920 width, and tile titles are larger.
  - TV colors from the tokens.

### Preview (`features/presentation/preview.tsx`)
The fixture proposal against its baseline. It renders two instances, `showNeedsApproval={false}` and `{true}`, each labeled. The fixture member who has `needsApproval` must be a visible leader in the preview. If none is, the preview copies the ward with that flag set on one leader.

## Scope
May change:
- `apps/web/src/features/presentation/**` (new)
- `apps/web/e2e/presentation.spec.ts`, `apps/web/e2e/gui/presentation.capture.ts` (new)

Must not change:
- Existing tests, `packages/**`, `apps/server/**`, other `features/**`, `apps/web/src/design/**`, `apps/web/src/preview/**`, `App.tsx`, `main.tsx`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component | `pnpm --filter web exec vitest run src/features/presentation` | every `features/presentation` test in the table passes |
| 2 | Existing tests green | `pnpm --filter web test` | exits 0 |
| 3 | E2E | `pnpm --filter web run test:e2e` | exits 0, including `presentation.spec.ts` on all four projects |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `gui-artifacts/presentation/` has TV (1920×1080), desktop and phone PNGs, inspected against artboard 6, including TV readability per `docs/gui-verification.md` |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `Presentation.test.tsx` › `header shows PROPOSED, title and +callings/−releases/vacant from core` | counts | hand-rolled diff; wrong sign text |
| `Presentation.test.tsx` › `Current (baseline null) hides callings/releases and shows CURRENT` | Current mode | NaN counts |
| `Presentation.test.tsx` › `note text of every member never appears in the DOM` | SPEC notes rule | rendering notes |
| `Presentation.test.tsx` › `needs approval text absent (not hidden) when setting off; present when on` | SPEC setting | CSS-hiding only |
| `Presentation.test.tsx` › `proposed leader shows the Proposed text; vacant leader shows Vacant` | not color-only | ring only |
| `Presentation.test.tsx` › `tags of leaders are shown` | SPEC tags shown | dropping tags |
| `Presentation.test.tsx` › `only Exit is interactive; Exit and Escape call onExit` | no editing chrome | leftover buttons |
| `Presentation.test.tsx` › `hidden board groups are not shown` | visibility | showing hidden groups |
| `presentation.spec.ts` › `TV viewport renders without scroll at 1920×1080 for the fixture; phone has no horizontal scroll` | layout | overflow |

## Edge cases (each needs a test)
- `baseline` null.
- No vacancies (zero counts render as `0 vacant`).
- A leader who has `needsApproval` with the setting off and with it on.
- A member with a long note.

## Human checks
- On the office TV, from the meeting table: open the presentation preview and confirm the names, roles and vacancy markers are readable, and that the proposed ring and its text can be seen.

## Out of scope
- Entering and leaving presentation from the shell, live data and the setting value, and drilling into organizations. These belong to T-030 or a follow-up.
- Photos beyond the initials placeholder (real photos come with T-060).
