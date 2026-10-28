# Task plan

The roadmap from `SPEC.md` §16, broken into small, independently verifiable tasks. The controller turns each row into a full contract at `docs/tasks/T-###-short-name.md` (using `_TEMPLATE.md`) when it claims the task, and tracks execution in `STATUS.md`. The scopes and "done when" lines here are the starting point for those contracts, not the contracts themselves.

**Parallelism.** A task may start once every task in its **Depends on** column is `done`. Tasks with no dependency between them and non-overlapping scopes run at the same time, each in its own worktree. Most milestone 2 tasks own a single file pair in `packages/core/src/ops/` so they can run side by side; most milestone 4 and 5 tasks own a single feature folder in `apps/web/src/features/`.

**Shared files.** Barrel exports (`packages/core/src/index.ts`, `apps/web/src/features/index.ts`) and the migration list are shared. Each task adds only its own export/migration line; the controller resolves those one-line conflicts at merge.

**Report fixtures.** `fixtures/lcr-reports/` holds anonymized copies of the three real LCR reports with their exact layout; T-052–T-058 test against them. See its README.

**Needs a decision.** Rows marked ⚑ depend on an open question in `SPEC.md` and stay blocked until Mike answers it (also listed in `HUMAN_BACKLOG.md`).

## Planned layout

```
packages/core/       Pure TypeScript domain: board model, operations, diff, rules, search, summary
packages/importer/   Deterministic PDF parsing, normalization, allow-list, reconciliation
apps/server/         Node server: HTTP + WebSocket, SQLite, auth, photos, backup/restore
apps/web/            React web client: desktop canvas, phone UI, presentation mode
tools/collector/     Local collection tool run in the user's signed-in browser session
docker/              Container build and compose files
scripts/verify.sh    The single quality gate
```

## Milestone 1 — Foundations

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-001 | Monorepo bootstrap and quality gate | — | root config files, `scripts/`, `.github/`, `packages/core/` skeleton | pnpm workspace, strict TS base config, ESLint, Vitest in `packages/core` with one real test; `scripts/verify.sh` (install check, typecheck, lint, tests) and `scripts/verify-hook.sh` exist; CI runs the gate on push |
| T-002 | Server skeleton | T-001 | `apps/server/` | Node server answers `GET /api/health`; config from env (data dir, base URL, port) with no machine-specific paths; Vitest tests for config parsing and health |
| T-003 | Web skeleton, e2e harness and GUI capture | T-001, T-002 | `apps/web/`, `scripts/verify.sh` (e2e step only), `.gitignore` (gui-artifacts line) | Vite + React app renders a shell; Vitest + Testing Library unit test; headless Playwright smoke test run by the gate; `pnpm --filter web run gui:capture` produces desktop, phone (Chromium and WebKit) and TV screenshots from a checkout-scoped server with fictional data, per `docs/gui-verification.md` |
| T-004 | Design tokens and base components | T-003 | `apps/web/src/design/` | Tokens from `docs/design/README.md`; PersonCard, VacancySlot, RemovedCard, Chip, Button components with tests for their text labels (never color-only) |
| T-005 | SQLite schema and migrations | T-002 | `apps/server/src/db/` | Migration runner and tables for the SPEC §7 model; tests prove migrations apply to an empty DB and are idempotent |
| T-006 | Docker image | T-002, T-003 | `docker/`, root `.dockerignore` | Image builds server + web; data and photos on a mounted volume; container health check passes in a scripted smoke test |

## Milestone 2 — Board domain (`packages/core`)

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-007 | Domain model and fixtures | T-001 | `packages/core/src/model/`, `packages/core/test/fixtures/` | Types and validated constructors for Member, BoardGroup, CallingGroup, Assignment (single/list), Position, Placement, Board, Proposal (Draft/Accepted), Oversight, DugoutInclusion; a fictional-ward fixture builder |
| T-008 | Derived views | T-007 | `packages/core/src/derive/` | Vacancies, each member's callings, and dugout membership (no callings ∪ explicit inclusion) computed from a board |
| T-009 | Move and fill | T-007 | `packages/core/src/ops/move.*` | Moving from a calling releases only that calling and leaves a visible vacancy; list drops add without displacing; duplicate list placement rejected |
| T-010 | Swap and release occupant | T-009 | `packages/core/src/ops/occupied.*` | Drop on an occupied single calling supports swap / release occupant / cancel, including dugout and list sources; each is one operation |
| T-011 | Release and dugout | T-009 | `packages/core/src/ops/dugout.*` | Release a specific calling; drag-to-dugout records explicit inclusion; Add to dugout keeps all callings; assigning a calling clears explicit inclusion |
| T-012 | Groups and positions | T-009 | `packages/core/src/ops/positions.*` | Add group; rename, reorder and hide groups; add position (any title, single/list, count); extra list position; reduce staffing need; trimming an occupied position releases it and adds the member to the dugout |
| T-013 | Presidency release rule | T-010, T-011, T-012 | `packages/core/src/ops/presidency.*` | Any operation that releases a president (or bishop) — release, move, swap, release occupant, removal — releases that presidency's counselors and secretary in the same operation; they keep other callings. Clerks and the executive secretary are not released |
| T-014 | Second-calling detection | T-009 | `packages/core/src/rules/second-calling.*` | Preflight reports when a placement would leave a member with more than one calling; moves and swaps that don't increase the count don't report |
| T-015 | Needs-approval placements | T-009 | `packages/core/src/rules/approval.*` | A placement for a `needs_approval` member requires an approval tied to member, position and proposal, recording approver and time; changes require fresh approval |
| T-016 | Net diff | T-008 | `packages/core/src/diff/` | Suggested callings/releases and added/removed positions versus the baseline; repeated experimental moves reduce to the net change; moving back cancels it |
| T-017 | Removed state and acceptance eligibility | T-007 | `packages/core/src/rules/removed.*` | Placements of members with `removed_date` and positions whose lineage is gone from Current are flagged; a proposal with any flag is ineligible for acceptance |
| T-018 | Oversight and accepted summary | T-016 | `packages/core/src/summary/` | Fixed bishop → priests quorum; editable counselor oversight; summary text grouped by overseeing bishopric member, with Elders Quorum presidency (stake presidency) and other Elders Quorum callings separated, per SPEC §3 |
| T-019 | Search and filters | T-008 | `packages/core/src/search/` | Partial, case-insensitive search over people, callings, tags and groups, scoped to a board or all; filters for vacant, no calling, youth/adult, tag; note bodies never searched; removed members never returned |
| T-020 | Tags and affinities | T-007 | `packages/core/src/tags/` | Ward-wide member tags; deleting a tag removes it from members and calling preferences everywhere; per-board calling tags and preferences; preference match computation |

## Milestone 3 — Server and collaboration

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-021 | Identity provider interface and Tailscale provider | T-005 | `apps/server/src/identity/` | One `IdentityProvider` interface; a Tailscale-header provider and a test fixture provider; server binds to localhost only; middleware rejects any HTTP route or WebSocket upgrade (except health) without a verified identity; tests prove missing, malformed and spoofed-path requests are refused and that nothing outside this module reads identity headers |
| T-022 | Authorization: users, roles and invitations | T-021 | `apps/server/src/access/` | User list maps a verified login to Editor, Admin or no access; invite by login, revoke, make admin, transfer admin, last-admin removal refused; depends only on the `IdentityProvider` interface, with tests run against the fixture provider |
| T-023 | Board persistence | T-005, T-007 | `apps/server/src/store/` | Load/save Current, proposals and members; creating or duplicating a proposal snapshots its baseline; Current is read-only to ordinary edits |
| T-024 | Operation channel | T-023, T-009 | `apps/server/src/ws/` | WebSocket per client; each operation validated by core and committed in one SQLite transaction; versioned; stale operations rejected visibly; committed result broadcast to clients on the same board only |
| T-025 | Proposal lifecycle | T-023, T-015, T-017, T-018 | `apps/server/src/proposals/` | Create from Current or duplicate; rename and rationale; Draft ↔ Accepted (refused while removed items or unapproved needs-approval placements remain; T-015 `unapprovedPlacements`); Accepted is read-only; summary frozen while Accepted and regenerated on re-accept; accepted list |
| T-026 | Member profile service | T-023, T-020 | `apps/server/src/members/` | Shared edits to name, note, tags and `needs_approval` broadcast to every board; `needs_approval` and the Show Needs approval setting changeable by Admins only (Editors refused) |
| T-027 | Photo storage | T-002 | `apps/server/src/photos/` | Validate type/size, process and store locally, serve only to signed-in users |
| T-028 | Backup and restore | T-005, T-027 | `apps/server/src/backup/` | Consistent SQLite snapshot plus photos and settings in one archive; restore validates first and is atomic (a failed restore leaves data unchanged) |
| T-029 | Web sync layer | T-024, T-003 | `apps/web/src/sync/` | Client sends operations and applies only committed results; offline/stale banner; resync on reconnect; camera, tab and selection state stay local |
| T-068 | Local dev run with the fictional ward | T-022, T-023 | `apps/server/dev/`, `apps/web/e2e/checkout-server.ts` (seed seam), root `package.json` (`dev` script) | `pnpm dev` serves the app on 127.0.0.1 with a persistent data dir seeded once from the fictional fixture ward and a fictional signed-in admin; the e2e/GUI checkout server seeds the same data |

## Milestone 4 — Desktop board (`apps/web`)

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-030 | App shell | T-004, T-029, T-071 | `apps/web/src/shell/` | Header (brand, board tabs, search slot, presence, account) and status strip per artboard 1; search bar present on every desktop screen |
| T-031 | Canvas and zoom levels | T-004 (standalone; mounted by T-030/T-032+) | `apps/web/src/features/canvas/` | Pan, wheel/pinch zoom with level thresholds, double-click into an area, zoom-out/Esc up one level, Fit ward, keyboard zoom buttons, single click selects (artboard 17) |
| T-032 | Level 1: ward overview | T-070 (standalone; mounted by T-030) | `apps/web/src/features/ward-overview/` | Organization tiles with leaders, vacancy and change counts (artboard 1) |
| T-033 | Level 2: organization | T-070 (standalone; mounted by T-030) | `apps/web/src/features/org-view/` | Leadership cards, group summary rows with counts, "Overseen by" label |
| T-034 | Level 3: group detail and add position | T-070, T-012 (standalone; mounted by T-030) | `apps/web/src/features/group-view/` | Every position, list vs single, vacancy placeholders, + add position and + Add group (artboards 2, 13) |
| T-070 | Preview harness | T-003, T-004, T-007 | `apps/web/src/main.tsx` (routing branch), `apps/web/src/preview/` | `/__preview/<feature>` renders any `features/*/preview.tsx` with the fictional fixture ward and a proposal with changes, lazily loaded |
| T-071 | Session, baseline and shared-data sync | T-024, T-025, T-026, T-029 | `apps/server/src/ws/channel.ts`, `apps/web/src/sync/` | `whoami` and `getBoard` messages; client `me`, baseline fetch, and `ward`/`proposalChanged`/`settings` pushes; prerequisite for T-030 |
| T-072 | Access management over the operation channel | T-022, T-024, T-026 | `apps/server/src/ws/channel.ts` | Admin-only list/invite/revoke/role/transfer messages; revoked users disconnected immediately; prerequisite for T-046 |
| T-035 | Drag and drop with dialogs | T-034, T-010, T-014, T-015 | `apps/web/src/features/dnd/` | Drag between positions and onto tiles/groups (hover opens); drop dialog; second-calling confirmation; needs-approval dialog (artboards 2–4, 12) |
| T-036 | Dugout panel | T-030, T-011 | `apps/web/src/features/dugout/` | Dugout list with filters; drop target; explicit inclusions show remaining callings |
| T-037 | Person inspector and notes | T-030, T-026 | `apps/web/src/features/person/` | Inspector with callings in this proposal, tags, note; double-click a member card opens notes; notes never shown otherwise |
| T-038 | Search and filters UI | T-030, T-019 | `apps/web/src/features/search/` | Grouped results dropdown, scope switch, filter chips, Add to dugout per person, navigate/zoom to a result (artboard 11) |
| T-039 | Tags and affinities editor | T-037, T-020 | `apps/web/src/features/tags/` | Member tags, Needs approval setting (control shown to Admins only), calling tags and preferences, tag library with delete confirmation (artboard 10) |
| T-040 | Removed markers and divergence summary | T-034, T-017 | `apps/web/src/features/removed/` | Hatch + watermark + text on affected cards; diff summary at the top of the proposal (artboard 9) |
| T-041 | Read-only Current and Start proposal | T-030, T-025 | `apps/web/src/features/proposals/` | No drag on Current; Start proposal dialog (from Current or duplicate, name, rationale) (artboard 15) |
| T-042 | Proposal summary page | T-030, T-016 | `apps/web/src/features/summary/` | Net changes, remaining vacancies, divergence section, CSV download (artboard 7) |
| T-043 | Accepted proposal view | T-042, T-025 | `apps/web/src/features/accepted/` | Status selector, accepted list, per-group plain-text blocks with Copy and Copy all (artboard 26) |
| T-044 | Aaronic Priesthood view | T-033, T-018 | `apps/web/src/features/aaronic/` | Bishop as fixed linked card in the priests quorum; editable "Overseen by" for counselors (artboard 16) |
| T-045 | Presentation mode | T-032 | `apps/web/src/features/presentation/` | TV layout (artboard 6); Needs approval shown only when the Admin setting is on; notes never shown |
| T-046 | Settings | T-030, T-022, T-028, T-072 | `apps/web/src/features/settings/` | People & access, the single presentation setting, backup and restore with validation summary (artboard 18) |

## Milestone 5 — Phone (`apps/web`)

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-047 | Phone shell and board switcher | T-030 | `apps/web/src/phone/shell/` | Bottom tabs (Board, Search, Dugout, Changes) at phone widths; board switcher sheet with Start proposal (artboard 25) |
| T-048 | Phone board and organization screens | T-047 | `apps/web/src/phone/board/` | Organization list and tap-through organization/group screens with + add position (artboards 19–20) |
| T-049 | Phone person and move sheets | T-048, T-009 | `apps/web/src/phone/person/` | Person sheet with Move / Release per calling and Add to dugout; tap-to-move destination sheet (artboards 5, 22) |
| T-050 | Phone search and dugout | T-047, T-019 | `apps/web/src/phone/search/`, `apps/web/src/phone/dugout/` | Search with scope and filters, Add to dugout; dugout list with filters (artboards 21, 23) |
| T-051 | Phone changes screen | T-047, T-016 | `apps/web/src/phone/changes/` | Removed items, collapsible callings/releases/position changes, Accept blocked with reason (artboard 24) |

## Milestone 6 — Import and photos

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-052 | PDF extraction harness | T-001 | `packages/importer/` (harness) | Deterministic text/position extraction proven against the real-layout anonymized reports in `fixtures/lcr-reports/` (page breaks, wrapped names, mixed calling and roster tables); small synthetic PDFs only for edge cases those reports lack |
| T-053 | Callings by Organization parser | T-052 | `packages/importer/src/reports/organizations.*` | Organizations, groups, occupied and vacant positions across page breaks; member-roster sections ignored; row counts reconciled |
| T-054 | Members without Callings parser | T-052 | `packages/importer/src/reports/without-callings.*` | Candidate members extracted; disallowed columns dropped at parse time |
| T-055 | Out-of-Unit Callings parser | T-052 | `packages/importer/src/reports/out-of-unit.*` | Three sections recognized by header; serving unit and calling captured; external service never becomes a ward placement |
| T-056 | Allow-list and leakage checks | T-053, T-054, T-055 | `packages/importer/src/allowlist/` | Only allow-listed fields leave the importer; canary contact details, birth dates and record numbers in fixtures never appear in output or logs |
| T-057 | Identity reconciliation | T-056 | `packages/importer/src/reconcile/` | Cross-report matching and duplicate-report detection; ambiguous names surfaced, never merged; youth/adult mapping per SPEC §15 (adult 18+, youth 11–17, under 11 excluded); name comparison only, no Church identifiers (SPEC §8, §15) |
| T-058 | Import replace on the server | T-057, T-023 | `apps/server/src/import/` | Preview, then atomic replacement of Current; catalog (vacant and custom positions) preserved; notes/tags kept for confirmed matches; removed members get `removed_date`; proposals untouched |
| T-059 | Import preview UI | T-058, T-030 | `apps/web/src/features/import/` | Sources, counts, identity decisions, discarded fields, gated replace (artboard 8) |
| T-060 | Photo upload and comparison | T-027, T-037 | `apps/web/src/features/photos/`, `apps/server/src/photos/` (routes) | Direct upload; side-by-side Keep Current / Use New Photo for any replacement, one at a time in batches (artboard 14) |
| T-061 | Directory photo collector | T-060 | `tools/collector/` | Runs in the user's signed-in browser; individual portraits only; match preview; no credentials, session state or extra fields retained; resumable and cleans up (SPEC §15) |
| T-062 | Import guide and AI-operator prompt | T-058 | `docs/import/` | Versioned human guide with real commands and the copyable operator prompt from SPEC §15 |

## Milestone 7 — Deployment

| ID | Title | Depends on | Scope | Done when |
|---|---|---|---|---|
| T-063 | Tailscale and Mac Studio runbook | T-006 | `docker/`, `docs/deploy.md` | Compose setup reachable only over Tailscale; install, upgrade, backup and restore steps for the Mac Studio |
