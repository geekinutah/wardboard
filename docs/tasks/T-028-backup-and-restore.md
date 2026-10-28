# T-028: Backup and restore

**Milestone:** 3 — Server and collaboration
**Depends on:** T-005 (schema and migrations), T-022 (roles), T-024 (channel), T-027 (photo storage and `/api/photos` routes in `server.ts`). T-027 must be `done` before this task is delegated, and this contract binds to T-027's photo layout as written there.

**Spec refs:**
- SPEC.md §10:
  - Backups capture a consistent SQLite snapshot, the referenced photos, and the necessary settings.
  - Never copy a live database file unsafely.
  - Restore validates the archive and completes atomically, or preserves the previous working state.
- SPEC.md §9: backups carry the same confidentiality as the live app, and all data requires authenticated access.
- SPEC.md §12: restoring reproduces people, photos, slots, Current, proposals, and approved local context.
- AGENTS.md § Security rules:
  - Every route has an unauthenticated/revoked test.
  - Admin-only actions have an Editor-refused test.

## Goal
An Admin can download a full backup as one archive. An Admin can upload a backup:
- in **dry-run** mode, to get a validation summary;
- in apply mode, to restore it.

A restore either fully replaces the data or changes nothing. After a restore, every WebSocket client is disconnected so it reconnects and resynchronizes.

## Design decisions (binding)

### Archive format (`apps/server/src/backup/`)
- The archive is a POSIX **ustar** tar, uncompressed. Write and read it with hand-written code using only Node built-ins. No new dependencies.
- It contains exactly these regular-file entries, in this order:
  1. `manifest.json`:
     ```json
     { "format": "wardboard-backup", "formatVersion": 1, "createdAt": "<ISO>", "schemaVersion": <highest applied migration id>, "photos": [ { "ref": "<photoRef>", "size": <bytes> } ] }
     ```
     The `photos` list is sorted by `ref`.
  2. `wardboard.sqlite`: a consistent snapshot made with `VACUUM INTO` on a temporary path. The live database file and its WAL are never copied.
  3. `photos/<ref>`: one entry for each file in `<dataDir>/photos/` whose name matches T-027's ref regex `^[0-9a-f]{64}\.(jpg|png)$`. Temporary `.tmp-` files and other names are skipped.
- Settings live in the `settings` table, so they are inside the snapshot.
- The reader rejects the archive with `invalid_archive` if any of these is true:
  - an entry is not a regular file, or there is a directory, symlink, or hardlink entry;
  - a name contains `..`, starts with `/`, or is not one of the allowed names;
  - an entry is duplicated;
  - an entry runs past the end of the input, or a header checksum is wrong;
  - `manifest.json` is not first, or the manifest does not match its schema;
  - the manifest photo list does not match the `photos/` entries exactly (same refs and sizes);
  - a photo's sha256 does not equal its ref's hex.

### Validation of the snapshot (dry-run and apply)
After the archive is read, the snapshot is written to a staging file inside `<dataDir>` (prefix `.restore-`) and opened. Each failed check returns its own error code:
- `PRAGMA integrity_check` returns `ok`. Otherwise → `corrupt_database`.
- `max(schema_migrations.id)` equals both the manifest `schemaVersion` and this server's highest migration id. Otherwise → `incompatible_schema`.
- Every non-null `members.photo_ref` is in the archive's photo list. Otherwise → `missing_photo`.
- At least one user has `role = 'admin'` and `revoked_at IS NULL`. Otherwise → `no_admin`, so a restore can never lock everyone out.

On success, the summary is `{ createdAt, schemaVersion, members, proposals, users, photos, hasCurrent }`, with counts read from the staged database.

The staging file and any temporary files are always deleted, on success, failure, or a thrown error.

### Applying a restore (atomic)
1. Validate as above. On any failure, nothing has changed.
2. Copy each archive photo into `<dataDir>/photos/` using T-027's write-temp-then-rename approach. Photos are content-addressed, so this is additive and harmless if a later step fails. Existing photo files are never deleted (orphan cleanup is SPEC §8 OPEN).
3. In the **live** database, `ATTACH` the staged file. Then, in one `BEGIN IMMEDIATE` transaction, delete every row from every application table and insert every row from the attached copy. Use the table list from `sqlite_master`, excluding `sqlite_%`. Order the work so foreign keys hold at commit, using `PRAGMA defer_foreign_keys = ON`. Then `COMMIT`, then `DETACH`.
4. If anything fails, roll back. The live database is unchanged and the request fails with `restore_failed`.
5. After a successful commit, the server calls `channel.closeAll(4000)`. Every WebSocket client is closed and must reconnect and resubscribe. A client never keeps a pre-restore board.

### HTTP routes (wired in `apps/server/src/server.ts`; Admin only)
- Routes are dispatched after the existing identity (401) and access (403) gate.
- An authenticated **Editor** gets `403 {"error":"forbidden"}`.
- `GET /api/admin/backup` → `200`. Headers:
  - `content-type: application/x-tar`;
  - `content-disposition: attachment; filename="wardboard-backup-<YYYYMMDD-HHMMSS>.tar"`, with the time from the injected clock in UTC;
  - `cache-control: no-store`.
- `POST /api/admin/restore?mode=dry-run` and `POST /api/admin/restore?mode=apply`:
  - **Origin check:** the same rule as `POST /api/photos` in T-027. Otherwise → `403`.
  - The body is the raw tar. It is streamed to a staging file in `<dataDir>`, with a cap of `MAX_BACKUP_BYTES = 1024 * 1024 * 1024`. Exceeding the cap → `413 {"error":"too_large"}`, and the staging file is deleted.
  - Success → `200 {"summary": {...}}` for dry-run, or `200 {"restored": true, "summary": {...}}` for apply.
  - Validation failure → `422 {"error":"<code>"}`.
  - A missing or other `mode` → `400 {"error":"bad_request"}`.
- Any other method → `405` with an `allow` header.
- Never log archive contents, member data, or file names of photos.

### Channel
Add `closeAll(code: number): void` to `OperationChannel`. It closes every open connection with that code and leaves the server accepting new connections. No other channel behavior changes.

## Scope
May change:
- `apps/server/src/backup/**` (new)
- `apps/server/src/server.ts` (routes and wiring only)
- `apps/server/src/ws/channel.ts` (`closeAll` only)
- `apps/server/src/index.ts` (exports only)
- `apps/server/test/backup/**` (new)

Must not change:
- `apps/server/src/photos/**`, `apps/server/src/store/**`, `apps/server/src/db/**`, `packages/**`, `apps/web/**`, `docker/**`, and existing tests.

New dependencies allowed: none.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Tar reader/writer | `pnpm --filter @wardboard/server exec vitest run test/backup/tar.test.ts` | every `tar.test.ts` test in the table passes |
| 2 | Backup, validation, and restore (real SQLite in temp dirs) | `pnpm --filter @wardboard/server exec vitest run test/backup/backup.test.ts` | every `backup.test.ts` test passes |
| 3 | HTTP routes (real server, ephemeral port, fixture identity) | `pnpm --filter @wardboard/server exec vitest run test/backup/routes.test.ts` | every `routes.test.ts` test passes |
| 4 | Existing tests unchanged and green | `pnpm --filter @wardboard/server test` | exits 0 |
| 5 | No dependency change | `git diff main --stat -- apps/server/package.json pnpm-lock.yaml` | empty output |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
Data is the fictional fixture ward plus synthetic photo bytes stored through T-027's `createPhotoStore`.

| File / test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `tar.test.ts` › `round-trips entries byte-for-byte including a 0-byte file and a file whose size is a multiple of 512` | ustar framing and padding | wrong padding; size octal errors |
| `tar.test.ts` › `rejects directory, symlink and hardlink entries, ../ and absolute names, duplicates, bad checksum, truncated entry` → `invalid_archive` | archive safety | path traversal; trusting the header type |
| `backup.test.ts` › `backup → restore into a fresh data dir reproduces members, tags, users, settings, Current, every proposal (status, accepted summary, approvals) and photo bytes` | SPEC §12 full round trip | missing a table; missing photos |
| `backup.test.ts` › `backup taken while a write transaction is open in another connection is consistent and excludes the uncommitted row` | consistent snapshot, not a file copy | copying the live file |
| `backup.test.ts` › `backup skips .tmp- and non-ref files in photos/` | photo selection | backing up partial temp files |
| `backup.test.ts` › `dry-run returns the summary and changes nothing (row counts and data identical before/after)` | dry-run is read-only | applying during dry-run |
| `backup.test.ts` › `each validation failure leaves the live database byte-identical in content and returns its code`: corrupt_database, incompatible_schema (newer and older), missing_photo, no_admin, photo sha mismatch → invalid_archive | validation-before-apply | partial application |
| `backup.test.ts` › `a failure injected after delete and before commit rolls back; live data unchanged → restore_failed` (injected through a test seam such as a hook option, not by editing the DB) | atomicity | non-transactional replace |
| `backup.test.ts` › `staging files are removed after success, failure and thrown error` | no leftover copies (SPEC §9) | leaking `.restore-` files |
| `routes.test.ts` › `unauthenticated → 401 and revoked → 403 on backup and restore` | security rule | dispatch before the gate |
| `routes.test.ts` › `Editor → 403 on backup and on restore (dry-run and apply)` | admin-only | missing role check |
| `routes.test.ts` › `Admin download has tar content type, attachment filename from clock, no-store` | headers | caching backups |
| `routes.test.ts` › `restore with foreign or missing Origin → 403 and nothing changes` | CSRF | no Origin check |
| `routes.test.ts` › `restore over MAX_BACKUP_BYTES → 413 and no staging file left` | size cap | buffering everything |
| `routes.test.ts` › `invalid archive → 422 with code; missing mode → 400; PUT → 405` | error mapping | 500 on bad input |
| `routes.test.ts` › `apply closes every open WebSocket with code 4000; a new connection afterwards sees restored data` | client resync | stale clients keep old boards |

`MAX_BACKUP_BYTES` may be injected as a lower value for the 413 test through a test-only option. The default must stay 1 GiB.

## Edge cases (each needs a test)
- An empty `photos/` directory, and a missing `photos/` directory.
- A database with no Current, which gives `hasCurrent: false`.
- A restore that would leave no active admin.
- Schema versions both older and newer than the server.
- Unauthenticated, revoked, and Editor sessions on every route.

## Human checks
- On the Mac Studio after T-063: download a backup from the running container, restore it into a fresh data volume, and confirm the board and photos look right. This is already part of the pending T-063 drill.

## Out of scope
- Backup scheduling and retention (SPEC §9 OPEN), encryption, and compression.
- Restoring archives from older schema versions by migrating them.
- Orphan photo cleanup.
- The settings UI (T-046).
