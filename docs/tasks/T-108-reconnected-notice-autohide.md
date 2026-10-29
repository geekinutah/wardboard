# T-108: The "Reconnected" notice hides itself

**Milestone:** 3 — Server and collaboration (web sync layer)
**Depends on:** T-071 (session and baseline sync). Done.
- From Mike's feedback on 2026-10-29: "I backed out of the page and then went forward on the browser. A 'reconnected' message appeared, but then it didn't go away until I dismissed it. It should automatically disappear after a bit."
- Runs in parallel with T-105, T-106 and T-107. None of them edits `apps/web/src/sync/**`.

**Spec refs:** SPEC.md §10. Disconnected clients show their stale/offline state and resynchronize on reconnection. A client shows what happened to an operation rather than silently dropping it. AGENTS.md: inject time; no sleeps.

## Goal
After a reconnect, `Reconnected. The board has been refreshed.` disappears on its own after 5 seconds. It can still be dismissed sooner. Notices about a change that was not applied (`stale`, or a rejection) still stay until the user dismisses them, because they report a lost edit.

## Design decisions (binding)
- In `SyncBanner` (`apps/web/src/sync/react.tsx`), when the current notice has `kind === 'resynced'`, start a timer. After `RESYNCED_NOTICE_MS = 5000` (exported), call `dismissNotice()`.
- The timer is cleared when:
  - the notice changes or clears earlier,
  - the banner unmounts,
  - a different notice replaces it.
- A later `resynced` notice starts a fresh 5 seconds.
- Use `setTimeout`/`clearTimeout` inside an effect. Tests control time with Vitest fake timers, not real waits.
- `stale` and rejection notices never auto-hide.
- The offline line (`status === 'offline'`) behaves as today. It is not a notice.
- Accessibility: the banner keeps `role="alert"`. Do not move focus.
- `SyncClient` and its notice logic do not change.

## Scope
May change:
- `apps/web/src/sync/react.tsx` (`SyncBanner` and the exported constant only)
- `apps/web/src/sync/banner-autohide.test.tsx` (new)

Must not change:
- every existing test file
- `apps/web/src/sync/client.ts`, `protocol.ts`
- everything outside `apps/web/src/sync/`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/sync` | every new test passes; existing sync tests (including `banner shows stale, rejected and resynced messages and dismisses`) pass unmodified |
| 2 | Mutation | in a disposable worktree at the candidate, make the timer also run for `stale` notices, then run check 1 | `a not-applied notice stays until dismissed` fails; remove the worktree |
| 3 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 4 | Scope | `git diff --name-only origin/main...HEAD` | only paths under May change |
| 5 | GUI check | `pnpm --filter web run gui:capture` | exits 0 (existing captures unaffected); no new capture is required, because the notice's look is unchanged |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write (`banner-autohide.test.tsx`)
Use a fake `WebSocketLike` + `SyncClient` (copy the pattern from `react.test.tsx`) to drive a real disconnect and reconnect, so the client raises the `resynced` notice itself. Use Vitest fake timers.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `the reconnected notice hides after five seconds` | the notice shows after resync; at 4999ms it is still there; at 5000ms it is gone | no timer; wrong delay |
| `dismissing early still works and leaves no timer behind` | Dismiss hides it at once; advancing 5000ms later raises no error and doesn't hide a newer notice | timer firing on a later notice |
| `a not-applied notice stays until dismissed` | a `stale` notice and an op rejection are both still shown after advancing 60000ms | auto-hiding lost-edit notices |
| `a second reconnect restarts the five seconds` | reconnect at t=0, reconnect again at t=3000, still shown at t=7999, gone at t=8000 | timer not reset |
| `a rejection replacing the reconnected notice is kept` | resynced, then a rejection before 5000ms: after 10000ms the rejection is still shown | the old timer dismissing the new notice |

## Edge cases (each needs a test)
Covered above: the exact boundary, early dismiss, the lost-edit notices, a repeated reconnect, replacement by a rejection.

## Human checks
- In `pnpm dev`, go back and forward in the browser, or restart the server while the page is open. "Reconnected" appears and disappears after about five seconds.

## Out of scope
- Changing when the client raises notices or what they say.
- The offline line.
