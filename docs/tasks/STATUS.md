# Task status

Candidate and discovered work that has not yet been promoted into a task contract is tracked in [`BACKLOG.md`](./BACKLOG.md). Planned roadmap tasks and their dependencies are in [`PLAN.md`](./PLAN.md); the shell-integration wave (T-075–T-083) is in [`integration-plan.md`](./integration-plan.md); the phone, photos and import wave (T-092 onward) is in [`phone-integration-plan.md`](./phone-integration-plan.md); a task appears here once the controller writes its contract.

| Task | Title | Milestone | State | Rounds | Human checks pending |
|---|---|---|---|---|---|
| T-064 | OpenCode harness adapter and README section | — (agent infra, off-roadmap) | done | 1 | OpenCode TUI smoke: Tab to controller, `@` list shows implementer/verifier, one real delegation |
| T-001 | Monorepo bootstrap, automated environment setup, and quality gate | 1 — Foundations | done | 1 | none (optional: first GitHub Actions run green) |
| T-002 | Server skeleton | 1 — Foundations | done | 1 | none |
| T-003 | Web skeleton, e2e harness, and GUI capture pipeline | 1 — Foundations | done | 2 | iPhone shell render (after T-063) |
| T-004 | Design tokens and base components | 1 — Foundations | done | 1 | gallery look on desktop and phone |
| T-005 | SQLite schema and migrations | 1 — Foundations | done | 2 | none |
| T-006 | Docker image | 1 — Foundations | done | 1 | compose up/restart on the Mac Studio with OrbStack |
| T-007 | Domain model and fictional fixture ward | 2 — Board domain | done | 1 | none |
| T-021 | Identity provider interface and Tailscale provider | 3 — Server and collaboration | done | 1 | tailscale serve sign-in and direct-localhost refusal (after T-063) |
| T-008 | Derived views | 2 — Board domain | done | 1 | none |
| T-009 | Move and fill (and the operation conventions) | 2 — Board domain | done | 1 | none |
| T-017 | Removed state and acceptance eligibility | 2 — Board domain | done | 1 | none |
| T-020 | Tags and affinities | 2 — Board domain | done | 1 | none |
| T-010 | Swap and release occupant | 2 — Board domain | done | 1 | none |
| T-011 | Release and dugout | 2 — Board domain | done | 1 | none |
| T-012 | Groups and positions | 2 — Board domain | done | 1 | none |
| T-013 | Presidency release rule | 2 — Board domain | done | 1 | none |
| T-014 | Second-calling detection | 2 — Board domain | done | 1 | none |
| T-015 | Needs-approval placements | 2 — Board domain | done | 1 | none |
| T-065 | OpenCode always uses qwen3.8-27b-splash | — (agent infra, off-roadmap) | done | 2 | OpenCode run confirms all roles on lmstudio/qwen3.8-27b-splash |
| T-066 | Keep nested fixtures out of the Docker image | 1 — Foundations | done | 1 | none |
| T-067 | Run the Docker smoke test in the quality gate | 1 — Foundations | done | 1 | verify.sh with OrbStack stopped fails clearly (after T-066) |
| T-016 | Net diff | 2 — Board domain | done | 2 | none |
| T-019 | Search and filters | 2 — Board domain | done | 1 | none |
| T-018 | Oversight and accepted summary | 2 — Board domain | done | 1 | none |
| T-022 | Authorization: users, roles and invitations | 3 — Server and collaboration | done | 1 | tailscale serve: initial admin opens the app; a second tailnet login is forbidden (after T-063) |
| T-023 | Board persistence | 3 — Server and collaboration | done | 2 | none |
| T-024 | Operation channel | 3 — Server and collaboration | done | 1 | none |
| T-068 | Local dev run with the fictional ward | 3 — Server and collaboration | done | 1 | `pnpm dev`: open http://127.0.0.1:5180 in a desktop browser and a phone (same machine), confirm the shell loads; optional `pnpm dev -- --reset` |
| T-063 | Tailscale and Mac Studio runbook | 7 — Deployment | done | 2 | first install + serve + backup/restore drill on the Mac Studio (pending Human Backlog item) |
| T-029 | Web sync layer | 3 — Server and collaboration | done | 1 | two windows: offline on server stop, Live + Reconnected on restart |
| T-031 | Canvas and zoom levels | 4 — Desktop board | done | 1 | zoom/pan feel and thresholds in Chrome; TV readability |
| T-069 | Antigravity model guidance names Gemini 4 Argon, not "pro" | — (agent infra, off-roadmap) | done | 1 | Antigravity controller run names Gemini Flash / Gemini 4 Argon, never a Pro model |
| T-070 | Preview harness for standalone board views | 4 — Desktop board | done | 1 | none |
| T-032 | Level 1: ward overview | 4 — Desktop board | done | 1 | TV readability of tiles from the meeting table |
| T-033 | Level 2: organization | 4 — Desktop board | done | 1 | none |
| T-034 | Level 3: group detail and add position | 4 — Desktop board | done | 1 | none |
| T-025 | Proposal lifecycle | 3 — Server and collaboration | done | 1 | none |
| T-027 | Photo storage | 3 — Server and collaboration | done | 2 | none |
| T-026 | Member profile service | 3 — Server and collaboration | done | 1 | none |
| T-028 | Backup and restore | 3 — Server and collaboration | done | 1 | backup download + restore into a fresh volume on the Mac Studio (part of the T-063 drill) |
| T-071 | Session, baseline and shared-data sync for the shell | 4 — Desktop board | done | 1 | none |
| T-040 | Removed markers and divergence summary | 4 — Desktop board | done | 1 | none |
| T-044 | Aaronic Priesthood view and oversight changes | 4 — Desktop board | done | 2 | none |
| T-045 | Presentation mode (TV layout) | 4 — Desktop board | done | 2 | office TV: /__preview/presentation readable from the meeting table; proposed ring + "Proposed" on Ari Sample visible |
| T-030 | App shell | 4 — Desktop board | done | 2 | desktop: add a position from another window, confirm zoom/pan unchanged |
| T-036 | Dugout panel | 4 — Desktop board | done | 1 | none |
| T-038 | Search and filters UI | 4 — Desktop board | done | 1 | none |
| T-072 | Access management over the operation channel | 4 — Desktop board | done | 1 | after T-046 + T-063: invite a counselor, revoke, confirm their browser disconnects |
| T-042 | Proposal summary page | 4 — Desktop board | done | 1 | none |
| T-052 | PDF extraction harness | 6 — Import and photos | done | 1 | none |
| T-037 | Person inspector and notes | 4 — Desktop board | done | 1 | none |
| T-041 | Read-only Current and Start proposal | 4 — Desktop board | done | 1 | none |
| T-053 | Callings by Organization parser | 6 — Import and photos | done | 1 | none |
| T-054 | Members without Callings parser | 6 — Import and photos | done | 1 | none |
| T-055 | Out-of-Unit Callings parser | 6 — Import and photos | done | 2 | none |
| T-046 | Settings | 4 — Desktop board | done | 1 | none |
| T-047 | Phone shell and board switcher | 5 — Phone | done | 1 | iPhone: bottom tabs clear the home indicator; switcher sheet comfortable one-handed (after integration) |
| T-073 | Out-of-unit rules: dugout, second-calling, search | 2 — Board domain | done | 1 | none |
| T-074 | Out-of-Unit card and view | 4 — Desktop board | done | 1 | office TV: Out-of-Unit tile reads as separate from ward organizations (after integration) |
| T-035 | Drag and drop with dialogs | 4 — Desktop board | done | 1 | after integration: desktop Chrome drag feel and obvious drop target; iPhone long-press does not start a drag or scroll |
| T-075 | Sync client methods: proposals, members, access, settings | 4 — Desktop board | done | 1 | none |
| T-076 | Board views: Aaronic view and removed markers in the app | 4 — Desktop board | done | 2 | none |
| T-077 | Desktop editing: dugout panel, drag and drop, search | 4 — Desktop board | done | 2 | desktop Chrome: drag feel and obvious drop target; iPhone on a Draft: swipes on dugout rows scroll, no drag starts |
| T-078 | Person inspector and notes in the app | 4 — Desktop board | done | 1 | none |
| T-079 | Read-only Current bar and Start proposal in the app | 4 — Desktop board | done | 2 | none |
| T-080 | Settings page in the app | 4 — Desktop board | done | 1 | Mac Studio: download a backup from Settings and restore it (T-063 drill); phone: open Settings and confirm user-row actions are reachable |
| T-081 | Presentation mode in the app | 4 — Desktop board | done | 2 | office TV: present from the laptop; readable; Exit by keyboard |
| T-082 | Proposal summary page in the app | 4 — Desktop board | done | 1 | none |
| T-083 | Out-of-Unit tile, view and drags on the board | 4 — Desktop board | done | 2 | office TV: Out-of-Unit tile reads as separate; desktop: drag feel, hover the tile while dragging opens it |
| T-084 | e2e specs edit their own proposals, not the shared fixture | 4 — Desktop board | done | 2 | none |
| T-085 | Update OpenCode model test pin to arch-llama/qwen3.8-27b | — (agent infra, off-roadmap) | done | 1 | none |
| T-039 | Tags and affinities editor | 4 — Desktop board | done | 1 | none |
| T-043 | Accepted proposal view | 4 — Desktop board | done | 1 | none |
| T-086 | Server: deleteTag, getTagUsage, acceptedAt | 4 — Desktop board | done | 2 | none |
| T-087 | Sync client methods: tags, needs approval, proposal status | 4 — Desktop board | done | 2 | none |
| T-088 | Member and calling tags in the app | 4 — Desktop board | done | 2 | none |
| T-089 | Tag library on the Settings page | 4 — Desktop board | done | 2 | none |
| T-090 | Accepted view and Accept in the app | 4 — Desktop board | done | 1 | none |
| T-048 | Phone board and organization screens | 5 — Phone | done | 1 | iPhone, after the shell is mounted at /: tap Primary and confirm the list and back control are comfortable one-handed |
| T-049 | Phone person and move sheets | 5 — Phone | done | 1 | iPhone, after the shell is mounted at /: tap a member on the Board tab, tap Move…, filter and tap a vacant destination, and confirm both sheets feel natural one-handed |
| T-050 | Phone search and dugout | 5 — Phone | done | 1 | iPhone, after the shell is mounted at /: switch to the Search and Dugout tabs, filter by chip, and confirm scrolling and tap targets feel comfortable one-handed |
| T-051 | Phone changes screen | 5 — Phone | done | 1 | iPhone, after the shell is mounted at /: open the Changes tab on a proposal, expand and collapse the sections, and confirm the Accept bar and bottom nav sit cleanly above the home indicator |
| T-056 | Allow-list and leakage checks | 6 — Import and photos | done | 2 | none |
| T-060 | Photo upload and comparison | 6 — Import and photos | done | 1 | iPhone: open /__preview/photos and confirm the comparison can be used one-handed without sideways scrolling |
| T-091 | Machine-wide Playwright slot pool | — (test infrastructure, off-roadmap) | done | 2 | none |
| T-057 | Identity reconciliation | 6 — Import and photos | done | 1 | none |
| T-058 | Import replace on the server | 6 — Import and photos | done | 2 | none |
| T-059 | Import preview UI | 6 — Import and photos | done | 1 | iPhone: open /__preview/import, match one name and treat the other as new, and confirm one-handed use without sideways scrolling |
| T-062 | Import guide and AI-operator prompt | 6 — Import and photos | done | 1 | none |
| T-061 | Directory photo collector | 6 — Import and photos | in progress | 0 | first real run against the directory (after done) |
| T-092 | Phone layout at the app root, with the Board tab | 5 — Phone | done | 2 | iPhone Safari: open `/`, confirm the phone layout, tabs clear the home indicator, one-thumb switcher sheet, rotate and back; open `/?layout=desktop` (address shows `/`), then `/?layout=auto` returns the phone layout. The earlier T-047–T-051 iPhone checks can now be done at `/` for the Board tab |
| T-093 | Portrait and photo upload in the desktop person inspector | 6 — Import and photos | done | 1 | desktop Chrome: upload a few-MB fictional image and confirm the inspector portrait is crisp and cropped; two windows: portrait appears in the second without reload |
