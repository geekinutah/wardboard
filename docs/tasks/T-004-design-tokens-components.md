# T-004: Design tokens and base components

**Milestone:** 1 — Foundations
**Depends on:** T-003
**Spec refs:** SPEC.md §4–§6 (vacancies visible, needs approval, removed state), §10; `docs/design/README.md` (visual language, color tokens, rules that matter); artboards 1 (`Main.dc.html`), 2 (`OrgDetail.dc.html`), 9 (`Removed.dc.html`) in `docs/design/ui-canvas/`

## Goal
`apps/web/src/design/` provides the design tokens from `docs/design/README.md` (as CSS custom properties and a typed TS export), self-hosted IBM Plex Sans/Mono, and five presentational components — `PersonCard`, `VacancySlot`, `RemovedCard`, `Chip`, `Button` — that never rely on color alone. A component gallery page renders every variant so the GUI pipeline can capture it.

## Design decisions (binding for this task)
- **Tokens**: `src/design/tokens.css` defines `--wb-*` custom properties for every row of the README color table (ground, surface, ink, ink-2, muted, line + inner dividers, accent + soft/dark, vacancy text/border/fills, proposed text/fills, release text/fill, needs-approval text/fill, removed hatch/border, accepted, TV ground/cards), the canvas dot grid, font stacks, and the section-label style (11–12px, 600, uppercase, 0.06em). `src/design/tokens.ts` exports the same values as a typed `as const` object; a unit test asserts the CSS and TS values agree.
- **Fonts**: IBM Plex Sans 400/500/600/700 and IBM Plex Mono 500 via `@fontsource/*` packages, bundled by Vite. No CDN or external font request (the app is private, Tailscale-only).
- **Components** (all accept `className`; no business logic; props are plain data):
  - `PersonCard`: name, photo placeholder (initials on a colored circle; initials from first letters of the first and last name parts), optional calling title, optional tags (rendered as `Chip`s), optional `needsApproval` (lock icon **and** visible text `Needs approval`), optional `proposed` (visible `+ Proposed`), optional `release` (visible `−` and strikethrough of the calling title), optional `removed` (renders as `RemovedCard`). Root is an `<article>` with an accessible name equal to the member's name.
  - `VacancySlot`: dashed border, dashed empty circle, visible text `Vacant`, optional position title. Accessible name includes `Vacant` and the title.
  - `RemovedCard`: cross-hatch background, dashed `#8A929A` border, rotated faint watermark `REMOVED` (member) or `POSITION REMOVED` (position), **plus** a visible, non-watermark text label (`Removed from Current` / `Position removed from Current`) so the state is readable without the watermark.
  - `Chip`: label text; variants `tag`, `proposed`, `release`, `needs-approval`, `vacancy`; each variant's meaning is carried by its text, not only its color.
  - `Button`: a real `<button>`, variants `primary` (accent), `secondary`, `ghost`; `type="button"` by default; min-height and min-width 44px; visible focus ring.
- **Gallery**: `src/design/Gallery.tsx` rendered when the URL path is `/__gallery` (simple path check in `App.tsx`; no router dependency). Shows every component and variant with fictional names (e.g. "Ada Fictional", "Ben Example").
- **GUI scenario** `design-gallery` in `apps/web/e2e/gui/` capturing `/__gallery` at all four viewports.

## Scope
May change:
- `apps/web/src/design/` (new)
- `apps/web/src/App.tsx` (gallery path switch and token/font imports only)
- `apps/web/src/main.tsx` (token/font CSS import only, if that is where global CSS lives)
- `apps/web/e2e/gui/` (new `design-gallery` scenario only)
- `apps/web/package.json`, `pnpm-lock.yaml` (font dependencies only)

Must not change:
- `apps/web/e2e/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/server/**`, `packages/**`, `scripts/**`, `docs/**`, anything else

New dependencies allowed: `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component and token tests | `pnpm --filter web test -- design` | all tests under `src/design/` pass |
| 2 | Gallery captured | `pnpm --filter web run gui:capture && ls apps/web/gui-artifacts/design-gallery/` | four PNGs: `desktop-chromium`, `phone-chromium`, `phone-webkit`, `tv-chromium` |
| 3 | Visual inspection | open each gallery PNG and compare with artboards 1, 2, 9 | vacancy dashed + "Vacant", removed hatch + watermark + text label, needs-approval lock + text, proposed "+ Proposed", release "−" + strikethrough; no clipping/overlap; no horizontal scroll at phone |
| 4 | No external font requests | e2e or capture run with request logging: no request to any host other than the test server | zero external requests |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tokens css and ts agree` | every TS token value appears as the matching `--wb-*` value in `tokens.css` | values drift |
| `tokens match the design README` | ground `#F3F4F1`, ink `#18212B`, accent `#1D5C68`, vacancy text `#8A4209`, needs approval `#5B2B6E`, accepted `#2E5B3A` | typo in a hex |
| `PersonCard has the member name as its accessible name` | `getByRole('article', { name: 'Ada Fictional' })` | unnamed div |
| `PersonCard shows initials placeholder` | "Ada Fictional" → `AF`; single name "Cleo" → `C`; extra spaces trimmed | crash on single name |
| `PersonCard needs approval is text, not only color` | `needsApproval` → text `Needs approval` present | icon only |
| `PersonCard proposed and release are labeled` | `proposed` → `+ Proposed`; `release` → `−` present and calling title in a `<s>`/`<del>` or `line-through` element | color only |
| `PersonCard removed renders RemovedCard` | `removed` → `Removed from Current` text | flag ignored |
| `VacancySlot says Vacant` | text `Vacant` and position title; accessible name includes both | empty placeholder |
| `RemovedCard member vs position labels` | `kind="position"` → `POSITION REMOVED` watermark and `Position removed from Current` text | one label for both |
| `Chip variant text carries meaning` | each variant renders its label text | empty chip |
| `Button is a real button with type=button` | `getByRole('button')`, `type` attribute `button`, `onClick` fires on user click | div with onClick; submits forms |
| `Button disabled does not fire` | disabled → click does not call handler | disabled styling only |

## Edge cases (each needs a test)
- Single-word name and names with extra whitespace (initials).
- `removed` combined with `proposed` (removed wins and both are textual).
- Empty tags list renders no chip container noise (no empty list element).

## Human checks
- Look at `/__gallery` in a desktop browser and on a phone and confirm the cards read calmly and match the artboards' feel (subjective; tokens and labels are already covered by tests).

## Out of scope
- Board layout, canvas, header/status strip (T-030+).
- Real photos (T-027/T-060).
- Any routing library.
