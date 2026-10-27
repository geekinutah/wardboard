# T-027: Photo storage

**Milestone:** 3 — Server and collaboration
**Depends on:** T-002 (server skeleton), T-021 (identity gate), T-022 (access gate). All `done`.
- Runs alongside T-025 and T-034. Its only shared file is `apps/server/src/server.ts` (HTTP route dispatch). T-025 does not touch that file.
- T-028 (backup) depends on this task and runs after it merges.

**Spec refs:**
- SPEC.md §6 and §7: a member has an optional photo. `Member.photoRef` is `string | null` in core.
- SPEC.md §9: all data and photos require authenticated access. Do not keep source contents beyond approved processing.
- SPEC.md §10: photos live on local persistent storage. There is a single configurable data directory.
- SPEC.md §8 and §15: direct member-photo upload is a supported input route.
- AGENTS.md § Security rules: every HTTP route has a test proving an unauthenticated or revoked session is refused.

## Goal
Signed-in users can upload a JPEG or PNG with `POST /api/photos` and get back a content-addressed `photoRef`. Before the image is stored, the server validates its structure and type, enforces a size limit, and removes embedded metadata such as EXIF/GPS and text chunks. Stored photos are served only to signed-in users from `GET /api/photos/<photoRef>`. Linking a photo to a member is not part of this task.

## Design decisions (binding)

### Module: `apps/server/src/photos/`
No new dependencies. Use only Node built-ins (`node:crypto`, `node:fs/promises`, `node:path`).

- `sanitizePhoto(bytes: Uint8Array, contentType: string): { ok: true; bytes: Uint8Array; ext: 'jpg' | 'png' } | { ok: false; code: 'unsupported_type' | 'invalid_image' }`. This is a pure function.
  - `contentType` is compared case-insensitively after removing any `;` parameters. Only `image/jpeg` and `image/png` are accepted. Anything else returns `unsupported_type`.
  - The bytes must match the declared type. If the signature does not match (for example a PNG sent as `image/jpeg`), return `invalid_image`.
  - **JPEG** rules:
    - Must start with `FF D8`.
    - Walk the marker segments up to Start of Scan (`FF DA`), using each segment's 2-byte big-endian length.
    - Drop APP1 (`FF E1`: EXIF/XMP), APP13 (`FF ED`: IPTC/Photoshop) and COM (`FF FE`). Keep every other segment unchanged, including APP0 and APP2 (ICC).
    - From `FF DA` to the end, copy the bytes verbatim.
    - The input must end with `FF D9`.
    - Return `invalid_image` if any of these is true:
      - a segment length runs past the end of the input;
      - a byte where a marker should be is not `FF`;
      - there is no `FF DA`;
      - the input does not end with `FF D9`.
  - **PNG** rules:
    - Must start with the 8-byte signature `89 50 4E 47 0D 0A 1A 0A`.
    - Walk the chunks (4-byte length, 4-byte type, data, 4-byte CRC). The first chunk must be `IHDR` and the last must be `IEND`, with nothing after `IEND`.
    - Drop `tEXt`, `zTXt`, `iTXt`, `eXIf` and `tIME`. Keep every other chunk unchanged.
    - CRCs are not recomputed, because kept chunks are copied byte-for-byte. CRC validation is not required.
    - Return `invalid_image` if a chunk length runs past the end of the input or if the first or last chunk is wrong.
  - Empty input returns `invalid_image`.
- `MAX_PHOTO_BYTES = 5 * 1024 * 1024` (5,242,880). This applies to the uploaded request body, before sanitizing.
- `createPhotoStore(dataDir: string)` returns `{ put(bytes, ext): Promise<string>; read(ref: string): Promise<{ bytes: Buffer; contentType: string } | null> }`.
  - The directory is `path.join(dataDir, 'photos')`. Create it on first `put`.
  - `photoRef` is `<lowercase sha256 hex of the sanitized bytes>.<ext>`. Uploading the same image twice returns the same ref and leaves exactly one file.
  - `put` writes to a temporary file in the same directory (name starting with `.tmp-`), then calls `rename` to move it into place. A crash can never leave a partial file under a valid ref.
  - `read` first checks `ref` against `/^[0-9a-f]{64}\.(jpg|png)$/`. A ref that does not match returns `null` without touching the filesystem. This blocks path traversal. A matching ref with no file also returns `null`.

### HTTP routes (wired in `apps/server/src/server.ts`)
Both routes are dispatched **after** the existing identity (401) and access (403) gate in `handleRequest`, so the T-021/T-022 refusals apply unchanged.

- `POST /api/photos`
  - **Origin check (CSRF):** the `Origin` header must equal `new URL(config.baseUrl).origin` or the server's own listen origin. If it is missing or different, return `403 {"error":"forbidden"}`. Tailscale adds identity headers to any request from the user's device, including requests made by a malicious page. This is the same reasoning as T-024's WebSocket origin check.
  - The body is the raw image bytes, and `Content-Type` is the image type.
  - Read the body as a stream. As soon as the received bytes exceed `MAX_PHOTO_BYTES`, stop reading and respond `413 {"error":"too_large"}` with `connection: close`. A `Content-Length` header over the limit gets `413` before any of the body is read.
  - On success, respond `201 {"photoRef":"<ref>"}`.
  - `unsupported_type` → `415 {"error":"unsupported_type"}`. `invalid_image` → `400 {"error":"invalid_image"}`.
- `GET` / `HEAD /api/photos/<ref>`:
  - `200` with the bytes. Headers:
    - `content-type: image/jpeg|image/png`;
    - `x-content-type-options: nosniff`;
    - `cross-origin-resource-policy: same-origin`;
    - `cache-control: private, max-age=31536000, immutable`.
  - A malformed or unknown ref → `404 {"error":"not_found"}`.
- Any other method on `/api/photos` or `/api/photos/<ref>` → `405` with an `allow` header.
- Editors and Admins may both upload and read (SPEC §7: photos are shared member data that any Editor edits).
- Never log request bodies, image bytes or file paths with refs.

## Scope
May change:
- `apps/server/src/photos/**` (new)
- `apps/server/src/server.ts` (route dispatch for `/api/photos` and passing the listen origin; nothing else)
- `apps/server/src/index.ts` (export the photos module only)
- `apps/server/test/photos/**` (new)

Must not change:
- Anything else. In particular: `apps/server/src/ws/**`, `apps/server/src/store/**`, `apps/server/src/db/**`, `packages/**`, `apps/web/**`, existing tests.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Sanitizer unit tests | `pnpm --filter @wardboard/server exec vitest run test/photos/sanitize.test.ts` | every test in the table below for `sanitize.test.ts` passes |
| 2 | Store unit tests | `pnpm --filter @wardboard/server exec vitest run test/photos/store.test.ts` | every test in the table below for `store.test.ts` passes |
| 3 | HTTP route tests (real server on an ephemeral port, fixture identity provider, real SQLite in a temp dir) | `pnpm --filter @wardboard/server exec vitest run test/photos/routes.test.ts` | every test in the table below for `routes.test.ts` passes |
| 4 | Existing server tests unchanged and green | `pnpm --filter @wardboard/server test` | exits 0 |
| 5 | No new dependencies | `git diff main -- apps/server/package.json pnpm-lock.yaml` | empty output |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Fixtures are synthetic byte arrays built in test code: structurally valid JPEG and PNG streams with fictional canary metadata (for example the ASCII string `CANARY-GPS-40.7N` inside an APP1 segment or a `tEXt` chunk). No real photos.

| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `sanitize.test.ts` › `strips APP1, APP13 and COM from a JPEG and keeps APP0, APP2 and scan data` | metadata removal plus preservation | stripping nothing; dropping APP2/ICC; truncating after SOS |
| `sanitize.test.ts` › `output contains no canary bytes from removed JPEG segments` | EXIF/GPS cannot reach storage | removing only the first APP1 when there are two |
| `sanitize.test.ts` › `strips tEXt, zTXt, iTXt, eXIf and tIME from a PNG and keeps IHDR, IDAT, IEND in order` | PNG metadata removal | allow-list typo; reordering chunks |
| `sanitize.test.ts` › `rejects type mismatch` (PNG bytes as `image/jpeg`, JPEG bytes as `image/png`) | content-type must match signature | trusting the header |
| `sanitize.test.ts` › `rejects unsupported types` (`image/gif`, `image/svg+xml`, `text/html`, empty) → `unsupported_type` | type allow-list | accepting SVG (script vector) |
| `sanitize.test.ts` › `accepts content type case-insensitively with parameters` (`Image/JPEG; charset=binary`) | header normalization | exact-string compare |
| `sanitize.test.ts` › `rejects malformed images` (empty; JPEG segment length past end; JPEG missing SOS; JPEG missing EOI; PNG IHDR not first; PNG trailing bytes after IEND; PNG chunk length past end) → `invalid_image` | structural validation | unchecked length read; missing end check |
| `store.test.ts` › `put returns sha256-hex.ext and read returns identical bytes and content type` | content addressing | random names; wrong content type |
| `store.test.ts` › `same bytes twice → same ref, one file, no .tmp- leftovers` | idempotent atomic write | leftover temp files; duplicate files |
| `store.test.ts` › `read rejects traversal and malformed refs without filesystem access` (`../x`, `ABC…`, `<64hex>.gif`, `<64hex>.jpg/../x`) → `null` | path traversal blocked | joining unvalidated ref |
| `store.test.ts` › `read of a well-formed unknown ref → null` | missing file handled | throwing ENOENT |
| `routes.test.ts` › `unauthenticated POST and GET → 401` | auth gate | dispatching before the gate |
| `routes.test.ts` › `revoked user POST and GET → 403` | access gate | skipping `access.resolve` |
| `routes.test.ts` › `Editor uploads, then reads back the sanitized bytes with the required headers` | end to end + headers | missing nosniff/CORP; returning unsanitized bytes |
| `routes.test.ts` › `POST with foreign or missing Origin → 403 and nothing stored` | CSRF check | no Origin check |
| `routes.test.ts` › `POST over MAX_PHOTO_BYTES → 413 and nothing stored` (both with an over-limit Content-Length and with a chunked body that exceeds it) | size limit | buffering entire body; only checking Content-Length |
| `routes.test.ts` › `POST unsupported type → 415; malformed image → 400` | error mapping | 500 on bad input |
| `routes.test.ts` › `GET unknown or malformed ref → 404; HEAD returns headers without body` | 404 and HEAD | 500 / body on HEAD |
| `routes.test.ts` › `PUT/DELETE on photo paths → 405 with allow` | method handling | falling through to web |

## Edge cases (each needs a test)
- Empty body.
- Exactly `MAX_PHOTO_BYTES` accepted (where it otherwise validates); one byte over refused.
- Two metadata segments of the same kind.
- Malformed refs (traversal, uppercase hex, wrong extension).
- Unauthenticated, revoked, and Editor (non-admin) sessions.

## Human checks
none

## Out of scope
- Linking a photo to a member (`photoRef` on the member). That belongs to T-026 and T-060.
- Resizing, re-encoding, thumbnails, and orphan cleanup (SPEC §8 OPEN).
- Backup of photos (T-028), the upload UI (T-060), and the collector (T-061).
- Any change to `ws/`, `store/`, `db/`, or core.
