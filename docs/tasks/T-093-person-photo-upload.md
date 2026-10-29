# T-093: Portrait and photo upload in the desktop person inspector

**Milestone:** 6 — Import and photos
**Depends on:** T-060 (photo upload and comparison), T-078 (person inspector in the app), T-027 (photo storage). All done.
- Runs in parallel with T-092 (phone layout) and T-061 (collector). It must not edit any existing e2e file, `App.tsx`, or any file T-092 lists.

**Spec refs:** SPEC.md §14 "Confirmed photo input routes" (an Editor uploads directly without directory access; the photo belongs to the shared member profile and shows across Current and all proposals; a placeholder when there is no photo; replacing an existing photo opens the side-by-side comparison; Keep Current and Cancel leave it unchanged; only Use New Photo replaces it; a first photo needs no comparison) and "Photo replacement acceptance". §7 (`photoRef` is ward-wide shared data). Artboard 14, `docs/design/ui-canvas/PhotoCompare.dc.html`.

## Goal
In the desktop app, the person inspector shows the member's stored portrait (or the initials placeholder when there is none) and offers the T-060 upload control. A first photo is stored and assigned at once. A replacement goes through the comparison dialog, which now shows the stored portrait as CURRENT. Every other client showing that member's inspector sees the new portrait without reloading, on any board.

## Design decisions (binding)

### Upload client (`apps/web/src/features/photos/upload.ts`)
```ts
export function photoUrl(photoRef: string): string; // '/api/photos/' + encodeURIComponent(photoRef)
export function uploadPhoto(file: File, fetchImpl?: typeof fetch): Promise<{ photoRef: string }>;
```
- `POST /api/photos`, body = the file, `content-type` = `file.type`, `credentials: 'same-origin'`.
- 201 with a JSON `photoRef` string → resolves `{ photoRef }`.
- Rejections, each an `Error` with exactly this message: 415 → `Choose a JPEG or PNG.`; 413 → `That photo is larger than 5 MB.`; 400 → `That file isn't a readable image.`; 401 or 403 → `You don't have permission to upload photos.`; any other status, a body without a string `photoRef`, or a network failure → `The photo could not be uploaded.`
- Never log the file, its bytes, or the ref.

### Assign
`assign(memberId, ref)` in the panel calls the existing `assignPhoto(client, memberId, ref)`. A result with `ok: false` throws `new Error(result.message)` so that `PhotoUpload` shows it in its alert.

### `PhotoUpload` (`apps/web/src/features/photos/PhotoUpload.tsx`)
Add an optional prop `currentUrl?: string | null` (default `null`), passed to `PhotoCompareDialog`'s `currentUrl`. Nothing else changes, and every existing photos test passes unmodified.

### Inspector portrait (`apps/web/src/features/person/PersonInspector.tsx`)
When `member.photoRef` is a non-null string, render `<img className="wb-person-avatar wb-person-photo" src={photoUrl(ref)} alt={`Portrait of ${member.name}`} />` in place of the initials span. Use the same size and shape as the initials avatar, `object-fit: cover`. When it is null, keep the current initials span unchanged. If the image fails to load (`onError`), fall back to the initials span for that ref. Existing inspector tests pass unmodified.

### Panel (`apps/web/src/shell/PersonPanel.tsx`)
Below `MemberTagsSection`, render `<PhotoUpload key={member.id} member={{ id, name, photoRef }} currentUrl={photoRef === null ? null : photoUrl(photoRef)} upload={uploadPhoto} assign={…} />` whenever a member is selected and `me` is signed in. Show it on Current, on Drafts, and on Accepted proposals, because the photo is ward-wide profile data like notes and tags, not a board placement. No other change to the panel's behavior.

The ward broadcast from T-060's `updateMember` path already carries the new `photoRef`, so the inspector re-renders from `useSync().ward`. Do not add a refetch.

## Scope
May change:
- `apps/web/src/features/photos/upload.ts`, `upload.test.ts` (new)
- `apps/web/src/features/photos/PhotoUpload.tsx` (`currentUrl` prop only), `photos.css` (only if needed)
- `apps/web/src/features/person/PersonInspector.tsx` (portrait only), `person.css` (portrait style only), `person-photo.test.tsx` (new, in that folder)
- `apps/web/src/shell/PersonPanel.tsx` (mount the upload only)
- `apps/web/src/shell/person-photo-panel.test.tsx` (new)
- `apps/web/e2e/person-photo.spec.ts`, `apps/web/e2e/gui/person-photo.capture.ts` (new)

Must not change:
- every existing test file (unit, e2e and capture), `App.tsx`, `BoardShell.tsx`, `apps/web/src/sync/**`, the phone folders, `apps/server/**`, `packages/**`, `scripts/**`, `playwright.config.ts`, `package.json`, `docs/gui-verification.md`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Unit tests | `pnpm --filter web exec vitest run src/features/photos src/features/person src/shell/person-photo-panel.test.tsx src/shell/person-panel.test.tsx` | every new test below passes and the existing photos, person and person-panel tests pass unmodified |
| 2 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/person-photo.spec.ts` | passes; it runs on desktop-chromium, and the other projects skip with the reason `Photo upload in the inspector is desktop-only; phones get it in T-094` |
| 3 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/person-photo/` has `placeholder-desktop-chromium.png`, `portrait-desktop-chromium.png`, `compare-desktop-chromium.png` |
| 4 | Mutation | in a disposable worktree at the candidate, make `PersonPanel` pass `currentUrl={null}` always, then run check 1 | `replacement compares against the stored portrait` fails; remove the worktree |
| 5 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 6 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 7 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `uploadPhoto posts the file and returns the ref` | a fake `fetch` sees `POST /api/photos`, the file body, the file's content type and same-origin credentials, and the 201 ref is returned | wrong method or URL; dropping the content type |
| `uploadPhoto maps each refusal to its message` | 415, 413, 400, 401, 403 and 500 each reject with the exact message | one generic message; resolving on error |
| `uploadPhoto rejects a body without a ref` | 201 with `{}` rejects `The photo could not be uploaded.` | returning `undefined` as the ref |
| `uploadPhoto rejects a network failure` | a throwing `fetch` rejects with the generic message, not the raw error | leaking the underlying error |
| `photoUrl encodes the ref` | `photoUrl('ab.jpg')` is `/api/photos/ab.jpg`; a ref with `/` is encoded | building paths by concatenation |
| `inspector shows the portrait when the member has one` | an `img` named `Portrait of <name>` with `src` `/api/photos/<ref>`; no initials | always initials |
| `inspector shows initials without a photo` | the initials span and no portrait image | an empty img |
| `inspector falls back to initials when the portrait fails to load` | firing `error` on the img shows the initials | a broken image icon |
| `panel offers upload for the selected member on Current and on a Draft` | the `Upload photo for <name>` input is present in both cases | gating it behind `readOnly` |
| `first photo uploads and assigns through the sync client` | choosing a PNG calls `uploadPhoto` and then `updateMember(id, { photoRef })` exactly | skipping assign; patching other fields |
| `replacement compares against the stored portrait` | for a member with a `photoRef`, choosing a file opens the dialog whose CURRENT image `src` is `/api/photos/<ref>` | passing `null` as `currentUrl` |
| `a refused assign shows its message` | `updateMember` returning `{ ok: false, message: 'Not allowed' }` shows `Not allowed` in an alert | swallowing the failure |
| `a ward update shows the new portrait` | after the sync state's ward changes the member's `photoRef`, the inspector `src` changes without reselecting | caching the first ref |

Use the sync test helpers the existing shell tests use (read `person-panel.test.tsx` and its helpers; do not modify them). Build tiny PNG bytes in the test; no real photos.

## e2e (`apps/web/e2e/person-photo.spec.ts`, desktop-chromium)
Load `/?layout=desktop` (harmless before T-092 merges). Use a member that no other spec inspects. Read `person-panel.spec.ts` and `tags-in-app.spec.ts`, and pick someone not in their project tables. Generate a valid tiny PNG (and a second, different one) in the spec with Node.
1. Page A and page B (two contexts), both on Current, select the member. Both show the initials.
2. Page A uploads PNG 1. Page A shows `Photo added for <name>`. Page B's inspector shows `Portrait of <name>` without a reload, and its image has loaded (`naturalWidth > 0`).
3. Page B switches to the `Spring adjustments` tab and selects the same member: the portrait is there too (ward-wide).
4. Page A uploads PNG 2: the comparison dialog opens with CURRENT and INCOMING images, both loaded. Keep Current: page B's `src` is unchanged.
5. Page A uploads PNG 2 again and chooses Use New Photo: page B's `src` changes to a different ref.

## GUI verification
Required. On desktop-chromium, capture the inspector with initials before any upload (`placeholder`), with the portrait after (`portrait`), and the comparison dialog showing both images (`compare`). Look at them and compare with artboard 14 and the inspector in `Main.dc.html`. Fail on: a portrait that is stretched or a different size from the placeholder, a CURRENT image that is blank, the upload control overflowing the panel, or an upload control under 44px.

## Human checks
- Desktop Chrome: upload a real-sized photo (a few MB) of a fictional placeholder image, not a ward member, and confirm the portrait looks crisp and correctly cropped in the inspector.

## Out of scope
- Portraits on board cards, the dugout, search results, presentation mode, or phone screens (later tasks in `docs/tasks/phone-integration-plan.md`).
- Removing a photo, resizing or cropping, and batch/bundle import (T-098).
- Server changes.
