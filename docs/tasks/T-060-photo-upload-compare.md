# T-060: Photo upload and comparison

**Milestone:** 6 — Import and photos
**Depends on:** T-027 (photo storage) and T-037 (person inspector). Both done. T-026 left `photoRef` unset on purpose.
- No shared files with in-flight T-049 (`features/phone-person`), T-050 (`features/phone-search`, `features/phone-dugout`), T-051 (`features/phone-changes`), or T-091 (`scripts/e2e-slot.pl`, `apps/web/package.json`, `scripts/verify.sh`, `docs/gui-verification.md`).

**Spec refs:** SPEC.md §7 (a member's `photoRef` is ward-wide shared data), §14 "Confirmed photo input routes" and "Photo replacement acceptance" (direct upload works without directory collection; replacing an existing photo shows current and incoming side by side with the member's name; Keep Current and Cancel leave the stored photo unchanged; only Use New Photo replaces it; a batch presents one comparison at a time and must not silently replace; a first photo needs no comparison; household images are not portraits). Artboard 14, `docs/design/ui-canvas/PhotoCompare.dc.html`.

## Goal
A direct upload of a JPEG or PNG for a member with no photo stores it and sets `photoRef` immediately. A member who already has a photo, and each proposed replacement in a batch, goes through one comparison dialog. Keep Current and Cancel import do not change `photoRef`. Use New Photo sets that member's `photoRef` through `updateMember`, and every subscribed client receives the updated ward. The preview at `/__preview/photos` shows the dialog. Nothing is mounted in the app shell.

## Design decisions (binding)

### Server: `photoRef` on `updateMember`
`parseMemberPatch` accepts an optional `photoRef` string matching `/^[0-9a-f]{64}\.(jpg|png)$/`. `photoRef: null`, a non-string, an empty string, uppercase hex, a different extension, or a path is rejected with `photoRef must be a 64-character lowercase sha256 hex with a jpg or png extension`. The existing assertion `parseMemberPatch({ name: 'Ada', photoRef: null }).ok === false` in `apps/server/test/members/rules.test.ts` must stay true. Do not edit that file.

A patch must include at least one of `name`, `note`, `tagIds`, or `photoRef`. Unknown keys, including `needsApproval`, are still `patch has an unknown key`.

`updateMemberProfile` persists `photo_ref` when the patch includes `photoRef`, and does not write that column when the patch omits it. A later note-only patch leaves the stored `photoRef` in place. The in-memory ward used for the `ward` broadcast includes the new `photoRef`. Setting `photoRef` does not change `name`, `note`, or `tagIds`. Unknown member is `not_found` and writes nothing.

Editors and Admins may both set it. A revoked session is refused by the existing access gate. Do not add an HTTP assign route. Do not check that the file exists on disk (upload already returned the ref). Do not log the ref or the image.

`apps/web/src/sync/protocol.ts` `MemberPatch` gains optional `photoRef?: string`. The client already forwards the patch. Do not edit `client.ts`.

```ts
export function assignPhoto(
  client: { updateMember(memberId: string, patch: { photoRef: string }): Promise<RequestResult> },
  memberId: string,
  photoRef: string,
): Promise<RequestResult>;
```

It calls `updateMember` with exactly `{ photoRef }` and returns that result.

### Batch plan (`apps/web/src/features/photos/plan.ts`)
```ts
export type PhotoMember = {
  readonly id: string;
  readonly name: string;
  readonly photoRef: string | null;
};

export function planPhotoBatch(
  members: readonly PhotoMember[],
  incoming: readonly { readonly memberId: string }[],
):
  | { ok: true; apply: readonly string[]; compare: readonly string[] }
  | { ok: false; code: 'unknown_member' | 'duplicate_member' };
```

- A repeated `memberId` returns `{ ok: false, code: 'duplicate_member' }` and no arrays.
- An id absent from `members` returns `{ ok: false, code: 'unknown_member' }`.
- `photoRef === null` goes in `apply`. Any other string goes in `compare`. Incoming order is kept within each list.
- Empty incoming returns `{ ok: true, apply: [], compare: [] }`.
- Do not mutate the arguments.

`apply` members get the new photo with no dialog. `compare` members are shown one at a time.

### `<PhotoCompareDialog>` (`apps/web/src/features/photos/PhotoCompareDialog.tsx`)
Props: `memberName`, `currentUrl: string | null`, `incomingUrl`, `sourceLabel`, `index` (1-based), `total`, `skippedHousehold`, `onKeepCurrent`, `onUseNew`, `onCancelImport`.

- `role="dialog"` `aria-modal="true"` labelled by an `<h2>` whose text is `Replace {memberName}'s photo?`.
- Progress text, exactly `{sourceLabel} · {index} of {total}`. A `role="progressbar"` with `aria-valuenow={index}`, `aria-valuemin={1}`, `aria-valuemax={total}`.
- Two figures. Visible labels `CURRENT` and `INCOMING` (text, not color alone).
- Current: an `<img alt="Current portrait of {memberName}">` when `currentUrl` is non-null. When it is null, a placeholder using `initials` and `avatarColor` from `apps/web/src/design/person.ts` (do not reimplement them), `role="img"` `aria-label="Current portrait of {memberName}"`.
- Incoming: `<img alt="Incoming portrait of {memberName}">`.
- Figcaptions `Current portrait` and `Incoming portrait`.
- When `skippedHousehold` is 0, no household sentence. When it is 1: `1 household image was skipped — it isn't offered as a portrait.` When it is greater: `{n} household images were skipped — they aren't offered as portraits.`
- Buttons, each at least 44px tall, using `Button`: `Cancel import` (ghost), `Keep Current` (secondary), `Use New Photo` (primary). Each calls only its own callback.
- The two figures sit side by side when there is room and stack when they would overflow. At 390px the dialog must not make the page scroll horizontally. Images are at most 200px and shrink with the column.

### `<PhotoUpload>` (`apps/web/src/features/photos/PhotoUpload.tsx`)
Props: `member: PhotoMember`, `upload: (file: File) => Promise<{ photoRef: string }>`, `assign: (memberId: string, photoRef: string) => Promise<void>`.

- A file input `accept="image/jpeg,image/png"` with label `Upload photo for {name}`.
- A type other than `image/jpeg` or `image/png` shows `Choose a JPEG or PNG.` and calls neither callback.
- No current photo: call `upload` then `assign` with the returned ref. Then show `Photo added for {name}`. No dialog.
- A current photo: do not call `upload` yet. Open `PhotoCompareDialog` with `sourceLabel` `Direct upload`, `index` 1, `total` 1, `skippedHousehold` 0, and an object URL of the file as `incomingUrl`. `currentUrl` stays null in this task (the stored bytes are not re-fetched here). Use New Photo calls `upload` then `assign`, then closes the dialog and shows `Using the new photo for {name}.` Keep Current and Cancel import close the dialog, call neither callback, and show nothing about a new photo.
- A rejected `upload` or `assign` shows the error message in a `role="alert"` and does not show the success line.

### `<PhotoBatchReview>` (`apps/web/src/features/photos/PhotoBatchReview.tsx`)
Props: `steps: readonly { memberName: string; currentUrl: string | null; incomingUrl: string }[]`, `sourceLabel`, `skippedHousehold`, `onUseNew: (index: number) => void`, `onKeep: (index: number) => void`, `onCancel: () => void`. `index` is the 0-based step.

Shows one `PhotoCompareDialog` for `steps[0]`. Keep Current and Use New Photo advance to the next step and call `onKeep` or `onUseNew` with that step's index. Cancel import calls `onCancel` and shows `Import cancelled.` with no further dialog. After the last Use New Photo or Keep Current, the dialog is gone. If the last action was Use New Photo, show `Using the new photo for {that member's name}.` If it was Keep Current, show `Kept the current photo for {that member's name}.`

### Preview (`apps/web/src/features/photos/preview.tsx`)
Discovered by the existing glob. Do not edit `apps/web/src/preview/**`.

`/__preview/photos` renders `PhotoBatchReview` for Ada Fictional then Ben Example, in that order. Both steps have distinct inline SVG `data:` URLs so the two portraits in a step look different, and the two steps look different from each other. `sourceLabel` is `Directory import`. `skippedHousehold` is 2. Current URLs are non-null. The review's callbacks only record the choice in the preview's own status text (`Kept the current photo for {name}.` or `Using the new photo for {name}.` or `Import cancelled.`). They do not call the server.

Below the review, after it is finished or cancelled, render `PhotoUpload` for Cal Sample with `photoRef: null` and mock `upload` / `assign` that resolve `{ photoRef: 'ab'.repeat(32) + '.jpg' }` and append `Photo added for Cal Sample`. The mock must not run while the batch dialog is open only because of a render; it runs when a file is chosen.

## Scope
May change:
- `apps/web/src/features/photos/**` (new)
- `apps/web/src/sync/protocol.ts` (`MemberPatch.photoRef` only)
- `apps/web/e2e/photos.spec.ts` (new)
- `apps/web/e2e/gui/photos.capture.ts` (new)
- `apps/server/src/members/rules.ts` (`photoRef` on the patch only)
- `apps/server/src/store/types.ts`, `apps/server/src/store/index.ts`, `apps/server/src/store/persist.ts` (persist `photo_ref` only)
- `apps/server/src/ws/channel.ts` (pass `photoRef` through `profilePatch` only)
- `apps/server/test/members/photo-ref-rules.test.ts` (new)
- `apps/server/test/store/photo-ref.test.ts` (new)
- `apps/server/test/ws/photo-ref.test.ts` (new)

Must not change:
- `apps/server/test/members/rules.test.ts` and every other existing test
- `apps/web/package.json`, `scripts/**`, `docs/gui-verification.md`, `apps/web/e2e/playwright.config.ts`, `apps/web/src/preview/**`, `apps/web/src/shell/**`, `apps/web/src/design/**`, `App.tsx`, phone feature folders, `packages/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Web unit tests | `pnpm --filter web exec vitest run src/features/photos` | every test below passes |
| 2 | Patch rules | `pnpm --filter @wardboard/server exec vitest run test/members/photo-ref-rules.test.ts test/members/rules.test.ts` | both files pass, including the existing `photoRef: null` rejection |
| 3 | Store | `pnpm --filter @wardboard/server exec vitest run test/store/photo-ref.test.ts` | the store tests below pass |
| 4 | WebSocket | `pnpm --filter @wardboard/server exec vitest run test/ws/photo-ref.test.ts` | the channel tests below pass |
| 5 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/photos.spec.ts` | passes on desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 6 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/photos/` has `dialog-<project>.png` and `kept-<project>.png` for desktop-chromium, phone-chromium, phone-webkit, and tv-chromium |
| 7 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 8 | Quality gate | `./scripts/verify.sh` | exits 0 |

Run acceptance 5 and 6 through the package scripts as written. Do not edit `package.json`. If `gui:capture` on this branch does not yet go through `scripts/e2e-slot.pl`, that is expected: T-091 owns that change.

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `plan splits new photos from replacements and preserves order` | null `photoRef` is `apply`; a set `photoRef` is `compare`; order inside each list matches input | one list; sorting by name |
| `plan rejects duplicates and unknown ids` | `duplicate_member` and `unknown_member` have no `apply` array | planning the first id anyway |
| `plan of no incoming photos is empty` | `{ ok: true, apply: [], compare: [] }` | throwing |
| `dialog names the member and the step` | heading `Replace Ada Fictional's photo?`, text `Directory import · 1 of 2`, labels `CURRENT` and `INCOMING`, both portrait alts, household sentence for 2, three buttons | missing text; color as the only progress signal |
| `no household sentence when none were skipped` | the household sentence is absent | always rendering it |
| `singular household sentence` | `skippedHousehold` 1 uses the singular sentence | always plural |
| `keep, use, and cancel call only their own handler` | one click, one call, the other handlers unused | one button calling all three |
| `batch advances one comparison at a time` | Keep Current on Ada shows Ben's dialog `2 of 2` and calls `onKeep(0)`; Use New Photo then removes the dialog and shows `Using the new photo for Ben Example.` | showing both dialogs; assigning on Keep |
| `cancel import stops the rest` | Cancel on the first step shows `Import cancelled.` and Ben's heading is absent; `onCancel` called once | advancing to the next member |
| `last keep says the current photo was kept` | Keep on the only step shows `Kept the current photo for Ada Fictional.` | showing the Use New sentence |
| `first photo uploads and assigns without a dialog` | choosing a `image/png` file calls `upload` then `assign` with that ref and shows `Photo added for Cal Sample` | opening the dialog |
| `replacement does not upload until Use New Photo` | choosing a file for a member with `photoRef` set opens the dialog and calls neither callback; Use New Photo then calls `upload` once and `assign` once; Keep Current calls neither | uploading on file selection; assigning on Keep |
| `a non-image shows the JPEG or PNG message` | `text/plain` shows `Choose a JPEG or PNG.` and calls neither callback | trusting the file name |
| `a failed upload shows an alert and does not assign` | rejected `upload` → `role="alert"`; `assign` not called | treating the rejection as success |
| `assignPhoto sends only photoRef` | the patch object is exactly `{ photoRef }` | sending name or note as well |
| `parseMemberPatch accepts a jpg and a png ref` | `{ photoRef: '<64 hex>.jpg' }` and the png form succeed; null, `../x`, uppercase, `.gif`, and `''` fail with the exact message | accepting null (breaks the existing rules test) |
| `store persists photoRef and a later note leaves it` | reload shows the ref; a note-only patch keeps it; unknown member is `not_found` and the row is unchanged | omitting `photo_ref` in the UPDATE; setting it null when the patch has no photoRef |
| `updateMember sets photoRef for an Editor and broadcasts the ward` | an Editor (not an Admin) receives `memberUpdated`; a second connection subscribed to a different proposal receives `ward` whose member `photoRef` is the ref; name, note, and tags are unchanged; load after reopen matches | admin-only check; broadcasting a ward without `photoRef`; not persisting |
| `invalid photoRef and unknown member do not write` | bad ref → `bad_request` and the stored ref is unchanged; unknown member → `not_found` | writing the bad ref |
| `revoked session cannot set photoRef` | the refusal is `forbidden` and the stored ref is unchanged | skipping the access re-check |

Web tests use Testing Library. Server tests use the real SQLite store and the real WebSocket harness already in `apps/server/test` (read it; do not modify it). No real photos: build a tiny PNG or JPEG byte fixture only if a test needs one, and use hex refs in the profile tests.

## Edge cases (each needs a test)
Covered above: empty batch, duplicate id, unknown id, first photo, replacement, keep, cancel, last-step keep, non-image, failed upload, null and malformed refs, note patch after a photo, Editor, revoked, unknown member.

## GUI verification
Required. Capture `/__preview/photos` at desktop, phone-chromium, phone-webkit, and TV.

1. The open dialog (`dialog-<project>.png`): heading, `Directory import · 1 of 2`, `CURRENT`, `INCOMING`, two different portraits, the household sentence, and the three buttons. Compare with artboard 14.
2. Click Keep Current. The next dialog (`kept-<project>.png`) shows Ben Example and `2 of 2`.

On the phone projects, assert no horizontal overflow and that each of the three buttons is at least 44px tall. Look at the screenshots. A dialog that is clipped, or portraits that overflow the phone width, fails this task.

## Human checks
On an iPhone, open `/__preview/photos` after the dev server is up. Confirm the comparison can be read and the three actions tapped with one hand, and that the page does not scroll sideways. Feel only; the overflow and target size are already machine-checked.

## Out of scope
- Mounting upload on the person inspector or in `BoardShell`.
- The directory collector (T-061), household-image detection (the dialog only displays a count it is given), orphan photo cleanup, removing a photo, and resizing.
- Checking that the ref exists on disk.
- `apps/web/package.json` and the e2e slot pool (T-091).
