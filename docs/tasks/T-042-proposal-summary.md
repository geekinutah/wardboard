# T-042: Proposal summary page

**Milestone:** 4 — Desktop board
**Depends on:** T-016 (core `diffBoards`/`NetDiff`), T-030 (app shell). All `done`.
- Standalone over the T-070 preview harness, like T-044/T-045. No shell mounting in this task (the Summary link in the board header is a later shell task).
- Shares no files with in-flight T-040 (`features/removed/**`).

**Spec refs:**
- SPEC.md §3: snapshot-and-difference model — "Compare the final proposed arrangement with that saved baseline to derive suggested callings and releases… Moving someone through several experimental destinations produces only the final net difference."
- SPEC.md §3: "**PROPOSED:** Offer a CSV summary of suggested callings, releases, and remaining vacancies for reference outside the app. **CONFIRMED:** Printing is out of scope." (Initial release item 8 lists the CSV summary as optional; the roadmap and artboard 7 include it.)
- SPEC.md §8: a diff-style summary of what changed in Current against the proposal's baseline.
- Artboard 7 (`docs/design/ui-canvas/Summary.dc.html`). Tokens are in `docs/design/README.md`.

## Goal
- A standalone `<Summary>` renders a proposal's summary page matching artboard 7: net changes since the saved baseline (suggested callings, suggested releases, position changes), remaining vacancies, a divergence section for what Current changed since the baseline, the rationale, and a client-side CSV download.
- A preview at `/__preview/summary` shows the full page, including a populated divergence section.

## Design decisions (binding)

### Row helper: `apps/web/src/features/summary/rows.ts`
`summaryRows(proposal: Proposal, current: Board, ward: Ward): SummaryRows` — pure; calls core `diffBoards`, `vacancies`, `removedState`, `rootBoardGroupOf` and nothing else decides what counts as changed or removed. `board` is `proposal.board`, `baseline` is `proposal.baseline`.

```ts
type SummaryRows = {
  callings: DiffRow[];        // diffBoards(baseline, board).callings, in core order
  releases: DiffRow[];        // diffBoards(baseline, board).releases, in core order
  added: DiffRow[];           // diffBoards(baseline, board).addedPositions
  trimmed: DiffRow[];         // diffBoards(baseline, board).removedPositions
  vacancySections: { org: string; titles: string[]; count: number }[];
  divergence: {
    added: { org; title; note }[];    // diffBoards(baseline, current).addedPositions
    removed: { org; title; note }[];  // diffBoards(baseline, current).removedPositions
    members: { name; positions: { org; title }[] }[];  // removedState(proposal, current, ward).members
    total: number;  // added.length + removed.length + members.length (a member counts once, whatever they hold)
  };
};
type DiffRow = { name: string | null; org: string; title: string };
```
- `DiffRow.name` is `ward.members[memberId].name` (null for positions). `org` is the name of the root board group containing the entry's calling group, looked up on the board the entry belongs to (`to` for callings/added, `from` for releases/removed). `title` is the diff entry's `title`. The display string for a placement is `{org} · {title}`.
- `vacancySections` comes from `vacancies(proposal.board)`, grouped by board group in board-group order. Each section lists the distinct assignment titles of its vacant positions, in board order. When more than five board groups have vacancies, the first five keep explicit sections and the remainder collapses into one section `{ org: 'Other groups', titles: [], count }` (artboard 7's "7 positions across 5 groups" row).
- Divergence `note` (both position groups): if the entry's lineage exists on `proposal.board`, then `Held in this proposal by {name}` when occupied, else `Still vacant in this proposal`; if the lineage is not on `proposal.board`, `Not in this proposal`. (A position added to Current is always "Not in this proposal" since proposal lineages differ; the uniform rule covers it.)
- Divergence `members`: one entry per `removedState` member, in core order; `positions` is each of that member's held proposal-board positions (from the core entry's `positionIds`), in core order, each `{org, title}`.

### CSV: `summaryCsv(proposal, current, ward): string` (in `rows.ts` or a sibling `csv.ts`)
- Header row `Section,Who,What`, then, in this order: every suggested calling (`Suggested calling,{name},{org} · {title}`), every suggested release (`Suggested release,{name},{org} · {title}`), then one row per remaining vacancy on the proposed board (`Remaining vacancy,{org},{title}`), in core order. Divergence and position changes are not in the CSV (SPEC §3 names callings, releases, vacancies).
- Fields containing a comma, double quote, or newline are double-quoted with inner quotes doubled (RFC 4180).
- Filename: the proposal name with each character outside `[a-zA-Z0-9 . -]` replaced by `-`, runs of `-` collapsed, leading/trailing `-` trimmed, empty result → `summary`; suffix `.csv`.
- The button handler builds a `text/csv;charset=utf-8` Blob, creates an object URL, clicks a temporary `<a download>`, and revokes the URL. The CSV string itself is the pure, unit-tested seam.

### `<Summary ... />` (`features/summary/Summary.tsx`)
Props: `{ proposal: Proposal; current: Board; ward: Ward; importedAt: string | null; onExit: () => void }`.
- `importedAt` is Current's last-import date (server-side data; core `Board` has no import date). The back button (`onExit`) is at least 44 px tall.
- Header: eyebrow `PROPOSAL SUMMARY` (uppercase, letterspaced); `h1` = `proposal.name`; subtitle `Compared with baseline captured {date} · net changes only` where `{date}` is `proposal.createdAt` formatted `Intl` en-US `{month:'short', day:'numeric', year:'numeric'}` in UTC (omit the `Compared with…` clause if unparseable/absent); a `Download CSV` button (44 px tall).
- Divergence section: rendered only when `divergence.total > 0`. Amber panel, `aria-labelledby` heading `Current changed since this baseline · {total} differences`; a note `{re-import date} · this proposal is unchanged` (date = `importedAt`, same formatter; omit the date fragment when null). Collapsible `<details>` per non-empty group, in order: `+ Positions added to Current`, `− Positions removed from Current`, `− Ward member removed`; each summary shows a sign glyph, the headline, and a count label (`{n} position` / `{n} positions`, `{n} person` / `{n} people`). Lines render as sign + text (mono) + note; member lines are `− {name}` with note `Proposed here as {org} · {title}` per placement.
- Rationale section: only when `proposal.rationale` is non-null and non-blank: uppercase `Rationale` label + the text.
- Grid (auto-fit `minmax(320px, 1fr)`), four cards with counts in the headings:
  - `+ Suggested callings · {n}` (blue heading) — rows: bold name, right-aligned `{org} · {title}`;
  - `− Suggested releases · {n}` — same shape;
  - `Position changes · {n}` — `n = added + trimmed`; rows `Added` / `Trimmed` label + `{org} · {title}`;
  - `Remaining vacancies · {n}` (amber heading) — one row per `vacancySections` entry: bold org, right-aligned comma-joined titles (or `{count} positions across {k} groups` for the collapsed section).
  - A card with zero rows renders a single muted `None` line so the empty state is text, not absence.
- Footer, exact copy: `Planning reference only. Callings are extended, sustained, set apart, released and recorded in official tools. Exported files carry the same confidentiality as the app.`
- Never color alone: every section and line carries the sign glyph and/or text above.

### Preview (`features/summary/preview.tsx`)
Build the scenario from the harness data `{ ward, current, proposal }` (whose proposed board already has three net changes):
- `ward'`: structural copy with one member who is placed on the proposal board given a fixed fictional `removedDate` (e.g. `2026-10-24T12:00:00Z`).
- `current'`: apply, in order, core `removePosition` on one occupied position and `addAssignment` for one new single position, using `sequentialIds` (ids must not collide with existing fixture ids).
- Render `<Summary proposal current={current'} ward={ward'} importedAt={'2026-10-24T12:00:00Z'} onExit={() => {}} />`.

## Scope
May change:
- `apps/web/src/features/summary/**` (new)
- `apps/web/e2e/summary.spec.ts`, `apps/web/e2e/gui/summary.capture.ts` (new)

Must not change:
- Existing tests, `packages/**`, `apps/server/**`, `apps/web/src/design/**`, `apps/web/src/preview/**`, `apps/web/src/shell/**`, `App.tsx`, `main.tsx`, other `features/**`.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Row helper | `pnpm --filter web exec vitest run src/features/summary/rows.test.ts` | every `rows.test.ts` test in the table passes |
| 2 | Components | `pnpm --filter web exec vitest run src/features/summary` | all pass |
| 3 | Existing tests untouched | `git diff main --stat -- 'apps/web/src/**/*.test.ts' 'apps/web/src/**/*.test.tsx' ':!apps/web/src/features/summary'` | empty output |
| 4 | E2E on every viewport it changes | `pnpm --filter web run test:e2e` | exits 0, including `summary.spec.ts` on desktop-chromium, phone-chromium, phone-webkit (TV is out of scope for this page; it must not be added) |
| 5 | GUI capture | `pnpm --filter web run gui:capture` | exits 0. `apps/web/gui-artifacts/summary/` has desktop, phone (Chromium + WebKit) PNGs, inspected against artboard 7 per `docs/gui-verification.md` |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `rows.test.ts` › `unchanged proposal → all sections empty, divergence total 0` | empty case | always listing something |
| `rows.test.ts` › `a move produces one calling and one release with name, org and title` | diff rows | dropping the source or the org |
| `rows.test.ts` › `added and trimmed positions list org and title in core order` | position changes | reordering or omitting |
| `rows.test.ts` › `vacancies group by org in board order with distinct titles` | vacancy sections | per-position rows |
| `rows.test.ts` › `six orgs with vacancies → first five explicit, sixth collapsed into Other groups` | artboard collapse | listing every org |
| `rows.test.ts` › `divergence notes: occupied-in-proposal / vacant-in-proposal / not-in-proposal` | note rule | constant note |
| `rows.test.ts` › `removed member with two placements → two lines, total counts the member once` | overlap + count | counting placements |
| `rows.test.ts` › `current equal to baseline → divergence total 0` | no re-import | phantom differences |
| `rows.test.ts` › `proposal-added lineage never appears in divergence` | relies on lineage rule | "missing from current" reimplementation |
| CSV tests in the feature › `exact rows, order, and RFC 4180 escaping for comma/quote names` | CSV seam | unescaped field breaking the file |
| CSV tests in the feature › `filename sanitization: spaces kept, unsafe chars dashed, empty → summary` | filename | path-unsafe filename |
| `Summary.test.tsx` › `divergence hidden when total 0` | conditional panel | empty panel |
| `Summary.test.tsx` › `header: name, baseline-captured subtitle with formatted date, back button, Download CSV` | artboard header | wrong date format |
| `Summary.test.tsx` › `divergence heading count, three details groups with singular/plural counts, line notes` | artboard copy | wrong count or note |
| `Summary.test.tsx` › `rationale section only when present` | conditional | empty heading |
| `Summary.test.tsx` › `four cards with counts; zero-count card renders the None line` | empty state | blank card |
| `summary.spec.ts` › `preview shows header, all four card headings, divergence heading; no horizontal scroll` | e2e on the three viewports | layout overflow on phone |
| `summary.spec.ts` › `Download CSV click produces the expected filename (desktop)` | download mechanics | broken blob/URL flow |

## Edge cases (each needs a test)
- No changes at all (empty sections, `None` lines, CSV header-only, no divergence).
- A removed vacant position in the divergence (vacancy note, no occupant crash).
- One member removed holding two proposal placements (two lines, one difference).
- More than five orgs with vacancies (collapsed `Other groups` row).
- Member names containing commas and double quotes (CSV escaping).
- `importedAt` null (date fragment omitted, section still renders).

## Human checks
none

## Out of scope
- Shell mounting: the Summary link in the board header and back navigation (later shell task).
- Accepted proposal view with frozen summary (T-043).
- Phone changes screen (T-051).
- Printing (SPEC §3: out of scope).
- Removed markers on board cards and the board-top summary (T-040).
