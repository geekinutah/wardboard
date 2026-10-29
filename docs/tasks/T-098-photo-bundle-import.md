# T-098: Photo bundle import

**Milestone:** 6 — Import and photos
**Depends on:** T-061 (directory photo collector), T-093 (portrait and photo upload in the desktop person inspector; `assignPhoto` in `features/photos/assignPhoto.ts`), T-060 (photo batch planner and one-at-a-time comparison). All done.
- T-099 (`docs/import/` guide and operator prompt for the shipped collector) depends on this task and runs after it.

**Spec refs:** SPEC.md §14 (Photos: directory photo collection produces a bundle of names and individual portraits; present a match preview before importing and require confirmation for namesakes or ambiguous matches; importing a first photo for someone who had none applies without confirmation; replacing an existing photo shows a one-at-a-time current-vs-incoming comparison before applying; `photoRef` is ward-wide shared profile data across Current and all proposals; clean up temporary collector artifacts after handoff). §15 (Allowed member data: keep only allow-listed fields; reject household images). §11 (Security: every HTTP route requires an authenticated active session; origin check on state-changing HTTP routes). Artboards `docs/design/ui-canvas/Settings.dc.html` and `docs/design/ui-canvas/PhotoCompare.dc.html`.

## Goal
In Settings (`/settings`), an Editor or Admin can select the files from a `tools/collector` staging bundle (`manifest.json` and the portrait `.jpg`/`.png` files), upload and sanitize the portraits through a server bundle endpoint, review how each bundle portrait name matches against the ward (with explicit confirmation required for namesakes or ambiguous matches), apply first-time photos immediately while stepping through existing-photo replacements one at a time with `PhotoBatchReview`, and copy the collector `--cleanup` command once handoff completes.

## Design decisions (binding)

### 1. Server bundle route (`POST /api/photos/bundle`)
- Handled inside `apps/server/src/photos/` (`http.ts` and a new `bundle.ts`, exported as needed from `apps/server/src/photos/index.ts`). Because `apps/server/src/server.ts` already dispatches `pathname === '/api/photos' || pathname.startsWith('/api/photos/')` after authenticating and resolving an active user (`admin` or `editor`), `server.ts` does not need to change.
- **Method & headers:**
  - `pathname === '/api/photos/bundle'`: only `POST` is allowed; any other method returns `405` with `allow: 'POST'` and `{"error":"method_not_allowed"}`.
  - Origin check: requires `Origin` header matching `appOrigin` or `listenOrigin` (same `originAllowed` check as `POST /api/photos`); missing or foreign `Origin` returns `403` `{"error":"forbidden"}` with `cache-control: no-store`.
  - Both `admin` and `editor` roles are permitted (unauthenticated requests return `401` and revoked/uninvited users return `403` via `server.ts`).
  - Body size limit: `MAX_BUNDLE_BYTES = 25 * 1024 * 1024` (25 MiB) in `apps/server/src/photos/limit.ts`. Declared or streamed payloads exceeding `MAX_BUNDLE_BYTES` return `413` `{"error":"too_large"}` via `sendTooLarge`.
- **Request JSON format:**
  ```ts
  export interface PhotoBundleRequest {
    readonly manifest: {
      readonly format: 'wardboard-photo-bundle';
      readonly version: 1;
      readonly layoutVersion: string;
      readonly portraits: readonly {
        readonly name: string;
        readonly file: string;
        readonly duplicateName: boolean;
      }[];
      readonly missing: readonly {
        readonly name: string;
        readonly reason: 'none' | 'household';
      }[];
      readonly skippedHousehold: number;
    };
    /** Base64-encoded image bytes keyed by the manifest portrait `file` name (`<64-hex>.jpg` or `<64-hex>.png`). */
    readonly files: Readonly<Record<string, string>>;
  }
  ```
- **Validation (all-or-nothing before storing):**
  - Reject with `400` `{"error":"invalid_bundle"}` if:
    - body is not valid JSON or not an object with `manifest` and `files` (and no extra top-level keys);
    - `manifest.format !== 'wardboard-photo-bundle'` or `manifest.version !== 1` or `typeof manifest.layoutVersion !== 'string'` or `manifest.layoutVersion.trim().length === 0`;
    - `manifest.skippedHousehold` is not a non-negative integer;
    - `manifest.missing` is not an array of `{ name: non-empty string, reason: 'none' | 'household' }` (with no extra keys on entries or manifest);
    - `manifest.portraits` is not an array (max 500 entries) where every entry has only `{ name: non-empty trimmed string, file: /^[0-9a-f]{64}\.(?:jpg|png)$/, duplicateName: boolean }`;
    - `files` has keys not referenced by `manifest.portraits`, or is missing any `file` referenced by `manifest.portraits`;
    - any `files[file]` is not valid base64, decodes to empty or `> MAX_PHOTO_BYTES` bytes, fails `sanitizePhoto(bytes, ext === 'jpg' ? 'image/jpeg' : 'image/png')`, or its sanitized `ext` does not match the filename extension, or `sha256(bytes)` (hex) of the decoded file does not match the `<64-hex>` stem of `file` (ensuring the bundle's content-addressed filenames are authentic and free of path traversal).
  - If any check fails, **no photo is written** to `PhotoStore`.
  - When all portraits are valid, store each unique sanitized image via `await photos.put(sanitized.bytes, sanitized.ext)` and return `200` with:
    ```ts
    export interface PhotoBundleResponse {
      readonly portraits: readonly {
        readonly name: string;
        readonly file: string;
        readonly photoRef: string;
        readonly duplicateName: boolean;
      }[];
      readonly missing: readonly {
        readonly name: string;
        readonly reason: 'none' | 'household';
      }[];
      readonly skippedHousehold: number;
    }
    ```

### 2. Pure bundle matching & client helpers (`apps/web/src/features/photos/bundle.ts`)
- Normalize a display/canonical name for matching by trimming and collapsing internal whitespace to a single space, lowercased (`normalizeBundleName(name)`).
- Only active ward members (`member.removedDate === null`) are eligible targets.
- Given `members: readonly Member[]` and `portraits: readonly UploadedBundlePortrait[]` (from `PhotoBundleResponse['portraits']`):
  ```ts
  export interface BundleCandidateMember {
    readonly memberId: string;
    readonly name: string;
    readonly photoRef: string | null;
  }

  export type BundlePortraitMatch =
    | {
        readonly kind: 'matched';
        readonly index: number;
        readonly name: string;
        readonly file: string;
        readonly photoRef: string;
        readonly member: BundleCandidateMember;
      }
    | {
        readonly kind: 'ambiguous';
        readonly index: number;
        readonly name: string;
        readonly file: string;
        readonly photoRef: string;
        readonly candidates: readonly BundleCandidateMember[];
      }
    | {
        readonly kind: 'unmatched';
        readonly index: number;
        readonly name: string;
        readonly file: string;
        readonly photoRef: string;
      };
  ```
- **Matching rule (`matchBundlePortraits(members, portraits)`):**
  - Group active ward members by `normalizeBundleName(member.canonicalName)` (sorted by `canonicalName`, then `id`).
  - Count how many bundle portraits share each normalized name.
  - For each portrait at `index`:
    - If 0 active ward members have that normalized name → `kind: 'unmatched'`.
    - If 1 active ward member has that normalized name, `portrait.duplicateName === false`, and only 1 portrait in the bundle has that normalized name → `kind: 'matched'` with that `member`.
    - Otherwise (multiple active ward members share the name, or `portrait.duplicateName === true`, or multiple portraits in the bundle share the name while ≥ 1 active ward member has that name) → `kind: 'ambiguous'` with `candidates` set to the matching active ward members (so the user must explicitly confirm which member gets the portrait or skip it).
- **Resolution validation (`resolveBundleSelections(matches, selections)`):**
  - `selections` is `Readonly<Record<number, string>>`, where each `ambiguous` row `index` maps to either a chosen `memberId` from that row's `candidates` or `'skip'`.
  - Returns `{ ok: false, reason: 'unresolved' | 'duplicate_target' }` if any `ambiguous` row has no selection, or if two rows resolve to the same `memberId`.
  - When valid, returns `{ ok: true, incoming: readonly IncomingMemberPhoto[] }` (in portrait order, omitting `'unmatched'` and `'skip'` rows), ready to pass directly into `planPhotoBatch(members, incoming)` from `features/photos/plan.ts`.
- **Reading & uploading files (`readBundleFiles(files)` and `postPhotoBundle(fetchImpl, payload)`):**
  - `readBundleFiles(files: Iterable<File>)`: finds `manifest.json` (by filename `manifest.json`), parses it as JSON, reads every other selected file as base64 keyed by `file.name`, and validates locally that `manifest.json` is present and every `portrait.file` in `manifest.portraits` was selected in the file picker. If `manifest.json` is missing, malformed, or any referenced portrait file is missing from the selection, returns `{ ok: false, message: "Select manifest.json and every portrait image from the collector's bundle folder." }`.
  - `postPhotoBundle(fetchImpl, payload)` POSTs JSON to `/api/photos/bundle` with `credentials: 'same-origin'` and maps HTTP responses to `{ ok: true, bundle: PhotoBundleResponse }` or `{ ok: false, code: 'forbidden' | 'too_large' | 'invalid_bundle' | 'offline' }`.

### 3. Settings section (`apps/web/src/shell/PhotoBundleSection.tsx` + `photo-bundle-section.css`)
- Mounted in `apps/web/src/shell/SettingsRoute.tsx` inside `SettingsPage`'s `extra` prop for **all signed-in users** (both Editors and Admins), right after `<TagLibrarySection />`:
  ```tsx
  extra={
    <>
      <TagLibrarySection />
      <PhotoBundleSection />
      {isAdmin ? <ImportSection /> : null}
    </>
  }
  ```
- Section structure (`<section className="wb-photo-bundle-section" aria-labelledby={headingId}>`):
  - Heading `<h2>`: `Directory photos`
  - Note: `Import a photo bundle from the local directory collector. First photos apply right away; replacements are compared one at a time.`
  - **Step 1 — Pick & upload bundle files (idle state):**
    - `<label>` `Photo bundle files` linked to `<input type="file" multiple accept="application/json,.json,image/jpeg,image/png,.jpg,.jpeg,.png" className="wb-photo-bundle-input" />` (touch target height ≥ 44px).
    - Shows the count of selected files when non-empty (e.g. `3 files selected`).
    - Button `Review photo bundle` (disabled until at least 1 file is selected or while uploading; shows `Checking bundle…` while in flight).
    - Errors render in `<p role="alert" className="wb-photo-bundle-error">`.
  - **Step 2 — Match preview (after `POST /api/photos/bundle` succeeds):**
    - Heading `<h3>`: `Review photo matches`
    - Summary line showing counts: `{M} matched · {A} need confirmation · {U} unmatched` (plus, when `bundle.skippedHousehold > 0`, `{H} household images skipped`).
    - If there are `matched` rows: lists each matched member name and whether it is a `First photo` (`member.photoRef === null`) or `Replaces existing photo` (`member.photoRef !== null`).
    - If there are `ambiguous` rows: each row (`className="wb-photo-bundle-row"`) shows the incoming portrait thumbnail (`photoUrl(row.photoRef)`, `alt="Incoming portrait for {name}"`), the name, and accessible `<button type="button">` choices (each ≥ 44px high) for each candidate (`Match {candidate.name} ({candidate.memberId})` when multiple ward members share a name, or `Assign to {candidate.name}` when one ward member matches a duplicate bundle name) plus a `Skip` button (`aria-pressed` on the chosen option). If two ambiguous rows are assigned to the same ward member, show an inline alert `Each person can receive at most one photo from the bundle.` and keep `Import photos` disabled.
    - If there are `unmatched` rows: lists the unmatched names with `Not in ward — skipped`.
    - Actions:
      - `Start over` (`variant="secondary"`) resets back to Step 1.
      - `Import photos` (primary `Button`, disabled until all ambiguous rows have a valid non-conflicting selection and there is at least one photo to import, or while applying).
  - **Step 3 — Applying first photos & one-at-a-time replacement comparison:**
    - Clicking `Import photos` runs `planPhotoBatch(wardMembers, incoming)`:
      - Every `memberId` in `plan.apply` (members with `photoRef === null`) is assigned immediately via `await assignPhoto(client, memberId, incomingPhotoRef)`.
      - If `plan.compare` is non-empty, renders `<PhotoBatchReview steps={compareSteps} sourceLabel="Directory import" skippedHousehold={bundle.skippedHousehold} onUseNew={...} onKeep={...} onCancel={...} />` where:
        - `onUseNew(index)` calls `await assignPhoto(client, step.memberId, step.incomingPhotoRef)`.
        - `onKeep(index)` keeps the current photo.
        - `onCancel()` stops the remaining comparisons (already-applied first photos and earlier confirmed replacements remain applied) and moves to Step 4.
      - When `plan.compare` is empty, or after the last comparison step is decided, moves to Step 4.
  - **Step 4 — Handoff complete & collector cleanup offer:**
    - Status `<p role="status">`: `Imported directory photos: {applied} added, {replaced} replaced, {kept} kept.`
    - Cleanup prompt card (`className="wb-photo-bundle-cleanup"`):
      - Text: `Clean up the temporary collector staging folder on your computer:`
      - Copyable command in `<code>`: `pnpm --filter @wardboard/collector run collect -- --staging <staging-dir> --cleanup`
      - Button `Import another bundle` (`variant="secondary"`, ≥ 44px) to reset to Step 1.

## Scope
May change:
- `apps/server/src/photos/limit.ts` (export `MAX_BUNDLE_BYTES`)
- `apps/server/src/photos/bundle.ts` (new; bundle request validation, image sanitization, and storage)
- `apps/server/src/photos/http.ts` (route `/api/photos/bundle` to `handleBundleUpload`)
- `apps/server/src/photos/index.ts` (re-export `MAX_BUNDLE_BYTES` if needed)
- `apps/server/test/photos/bundle.test.ts` (new; server route unit/integration tests)
- `apps/web/src/features/photos/bundle.ts` (new; bundle file reading, HTTP client, name matching, selection resolution)
- `apps/web/src/features/photos/bundle.test.ts` (new; unit tests for bundle matching and client helpers)
- `apps/web/src/shell/PhotoBundleSection.tsx`, `apps/web/src/shell/photo-bundle-section.css`, `apps/web/src/shell/photo-bundle-section.test.tsx` (new)
- `apps/web/src/shell/SettingsRoute.tsx` (mount `<PhotoBundleSection />` in `extra` only)
- `apps/web/e2e/photo-bundle.spec.ts`, `apps/web/e2e/gui/photo-bundle.capture.ts` (new)

Must not change:
- every existing test file (unit, e2e and capture), `apps/server/src/server.ts`, `apps/web/src/shell/PhoneApp.tsx`, `apps/web/src/shell/PhoneEditing.tsx`, `apps/web/src/features/phone-*/**`, `apps/web/src/features/dnd/**`, `apps/web/src/features/photos/plan.ts`, `PhotoBatchReview.tsx`, `PhotoCompareDialog.tsx`, `PhotoUpload.tsx`, `upload.ts`, `assignPhoto.ts`, `portraits.test.tsx`, `tools/collector/**`, `packages/**`, `scripts/**`
- anything else

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Server unit tests | `pnpm --filter @wardboard/server exec vitest run test/photos/bundle.test.ts test/photos/routes.test.ts` | every new test in `bundle.test.ts` passes; `routes.test.ts` passes unmodified |
| 2 | Web unit tests | `pnpm --filter web exec vitest run src/features/photos/bundle.test.ts src/shell/photo-bundle-section.test.tsx src/shell/settings-route.test.tsx` | every new test in `bundle.test.ts` and `photo-bundle-section.test.tsx` passes; `settings-route.test.tsx` passes unmodified |
| 3 | e2e | `pnpm --filter web exec playwright test -c e2e/playwright.config.ts e2e/photo-bundle.spec.ts` | passes on `desktop-chromium` and `phone-chromium`; other projects skip with `Photo bundle import in Settings runs on one desktop and one phone engine` |
| 4 | GUI capture | `pnpm --filter web run gui:capture` | exits 0; `apps/web/gui-artifacts/photo-bundle/` has `preview`, `compare`, and `done` PNGs for `desktop-chromium` and `phone-chromium` |
| 5 | Mutation | in a disposable worktree at the candidate, change `matchBundlePortraits` in `apps/web/src/features/photos/bundle.ts` so `duplicateName: true` returns `kind: 'matched'` instead of `'ambiguous'`, then run check 2 | `marks duplicateName entries from the manifest as ambiguous even when the ward has one member with that name` and `requires confirmation for a duplicateName portrait before importing` fail; remove the worktree |
| 6 | Existing tests untouched | `git diff --diff-filter=MD --name-only origin/main...HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.capture.ts'` | prints nothing |
| 7 | Scope | `git diff --name-only origin/main...HEAD` | only paths listed under May change |
| 8 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write

### `apps/server/test/photos/bundle.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `refuses unauthenticated and revoked requests on POST /api/photos/bundle` | unauthenticated gets 401; revoked user gets 403 | auth or access check bypassed |
| `allows both Editor and Admin to upload a valid photo bundle` | an Editor and an Admin can both POST a valid bundle (PNG and JPEG), storing sanitized portraits in `PhotoStore` and returning `photoRef`s | route restricted to Admin only |
| `refuses missing or foreign Origin on POST /api/photos/bundle` | missing Origin and `https://evil.example` both get 403 `forbidden` | missing CSRF origin check |
| `refuses non-POST methods on /api/photos/bundle with 405` | `GET /api/photos/bundle` returns 405 with `Allow: POST` | falls through to `photos.read('bundle')` 404 |
| `refuses an oversized bundle with 413` | declared or streamed body over `MAX_BUNDLE_BYTES` returns 413 `too_large` | no size limit |
| `rejects invalid manifest, hash mismatch, or corrupt image without storing any photo` | wrong `format`/`version`, path-traversal filename, SHA-256 mismatch between filename and bytes, missing file entry, or corrupt PNG bytes all return 400 `invalid_bundle` and leave `PhotoStore` untouched | partial write before validation finishes |

### `apps/web/src/features/photos/bundle.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `matches unique active ward members case-insensitively and ignores removed members` | `matchBundlePortraits` matches a unique active member, ignores a removed member with the same name, and marks unknown names `unmatched` | removed member matched or case mismatch |
| `marks duplicateName entries from the manifest as ambiguous even when the ward has one member with that name` | a portrait with `duplicateName: true` or two portraits sharing a name produce `kind: 'ambiguous'` | `duplicateName` flag ignored |
| `marks multiple active ward members with the same name as ambiguous with all candidates` | when two active ward members share a normalized name, `kind: 'ambiguous'` lists both in `candidates` | silent first-match merge |
| `resolveBundleSelections rejects unresolved or duplicate targets and preserves order when valid` | unresolved ambiguous rows return `unresolved`, two rows targeting the same `memberId` return `duplicate_target`, and valid selections + `'skip'` return `incoming` in portrait order | duplicate target allowed or `'skip'` included |
| `readBundleFiles requires manifest.json and every referenced portrait file` | missing `manifest.json` or missing `<sha>.png` returns `{ ok: false }` with the user-facing message; complete files return `{ ok: true }` with base64-encoded files | missing portrait sent to server |

### `apps/web/src/shell/photo-bundle-section.test.tsx`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `renders Directory photos section in Settings for both Editor and Admin` | `SettingsRoute` renders the `Directory photos` heading and `Photo bundle files` input for an Editor as well as an Admin | section gated behind `isAdmin` |
| `requires confirmation for a duplicateName portrait before importing` | an ambiguous row keeps `Import photos` disabled until the user clicks `Assign to {name}` or `Skip` | `Import photos` enabled before confirmation |
| `applies first photos immediately and steps through replacements with PhotoBatchReview` | a bundle with one member who has no photo and one member who already has a photo calls `updateMember` immediately for the first photo, opens `PhotoBatchReview` (`Directory import`, household skipped banner) for the replacement, and calls `updateMember` for the replacement only when `Use New Photo` is clicked, then shows the cleanup command | first photo shown in comparison dialog, or replacement applied without comparison, or cleanup command missing |
| `shows an alert when the bundle files are incomplete or the server rejects the bundle` | missing `manifest.json` or a server failure (`invalid_bundle`, `offline`) renders `role="alert"` and allows recovery | silent failure |

## Edge cases (each needs a test)
- Unauthenticated (401), revoked (403), missing/foreign Origin (403), non-POST (405), oversized payload (413).
- Bundle with corrupt image bytes or filename SHA-256 mismatch (400, zero photos written).
- Removed ward member sharing a name with an active member (ignored so the active member matches).
- `duplicateName: true` in manifest or two active ward members sharing a name (requires explicit user confirmation; cannot assign two portraits to the same member).
- Bundle with `skippedHousehold > 0` (surfaced in the match preview and in `PhotoBatchReview`).
- Bundle with a mix of first-time photos (`photoRef === null`), replacement photos (`photoRef !== null`), and unmatched names.

## e2e (`apps/web/e2e/photo-bundle.spec.ts`)
Runs on `desktop-chromium` and `phone-chromium`. Use two fictional ward members not asserted by any other photo spec (`Vera Testwell` and `Xena Storybook` — grep `e2e/` to confirm neither is used by `person-photo`, `portraits`, or any other spec, and start a dedicated `startCheckoutServer()` as `import-settings.spec.ts` does so the spec is completely isolated).
- Sign in, give one member an initial photo so they already have a portrait, then open `/settings`, select a generated valid bundle (`manifest.json` + PNG files: one first-time photo, one replacement photo, plus one `duplicateName: true` entry and `skippedHousehold: 2`), confirm the match preview, click `Import photos`, verify the first photo applied without a dialog, resolve the replacement in the comparison dialog (`Use New Photo`), and verify the completion summary and `--cleanup` command appear and the updated portraits are live on the board.
- Check `expectNoHorizontalOverflow` at phone width.

## GUI verification
Required (`docs/gui-verification.md`). Capture scenario `apps/web/e2e/gui/photo-bundle.capture.ts` (against its own `startCheckoutServer()` so it cannot collide with other scenarios) on `desktop-chromium` and `phone-chromium`, producing:
- `preview-{project}.png`: the `Directory photos` section in `/settings` showing the match preview (matched, needs confirmation, unmatched, household skipped note).
- `compare-{project}.png`: the one-at-a-time replacement comparison (`PhotoBatchReview`) open for the member who already had a photo.
- `done-{project}.png`: the completion status and collector `--cleanup` command card after handoff.
Compare with `docs/design/ui-canvas/Settings.dc.html` and `docs/design/ui-canvas/PhotoCompare.dc.html`. Fail on horizontal overflow at 390px, touch targets under 44px, broken image icons, or overlapping controls.

## Human checks
- None beyond the existing T-060 and T-061 human checks.

## Out of scope
- Updating `docs/import/` and the AI-operator prompt for the shipped collector (that is T-099, which depends on T-098).
- Modifying `tools/collector/`.
