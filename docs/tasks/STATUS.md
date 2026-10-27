# Task status

Candidate and discovered work that has not yet been promoted into a task contract is tracked in [`BACKLOG.md`](./BACKLOG.md). Planned roadmap tasks and their dependencies are in [`PLAN.md`](./PLAN.md); a task appears here once the controller writes its contract.

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
| T-016 | Net diff | 2 — Board domain | todo | 0 | none |
| T-019 | Search and filters | 2 — Board domain | todo | 0 | none |
