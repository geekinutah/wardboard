# T-046: Settings

**Milestone:** 4 — Desktop board
**Depends on:** T-022 (access rules), T-028 (backup/restore HTTP), T-072 (access messages on the operation channel), T-030 (app shell), T-004 (design components), T-070 (preview harness). All `done`.
- Standalone preview, like T-032 to T-038. It does not mount anything in the shell. Opening Settings from the account menu, adding sync-client methods for `listAccess`/`invite`/`revokeInvitation`/`revokeUser`/`setRole`/`transferAdmin`/`setShowNeedsApproval`, and calling the backup routes is a later integration task.
- No shared files with in-flight T-037, T-040, T-041, T-042, T-047 or the importer tasks.

**Spec refs:**
- SPEC.md §2: invitation-only access; every invited user is an Editor; admins manage invitations and access, can be several, and can transfer the admin seat; prevent removing the last admin.
- SPEC.md §6 / §10: the only presentation setting is **Show Needs approval**, default off, changeable only by Admins.
- SPEC.md §9 / §10: backups are a consistent snapshot plus photos and settings; restore validates first and is atomic; backups are confidential.
- Server facts this UI must match (read, do not change): `apps/server/src/access/index.ts` (`User`, `Invitation`, `AccessErrorCode`; `setRole` refuses demoting the last admin with `last_admin`; `transferAdmin` makes the target admin and the actor editor, refuses self with `invalid_login`); `apps/server/src/backup/backup.ts` (`BackupSummary`, `RestoreErrorCode`); `apps/server/src/backup/http.ts` (`GET /api/admin/backup` downloads; `POST /api/admin/restore?mode=dry-run|apply`; 413 `too_large`; 403 `forbidden`).
- Artboard 18 (`docs/design/ui-canvas/Settings.dc.html`).

## Goal
`<SettingsPage>` renders the three Settings sections from artboard 18 (People & access, Presentation, Backup & restore) from props, and reports every change through async callbacks that return a result. Admin-only controls are shown only to Admins. Destructive actions (remove access, transfer admin, restore) need an in-page confirmation. A preview at `/__preview/settings` drives it with in-memory fakes. Nothing is sent to the server.

## Design decisions (binding)

### Types (`apps/web/src/features/settings/types.ts`)
Declare these locally (the web app does not import from `apps/server`). They mirror the server shapes above.
```ts
export type Role = 'editor' | 'admin';
export type AccessUser = { id: string; login: string; displayName: string; role: Role; createdAt: string; revokedAt: string | null };
export type AccessInvitation = { id: string; login: string; invitedBy: string | null; createdAt: string };
export type AccessErrorCode = 'forbidden' | 'not_found' | 'invalid_login' | 'already_user' | 'already_invited' | 'last_admin' | 'revoked' | 'offline';
export type ActionResult = { ok: true } | { ok: false; code: AccessErrorCode };
export type BackupSummary = { createdAt: string; schemaVersion: number; members: number; proposals: number; users: number; photos: number; hasCurrent: boolean };
export type RestoreErrorCode = 'invalid_archive' | 'corrupt_database' | 'incompatible_schema' | 'missing_photo' | 'no_admin' | 'restore_failed' | 'too_large' | 'forbidden' | 'offline';
export type RestoreResult = { ok: true; summary: BackupSummary } | { ok: false; code: RestoreErrorCode };

export interface SettingsActions {
  invite(login: string): Promise<ActionResult>;
  revokeInvitation(invitationId: string): Promise<ActionResult>;
  revokeUser(userId: string): Promise<ActionResult>;
  setRole(userId: string, role: Role): Promise<ActionResult>;
  transferAdmin(toUserId: string): Promise<ActionResult>;
  setShowNeedsApproval(value: boolean): Promise<ActionResult>;
  validateRestore(file: File): Promise<RestoreResult>;
  applyRestore(file: File): Promise<RestoreResult>;
}
```

### Messages (`apps/web/src/features/settings/messages.ts`)
Export `accessErrorText(code: AccessErrorCode): string` and `restoreErrorText(code: RestoreErrorCode): string`, each a `switch` with `assertNever` (from `@wardboard/core`), and these exact strings:
- `forbidden` → `Only an Admin can do that.` · `not_found` → `That person or invitation no longer exists.` · `invalid_login` → `Enter a valid login.` · `already_user` → `That login already has access.` · `already_invited` → `That login is already invited.` · `last_admin` → `You're the only admin. Make someone else an admin first.` · `revoked` → `That person's access was already removed.` · `offline` → `Not connected. Try again when the connection is back.`
- `invalid_archive` → `This file is not a WardBoard backup.` · `corrupt_database` → `The backup's database is damaged.` · `incompatible_schema` → `This backup is from an incompatible version of WardBoard.` · `missing_photo` → `The backup is missing photos it refers to.` · `no_admin` → `The backup has no admin, so restoring it would lock everyone out.` · `restore_failed` → `Restore failed. Nothing was changed.` · `too_large` → `The file is too large to be a WardBoard backup.` · `forbidden` → `Only an Admin can restore backups.` · `offline` → `Not connected. Try again when the connection is back.`

### `apps/web/src/features/settings/SettingsPage.tsx`
`<SettingsPage me access showNeedsApproval backupUrl actions onBack onRestored />`:
- `me: { login: string; displayName: string; role: Role }` (the `Me` shape from `whoami`)
- `access: { users: readonly AccessUser[]; invitations: readonly AccessInvitation[] } | null` (null while loading; ignored for Editors)
- `showNeedsApproval: boolean`
- `backupUrl: string` (the preview and integration pass `'/api/admin/backup'`)
- `actions: SettingsActions`, `onBack: () => void`, `onRestored: () => void`

**Page chrome.** `<main aria-labelledby>` with heading `Settings` (h1), a `← Back to board` button calling `onBack`, and a section nav with in-page links `People & access`, `Presentation`, `Backup & restore` to three `<section>`s, each labelled by its h2.

**People & access (Admin).**
- Intro: `Everyone invited can edit every proposal. Admins also manage access.`
- `access === null` → `Loading people…`.
- One row per user with `revokedAt === null`, in this order: admins first, then editors, each by `displayName` (`localeCompare`, `en`). Revoked users are not shown. Each row: display name (with ` (you)` when `user.login === me.login`), login, and a text role label `Admin` or `Editor`.
- Then one row per invitation, by `createdAt`: the login, the text label `Invited`, and a `Revoke` button → `actions.revokeInvitation(id)`.
- Row actions for another user: `Make admin` (editor) / `Make editor` (admin) → `actions.setRole(id, role)`; `Remove access` → opens a confirmation (below) → `actions.revokeUser(id)`.
- Row actions for me: `Transfer admin` (shown only when at least one other active user exists) → a confirmation dialog listing the other active users as radio options (`Make {displayName} the admin`) with `Transfer` disabled until one is chosen → `actions.transferAdmin(id)`. `Remove access` on my own row is disabled when I am the only active admin, and the note `You're the only admin, so you can't remove your own admin role or access. Make someone else an admin first, or use Transfer admin.` is shown as text. `Make editor` on my own row follows the same rule (disabled with the same note when I am the only admin).
- Invite form: a text input labelled `Login to invite` and an `Invite editor` submit button, disabled while the trimmed value is empty. Submit calls `actions.invite(trimmed)` once; while pending the button reads `Inviting…` and is disabled. On success the input clears. On failure the input keeps its text and the error shows (below).
- Remove-access confirmation: `role="dialog"` `aria-modal="true"` heading `Remove access for {displayName}?`, text `They will be signed out right away and can no longer open WardBoard.`, buttons `Cancel` and `Remove access`. Escape cancels. No `window.confirm`.

**People & access (Editor).** Only the text `Only an Admin can manage access.` No user list, no buttons.

**Presentation.**
- A switch (`role="switch"`, `aria-checked`) labelled `Show Needs approval`, with the visible text `Admins only` and `Off by default. Only an Admin can change this.` Its state is also shown as text `On`/`Off` next to it (not color alone).
- Admin: toggling calls `actions.setShowNeedsApproval(!showNeedsApproval)`; it is disabled while pending. The displayed state follows the `showNeedsApproval` prop (the server's pushed value), never an optimistic local flip.
- Editor: the switch is rendered `aria-disabled="true"` and does nothing on click or keypress.

**Backup & restore (Admin).**
- Text: `Backups include members, photos, Current, every proposal and settings. Treat them as confidential.`
- `Create backup`: an `<a href={backupUrl} download>` styled as a button. (The server stores no backup history, so the artboard's list of earlier backups is not shown.)
- `Restore from file…`: a button that opens a hidden `<input type="file" accept=".backup,.tar,application/x-tar">` (accessible name `Backup file`). Choosing a file calls `actions.validateRestore(file)` once; while pending, show `Checking {file.name}…`.
- Validation failure → `role="alert"` with `restoreErrorText(code)`; nothing else changes.
- Validation success → a confirmation dialog, heading `Restore {file.name}?`, listing as text: `✓ Archive valid`, `{members} members`, `{photos} photos`, `{proposals} proposals`, `{users} users`, and `Current from {date}` (date = `createdAt` formatted `MMM D, YYYY` in UTC with `Intl.DateTimeFormat('en-US', { timeZone: 'UTC' })`) or `No Current board` when `hasCurrent` is false. Then `Replaces everything in WardBoard for everyone. Open boards reload. If anything fails, nothing changes.` and buttons `Cancel` and `Replace all data`.
- `Replace all data` calls `actions.applyRestore(file)` once (disabled and reading `Restoring…` while pending). Success → dialog closes, `Restore complete.` is shown, and `onRestored()` is called once. Failure → the dialog shows `restoreErrorText(code)` in `role="alert"` and stays open with `Cancel` enabled.

**Backup & restore (Editor).** Only the text `Only an Admin can create or restore backups.`

**Errors and pending state.** Each access action's failure shows `accessErrorText(code)` in a `role="alert"` region in the People & access section; the next successful action clears it. While any access action is pending, that row's buttons are disabled (no double submit). Every button and the switch are at least 44px tall. No information is conveyed by color alone.

### Preview (`apps/web/src/features/settings/preview.tsx`)
Default-exports `{ title: 'Settings', render }`. It keeps an in-memory access list in React state, seeded with fictional people only: you `Ada Admin` (`ada@example.test`, admin), `Ben Editor` (`ben@example.test`, editor), `Cy Counselor` (`cy@example.test`, editor), one invitation `dee@example.test`. Its fake actions apply the same rules as `apps/server/src/access/index.ts` for the codes this UI handles (`already_user`, `already_invited`, `last_admin`, self-transfer `invalid_login`) and resolve immediately. `validateRestore` returns a fixed summary (`members: 41, photos: 12, proposals: 2, users: 3, hasCurrent: true, createdAt: '2026-10-24T18:00:00Z'`) for any file whose name ends in `.backup`, otherwise `{ ok: false, code: 'invalid_archive' }`. `applyRestore` resolves success. A toggle in the preview (`View as Editor`) re-renders the page with `me.role = 'editor'`. `backupUrl` is `'#backup'` so the preview never downloads.

## Scope
May change:
- `apps/web/src/features/settings/**` (new)
- `apps/web/e2e/settings.spec.ts`, `apps/web/e2e/gui/settings.capture.ts` (new)

Must not change:
- `apps/web/src/shell/**`, `App.tsx`, `app.css`, `main.tsx`, `apps/web/src/preview/**`, `apps/web/src/design/**`, `apps/web/src/sync/**`, other `features/**`, `packages/**`, `apps/server/**`, existing tests, anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Component tests | `pnpm --filter @wardboard/web exec vitest run src/features/settings` | all tests in `SettingsPage.test.tsx` and `messages.test.ts` pass |
| 2 | Browser | `pnpm --filter web run test:e2e` | exits 0, including `settings.spec.ts` on all four projects |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/settings/` has desktop, phone (Chromium and WebKit) and TV PNGs for: admin page, editor page, remove-access dialog, restore confirmation dialog; inspected against artboard 18 |
| 4 | No browser dialogs | `grep -rnE "window\.(confirm|alert|prompt)|\bconfirm\(" apps/web/src/features/settings` | no output |
| 5 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
`SettingsPage.test.tsx` (Testing Library + `userEvent`, `vi.fn()` actions resolving controlled promises) and `messages.test.ts`.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `lists active admins then editors, marks you, hides revoked users, then invitations` | order Ada (you, Admin), Ben, Cy (Editor); a revoked user absent; `dee@example.test` with `Invited` and `Revoke` | revoked users shown; role only as color; wrong order |
| `editor sees no access controls, no backup controls, and a disabled switch` | `me.role='editor'`: the two `Only an Admin…` texts; no `Invite editor`, `Remove access`, `Create backup`; clicking the switch does not call `setShowNeedsApproval` | admin controls leaked to editors |
| `invite trims, sends once, clears on success` | type `  eve@example.test `, click twice fast → `invite` once with `eve@example.test`; input empties after resolve | untrimmed; double submit |
| `invite failure keeps the text and shows the mapped message` | resolves `{ok:false, code:'already_invited'}` → alert `That login is already invited.`; input keeps text | raw code shown; input cleared |
| `Invite editor is disabled for blank input` | whitespace only | empty invite sent |
| `Make admin and Make editor call setRole with the right role` | Ben → `('ben-id','admin')`; an admin other than me → `'editor'` | role inverted |
| `Remove access needs confirmation; Cancel and Escape do nothing` | click → dialog `Remove access for Ben Editor?`; Cancel/Escape → `revokeUser` not called; confirm → called once with Ben's id | destructive action without confirmation |
| `the only admin cannot remove or demote themself, and sees why` | me as sole admin: my `Remove access` and `Make editor` disabled; the last-admin note visible; with a second admin both enabled and note absent | last-admin guard missing in UI |
| `Transfer admin requires choosing a person` | dialog lists Ben and Cy; Transfer disabled until one chosen; calls `transferAdmin('cy-id')` | self offered; nothing chosen still submits |
| `Transfer admin is hidden when no one else has access` | users = [me] | offering an impossible action |
| `Revoke invitation calls revokeInvitation with its id` | click Revoke on dee | wrong id |
| `the switch shows server state, not an optimistic flip` | click on Off → `setShowNeedsApproval(true)` called; still `aria-checked="false"` and text `Off` until rerender with `showNeedsApproval` true | optimistic local state diverges from server |
| `restore: validation failure shows the mapped message and no dialog` | `invalid_archive` → `This file is not a WardBoard backup.` | raw code; dialog opened anyway |
| `restore: summary dialog shows counts and Current date, then applies once` | summary from preview values → texts `41 members`, `12 photos`, `2 proposals`, `3 users`, `Current from Oct 24, 2026`; click Replace twice → `applyRestore` once; `Restore complete.`; `onRestored` once | apply without validation; double apply; date in local time zone |
| `restore: hasCurrent false says No Current board` | summary with `hasCurrent: false` | always prints a date |
| `restore: apply failure keeps the dialog open with the message` | `restore_failed` → `Restore failed. Nothing was changed.`; `onRestored` not called | dialog closes on failure; reload triggered |
| `Create backup links to the backup URL with download` | `href` equals `backupUrl`, has `download` | button that does nothing |
| `messages map every code` (`messages.test.ts`) | each listed code → its exact string, for both functions | missing or wrong text; a new code silently falls through |

`e2e/settings.spec.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `admin invites, promotes and removes access in the preview` | `/__preview/settings`: invite `eve@example.test` → appears as `Invited`; Make admin on Ben → `Admin`; Remove access on Cy with confirmation → Cy gone | preview not wired; dialog not reachable by touch on phone |
| `restore shows the validation summary` | set a file named `ward.backup` on the `Backup file` input → dialog with `41 members`; Cancel closes it | file input not wired |
| `View as Editor hides admin controls` | toggle → `Only an Admin can manage access.` | role ignored |

## Edge cases (each needs a test)
Covered above: loading (`access === null` → `Loading people…`, add a test), revoked users, empty invitations, sole admin, nobody else to transfer to, blank invite, invite failure, double submit, restore validation failure, restore without Current, restore apply failure, Editor view.

## GUI verification
Required. Capture `/__preview/settings` at desktop, phone (Chromium and WebKit) and TV: admin page, editor page (after `View as Editor`), remove-access dialog, restore confirmation dialog (set the file through the input). Compare with artboard 18:
- Three sections with headings; role labels are text; the last-admin note is visible when it applies.
- Dialogs are fully visible and not clipped at 390 × 844; no horizontal page scroll on the phone; buttons and the switch at least 44px.
- The switch's state is readable without color (`On`/`Off` text).
- The artboard's backup history list and invite `Resend`/expiry text are intentionally absent (the server has neither); their absence is not a defect.

## Human checks
none (the real flows are checked after the integration task: invite a counselor, revoke, restore on the Mac Studio — already listed under T-072 and T-028).

## Out of scope
- Mounting Settings in the shell or account menu, sync-client methods, and real HTTP calls for backup/restore (later integration task).
- Backup history, scheduled backups, invitation expiry or resend (no server support; would need a SPEC decision).
- Import (T-059) and photo settings.
