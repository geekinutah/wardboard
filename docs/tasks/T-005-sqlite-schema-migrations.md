# T-005: SQLite schema and migrations

**Milestone:** 1 — Foundations
**Depends on:** T-002
**Spec refs:** SPEC.md §7 (logical data model, independent roster structures, shared member profile), §8 (`removed_date`, no Church identifiers), §9 (no contact details or birth dates stored), §10 (SQLite, backup needs consistent snapshots); §15 (allow-listed fields only)

## Goal
`apps/server/src/db/` opens a SQLite database with Node's built-in `node:sqlite`, applies an ordered list of migrations exactly once each, and the first migration creates tables for the SPEC §7 model with constraints that enforce its key invariants (board-owned structures, one occupant per position, foreign keys, no disallowed member fields).

## Design decisions (binding for this task)
- **Driver**: `node:sqlite` (`DatabaseSync`). No native addon dependency. `openDatabase(path)` enables `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`, and returns the handle. `:memory:` is accepted for tests that don't need a file.
- **Migrations**: `src/db/migrations/NNN-name.ts` files, each exporting `{ id: number, name: string, up: string }` (SQL), collected in an ordered array in `src/db/migrations/index.ts`. `migrate(db, migrations = all)`:
  - creates `schema_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)` if missing;
  - applies each pending migration inside its own transaction together with its `schema_migrations` row; a failing migration rolls back fully and `migrate` throws naming the migration;
  - is idempotent (a second call applies nothing);
  - refuses (throws, changes nothing) when the database records a migration id the code does not know (downgrade protection) or when the array is not strictly increasing;
  - takes the applied-at time from an injectable clock (default `() => new Date()`).
- **Migration 001** creates (names may be adjusted for clarity; the invariants may not):
  - `members` — local id, `name`, `photo_ref` (nullable), `category` (`adult` | `youth`, CHECK), `note` (nullable, ≤ 280 chars CHECK), `needs_approval` (0/1), `removed_date` (nullable ISO date), timestamps. **No** columns for email, phone, address, birth date/age, gender, record number, or any Church identifier.
  - `tags`, `member_tags` (member ↔ tag, unique pair; cascade on delete of either).
  - `external_callings` — member id, unit, title.
  - `boards` — id, `kind` (`current` | `proposal` | `baseline`, CHECK), `name`, `status` (`draft` | `accepted`, nullable for non-proposals), `rationale`, `version` (integer ≥ 0), `tab_order`, `accepted_by`, `accepted_at`, `accepted_summary`, `baseline_board_id` (proposal → its baseline snapshot board), `import_version`, timestamps. At most one `current` board (partial unique index).
  - Board-owned structures, each with `board_id` (cascade delete with the board): `board_groups` (name, order, visible), `calling_groups` (board group or parent calling group, name, order), `calling_assignments` (group, title, `type` `single`|`list` CHECK, order, enabled, prominence, `origin` `standard`|`custom` CHECK), `positions` (assignment, `lineage_id`, order), `placements` (position, member), `oversight` (bishopric position → target group/organization, `fixed` flag), `calling_tags`, `calling_affinities` (assignment ↔ tag), `dugout_inclusions` (board, member; unique pair), `approvals` (board, member, position, approver user, approved_at).
  - `placements` has a UNIQUE constraint on `position_id` (one occupant per position; list assignments expose multiple positions).
  - `users` (login unique, display name, `role` `editor`|`admin` CHECK, created/revoked timestamps), `invitations` (login, invited_by, created_at, revoked_at), `settings` (key primary key, JSON value).
- Exports from `src/db/index.ts`: `openDatabase`, `migrate`, `migrations`. Do not wire the database into `startServer` in this task.

## Scope
May change:
- `apps/server/src/db/` (new)
- `apps/server/test/db/` (new)

Must not change:
- other `apps/server/src/**` files, `apps/server/package.json` (unless a test script glob genuinely requires it — report if so), `packages/**`, `apps/web/**`, `scripts/**`, `docs/**`, anything else

New dependencies allowed: none (`node:sqlite` is built in).

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Migration runner tests | `pnpm --filter server test -- migrate` | all tests in `test/db/migrate.test.ts` pass |
| 2 | Schema invariant tests | `pnpm --filter server test -- schema` | all tests in `test/db/schema.test.ts` pass |
| 3 | Typecheck and lint | `pnpm --filter server typecheck && pnpm --filter server lint` | exit 0 |
| 4 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
All tests use a real SQLite file in a temp directory (or `:memory:` where noted), never a mock.

| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `migrate applies all migrations to an empty database` | after `migrate`, `schema_migrations` lists every id and the tables exist | runner skips migrations |
| `migrate is idempotent` | second call applies nothing; row count unchanged; data inserted between calls survives | re-runs `up` |
| `migrate records applied_at from the injected clock` | fixed clock → that ISO timestamp stored | uses real time |
| `a failing migration rolls back completely` | a test migration that creates a table then runs invalid SQL → throws naming it, table absent, no `schema_migrations` row | no transaction |
| `migrate refuses an unknown applied migration` | DB with id 999 recorded → throws, nothing applied | ignores downgrade |
| `migrate refuses a non-increasing migration list` | ids `[1, 1]` or `[2, 1]` → throws before applying | silent misorder |
| `openDatabase enables foreign keys and WAL` | `PRAGMA foreign_keys` = 1, `journal_mode` = `wal` on a file DB | pragmas missing |
| `members table has no disallowed columns` | `PRAGMA table_info(members)` contains no column matching `/email|phone|address|birth|age|gender|record|mrn|church_id/i` | someone adds `birth_date` |
| `a position holds at most one placement` | second placement on the same position → constraint error | missing UNIQUE |
| `a member may hold several different positions` | two placements for one member on different positions succeed | over-restrictive unique |
| `deleting a board cascades to its structures only` | delete proposal A → its groups/assignments/positions/placements gone; Current and proposal B rows untouched | missing `board_id` cascade or cross-board FK |
| `only one current board` | inserting a second `kind='current'` board fails | partial unique index missing |
| `assignment type and origin are constrained` | `type='triple'` or `origin='x'` rejected | missing CHECK |
| `member note length is bounded` | 281-char note rejected, 280 accepted | missing CHECK |
| `foreign keys are enforced` | placement referencing a missing member fails | FK off |
| `dugout inclusion is unique per board and member` | duplicate insert fails | missing unique |

## Edge cases (each needs a test)
- Empty database (fresh file) and already-migrated database.
- Failing migration mid-list.
- Boundary note length 280 / 281.

## Human checks
none

## Out of scope
- Repositories/load/save logic (T-023), import (T-058), backup (T-028).
- Wiring the DB into the server startup.
