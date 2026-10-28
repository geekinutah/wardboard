# Integration plan: mounting the standalone features in the app

The desktop shell (`apps/web/src/shell/BoardShell.tsx`) currently mounts only the canvas, ward overview, organization view and group detail. These finished features exist only as previews (`/__preview/<name>`): dugout (T-036), search (T-038), removed markers (T-040), Aaronic view (T-044), presentation (T-045), person inspector and notes (T-037), Start proposal (T-041), settings (T-046), drag and drop (T-035) and the phone shell (T-047). Two more are coming: the summary page (T-042, in progress) and the Out-of-Unit card (T-074, todo). The tasks below wire them into the real app against the real server.

## Tasks

| Task | Title | Depends on | Difficulty | Size | Recommended model | Can start |
|---|---|---|---|---|---|---|
| [T-075](T-075-sync-client-methods.md) | Sync client methods: proposals, members, access, settings | done tasks only | Medium | M: sync client + react hook; ~10 methods; mocked-socket and real-server tests | Sonnet 5 | **Now** |
| [T-076](T-076-board-views-aaronic-removed.md) | Board views: Aaronic view and removed markers in the app | done tasks only | Medium | S–M: one new shell helper; Current fetch; 7 unit tests, 1 e2e | Sonnet 5 | **Now** |
| [T-077](T-077-desktop-editing-dugout-dnd-search.md) | Desktop editing: dugout panel, drag and drop, search | done tasks only (fixes B-031) | **High** | **L**: layout, sequential op sending, B-031 approval-id fix, search navigation; 8 unit tests, 3 e2e drags on a real server | **Opus** | **Now** |
| [T-078](T-078-person-inspector-notes.md) | Person inspector and notes | T-075, T-077 | Medium | M: selection → panel, notes save via server; 7 unit tests, 1 e2e | Sonnet 5 | After T-075 + T-077 |
| [T-079](T-079-current-bar-start-proposal.md) | Read-only Current bar and Start proposal | T-075 | Low–Medium | S–M: bar + dialog + switch to the new tab; 6 unit tests, 1 e2e | Sonnet 5 | After T-075 |
| [T-080](T-080-settings-page.md) | Settings page (`/settings`) | T-075 | Medium–High (admin actions, restore over HTTP, client-side routing) | M: route in `App.tsx`, fetch mapping for restore; 7 unit tests, 2 e2e | **Opus** | After T-075 |
| [T-081](T-081-presentation-mode-entry.md) | Presentation mode entry | done tasks only | Low | S: a flag, a button, prop mapping; 6 unit tests, 1 e2e | Sonnet 5 | **Now** |
| [T-082](T-082-proposal-summary-in-app.md) | Proposal summary page in the app | T-042 | Low–Medium | S: mode flag + data assembly; 5 unit tests, 1 e2e | Sonnet 5 | After T-042 |
| [T-083](T-083-out-of-unit-on-board.md) | Out-of-Unit tile, view and drags on the board | T-074, T-077 | Medium (canvas zoom to a non-board-group area) | M: level wiring + drags; 6 unit tests, 1 e2e | Sonnet 5 (Opus if it fails a round) | After T-074 + T-077 |
| — | Phone layout at `/` (switch to the phone shell at phone widths) | T-047 and the phone tab tasks T-048–T-051 | Medium–High (must update existing phone e2e tests by contract) | M | Opus | **Not written yet.** The phone tabs would be empty placeholders today; write this after T-048–T-051 |

Sizes: **S** ≈ under 300 lines including tests; **M** ≈ 300–900; **L** ≈ 900+ or several interacting parts.

## Order and parallelism

- `BoardShell.tsx` is shared by T-076 to T-083. Each contract keeps its edits there small and puts the logic in a new file under `apps/web/src/shell/`. Tasks can be implemented in parallel and are merged one at a time as they pass verification. Each one rebases onto `origin/main` before verification, and a merge conflict means a new round for the later task.
- T-075 touches only `apps/web/src/sync/` and runs fully in parallel.
- **Start now:** T-075, T-076, T-077 and T-081. T-077 is the long pole, so give it to Opus first.
- **Next wave:** T-078, T-079 and T-080 once T-075 (and, for T-078, T-077) are merged.
- **Then:** T-082 after T-042, and T-083 after T-074.

## Not covered here

- Tags and affinities editor (T-039), photo upload (T-060), accepted-proposal view (T-043), import UI (T-059): these are feature tasks, not integration. They get mounted when they're built.
- Backlog B-032 (drag-and-drop polish) stays a candidate. T-077 only enforces "never mount drag and drop on phones".
