# T-120: Settings collect and review

**Milestone:** 8 — Directory photos from Settings
**Depends on:** T-119 (admin photo-collection job). Done.
**Spec refs:** SPEC.md §14 (match preview before import; first photos apply immediately; an existing photo is compared one at a time), §15 (the user signs in on the computer running WardBoard; the app never asks for a password; a phone does not show the sign-in window; staging is deleted on cancel, failure, or handoff), §16 milestone 8. PLAN.md Milestone 8 row T-120. `docs/design/README.md` (44px targets, no horizontal phone scroll, real buttons).

## Goal
An Admin on Settings can collect directory photos without choosing files. The page tells them the sign-in window opens on the computer running WardBoard. Continue, progress, cancel, and a finished bundle use the T-119 routes and the existing match screen. An Editor does not see Collect. Choosing an existing bundle still works, from a disclosure that starts closed.

## Scope
May change:
- `apps/web/src/shell/PhotoBundleSection.tsx`
- `apps/web/src/shell/photo-bundle-section.css`
- `apps/web/src/shell/photo-bundle-section.test.tsx`
- `apps/web/e2e/photo-bundle.spec.ts` (open the disclosure before the existing file steps; do not start a live collection)
- `apps/web/e2e/gui/photo-bundle.capture.ts` (same, plus one screenshot of the collect control before the disclosure is opened)

Must not change:
- `apps/server/**`, `tools/collector/**`, `packages/**`, `docker/**`
- `docs/tasks/**` other than this contract (the controller owns STATUS and evidence)
- `docs/import/guide.md` (T-121)
- any other capture or e2e spec

New dependencies allowed: none

## Design decisions (binding)

### 1. Who sees Collect
Read `me` from `useSync()`. Until `me` is known, show neither Collect nor the file picker. When `me.role === 'admin'`, show Collect. When `me.role === 'editor'`, do not show Collect, the sign-in sentence, Continue, or the collection progress line. Both roles see the disclosure below.

On mount, an Admin `GET`s `/api/admin/photo-collection` once. An Editor never requests that path, or `continue`, or `cancel`.

### 2. Collect controls
Use `fetchImpl` (the prop that already exists) with `credentials: 'same-origin'`. Do not set an `Origin` header; the browser sets it.

Visible copy, exact:

- Sign-in sentence: `Sign in on the computer running WardBoard, in the window that opens there. A phone does not show that window. WardBoard never asks for your password.`
- Start button: `Collect from the directory`
- Waiting button: `Continue`
- Stop button: `Cancel`
- Disclosure button: `Import an existing bundle`

The sign-in sentence is visible whenever Collect, Continue, or Cancel is visible. Progress from `GET` is in an element with `aria-live="polite"`. A failure message is in `role="alert"`.

`POST /api/admin/photo-collection` runs when Collect is clicked. The click handler does not wait for the Church directory. It then `GET`s. While the latest status is `running` or `needs-sign-in`, schedule another `GET` through the `schedule` prop.

```ts
schedule?: (run: () => void, delayMs: number) => () => void
```

Default: `setTimeout(run, 1000)` and return a function that clears it. Pass `1000`. Tests pass their own `schedule` and invoke the stored `run`; they must not wait on real time. Stop scheduling when the status is `idle`, `review`, or `failed`, and on unmount.

`Continue` `POST`s `/api/admin/photo-collection/continue`, then `GET`s. It is enabled only while status is `needs-sign-in`.

`Cancel` `POST`s `/api/admin/photo-collection/cancel` while status is `running` or `needs-sign-in`, then shows the idle Collect controls.

A `review` body has `bundle` in the T-098 `PhotoBundleResponse` shape. Feed that bundle through the existing `matchBundlePortraits` path and open the existing **Review photo matches** screen. Do not ask for files. **Import photos** stays the current first-photo and one-at-a-time replacement behavior.

Track whether the open bundle came from collection or from files.

- Collection, and the user reaches the done pane or clicks **Start over** on the match screen: `POST` cancel once. The done pane does not show the command-line `--cleanup` command. It says `Temporary collection files on this computer were removed.`
- Files: do not call cancel. The done pane keeps today's `--cleanup` command.
- `failed`: show `message` in the alert, `POST` cancel once, and leave the alert up until the next Collect click. Do not schedule another `GET` because of that failure.
- `503`: alert `Directory collection is not available on this server.` Do not start polling.
- Any other failed `POST` or `GET`: alert `Unable to connect to server. Check your connection.`

`already_running` (`409`) is not an alert. `GET` and show whatever that returns.

### 3. Existing bundle
The file picker and **Review photo bundle** sit in a panel that starts closed. The disclosure button is `aria-expanded`. Opening it reveals the label `Photo bundle files` and the review button. Closing it hides them from the accessibility tree (`hidden` on the panel). The file review, match, comparison, and error text behave as they do today.

### 4. Layout
Collect, Continue, Cancel, and **Import an existing bundle** use `Button` from `apps/web/src/design/Button.tsx`, so the target is at least 44px. The section keeps `min-width: 0` and does not create a horizontal page scroll. Add a class for the sign-in sentence; do not change unrelated rules.

### 5. Browser checks that must not collect
`apps/web/e2e/photo-bundle.spec.ts` and `apps/web/e2e/gui/photo-bundle.capture.ts` run as the bootstrapped admin. Before `Photo bundle files`, click **Import an existing bundle**. Do not click **Collect from the directory** in those files. The e2e server has no collector injected; a click would not be a real directory run and is out of these scripts.

The capture takes a screenshot named `collect-<project>.png` after **Collect from the directory** and the closed disclosure are visible, and before the disclosure is opened. Then it continues today's preview, compare, and done shots.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Section behavior | `pnpm --filter web exec vitest run src/shell/photo-bundle-section.test.tsx` | exit 0, and the new tests below pass |
| 2 | File-import e2e | from `apps/web`, `../../scripts/e2e-slot.pl playwright test -c e2e/playwright.config.ts e2e/photo-bundle.spec.ts` | exit 0 |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exit 0. This is the only capture run. It includes e2e, so do not also run `test:e2e`. |
| 4 | Quality gate | `./scripts/verify.sh` | exit 0. Run this after capture, not at the same time. |

## Unit tests to write

Update the existing file-picker tests so they open **Import an existing bundle** before looking for `Photo bundle files`. Keep their match, import, confirmation, and error assertions.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `an editor does not see Collect and does not call the admin route` | Editor sees the disclosure and, after opening it, the file picker. Collect, Continue, and the sign-in sentence are absent. `fetchImpl` is not called with `/api/admin/photo-collection`. | showing Collect to every signed-in user |
| `an admin sees Collect and the sign-in sentence` | those strings are present, and the disclosure panel is closed (`aria-expanded` false; file label absent) | rendering the file picker open, or omitting the password sentence |
| `Collect posts and shows the progress line from GET` | click posts `POST /api/admin/photo-collection`; the following `GET` body `{status:'running', progress:'Households 1 of 2'}` is displayed; the injected `schedule` was called with `1000` | waiting for the collector, or hard-coding the line |
| `needs-sign-in shows Continue and posts continue once` | status `needs-sign-in` shows the progress text and Continue; one click posts `POST /api/admin/photo-collection/continue` and no second continue is sent before the next `GET` | enabling Continue while `running` |
| `a review payload opens the match screen without files` | `GET` `{status:'review', progress:'', bundle}` with one matched portrait shows **Review photo matches** and that name, and **Photo bundle files** is absent | still requiring a file selection |
| `importing a collected bundle cancels the job and skips the cleanup command` | **Import photos** on that match screen posts cancel once, shows the removed-files sentence, and does not show `--cleanup` | leaving the job in `review`, or showing the CLI command |
| `cancel during sign-in posts cancel and returns to Collect` | Cancel posts `POST /api/admin/photo-collection/cancel` and Collect is available again | only clearing local state |
| `a failed collection shows the message and cancels once` | `GET` `{status:'failed', progress:'', message:'Choose a staging folder outside any Git repository.'}` shows that message and posts cancel once; the injected schedule is not asked to poll again | polling forever, or hiding the server message |
| `an unavailable collector is a fixed alert` | `POST` status `503` shows `Directory collection is not available on this server.` | launching a browser from the page |
| `the file disclosure still reviews a chosen bundle` | the existing upload path still reaches **Review photo matches** after the disclosure is opened | breaking T-098 while adding Collect |

## Edge cases (each needs a test)
- Editor never calls the admin routes.
- Disclosure starts closed for an Admin.
- Continue is absent while `running`.
- A second Continue click is not sent before the next GET (disable the button as soon as it is clicked).
- `failed` does not schedule another poll.
- Collection import posts cancel; file import does not.
- `503` uses the fixed sentence.

## Human checks
On the computer whose server process can open a window, and whose data directory is outside any Git checkout: sign in to WardBoard as Admin, open Settings, choose **Collect from the directory**, and sign in yourself in the window that opens on that computer. Then press **Continue**. Do not type the Church password into WardBoard or into a phone. The Docker image still has no collector, so this check does not apply to the container.

## Out of scope
- Rewording `docs/import/guide.md` (T-121).
- Changing the server job, the collector, or `insideGitRepository`.
- Clicking Collect in Playwright against the e2e server.
- Hiding Collect from an Admin who is using a phone. The phone does not show the sign-in window; the sentence says that.
- Name matching for children under 11. They stay unmatched because they are not ward members.
