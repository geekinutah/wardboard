# T-023: Board persistence

**Milestone:** 3 — Server and collaboration
**Depends on:** T-005 (done), T-007 (done). Can run alongside T-022 and T-018. Its scope overlaps theirs only at the one-line export in `apps/server/src/index.ts`, which the controller resolves at merge.
**Spec refs:**
- SPEC.md §3: Current is read-only. Starting a proposal saves a baseline copy of Current. Duplicating copies the source arrangement and keeps the source's baseline.
- SPEC.md §7: logical data model. Current and each proposal own independent roster structures. Member profile data is ward-wide.
- SPEC.md §8: proposals and their baselines survive replacement of Current. Replacement itself is T-058, not this task.
- SPEC.md §10: the server is authoritative, each board carries a version, and every edit is one SQLite transaction.
- AGENTS.md § Test stack: real SQLite in a temporary directory. No mocks.

## Goal
`apps/server/src/store/` persists the core `Ward`, the Current `Board`, and every `Proposal` (its baseline plus its working board) to SQLite, and reads them back deep-equal to what was written. It can start a proposal from Current or duplicate one. It commits a new proposal board in one transaction only when the caller's expected version matches, and increments the version. Nothing here touches HTTP or WebSockets. T-024 wires this store into the server.

## Design decisions (binding)

### Module API: `apps/server/src/store/index.ts`
```ts
import type { DatabaseSync } from 'node:sqlite';
import type { Board, IdGenerator, Proposal, ProposalId, ProposalStatus, Ward } from '@wardboard/core';

export type StoreClock = () => Date;

export type CurrentRecord = { board: Board; importVersion: string; importedAt: string };

export type ProposalSummary = {
  id: ProposalId; name: string; status: ProposalStatus; tabOrder: number;
  boardId: BoardId; version: number; updatedAt: string;
};

export type StoreError =
  | { code: 'not_found'; message: string }
  | { code: 'not_editable'; message: string }        // Current, a baseline, or an Accepted proposal
  | { code: 'stale'; message: string; currentVersion: number }
  | { code: 'invalid'; message: string }             // input fails core validation (createBoard/createProposal/createWard)
  | { code: 'no_current'; message: string }
  | { code: 'already_initialized'; message: string };

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export function openStore(db: DatabaseSync, clock: StoreClock): Store;   // db is already migrated

export interface Store {
  /** One transaction. Writes ward + Current. Refuses when a Current board already exists. */
  initialize(input: { ward: Ward; current: Board; importVersion: string }): StoreResult<void>;
  loadWard(): Ward;                                   // includes removed members
  loadCurrent(): CurrentRecord | null;
  listProposals(): readonly ProposalSummary[];        // ordered by tabOrder, then id
  loadProposal(id: ProposalId): Proposal | null;
  /** Returns the board with this id (Current, any baseline, or any proposal board), or null. */
  loadBoard(boardId: BoardId): Board | null;
  /** Inserts an already-built Proposal verbatim (fixture seeding and tests). Refuses an existing id (`invalid`). */
  insertProposal(proposal: Proposal): StoreResult<void>;
  createProposal(input: {
    name: string; rationale: string | null;
    source: { kind: 'current' } | { kind: 'proposal'; id: ProposalId };
  }, ids: IdGenerator): StoreResult<Proposal>;
  /** Replaces every board-owned row of `next.id` and sets version = expectedVersion + 1, in one transaction. */
  commitBoard(next: Board, expectedVersion: number): StoreResult<Board>;
}
```
`BoardId` and the other id types come from `@wardboard/core`. The implementer may add internal helpers, but must not change these exported signatures.

### Semantics
- **initialize**: validates `ward` with `createWard` and `current` with `createBoard(current, ward)`. If either fails, it returns `invalid` and writes nothing. `current.kind` must be `'current'` (else `invalid`). The Current row gets `name = 'Current'`, `import_version = importVersion`, and `created_at = updated_at = clock()`. `loadCurrent().importedAt` returns that `created_at`.
- **createProposal from Current**: `id = ids()`. The baseline is a copy of Current with `id: '<id>-baseline'`, `kind: 'baseline'`, `version: 0`. The board is a copy with `id: '<id>-board'`, `kind: 'proposal'`, `version: 0`. Then `status: 'draft'`, `accepted: null`, `tabOrder = (max existing tabOrder) + 1` (or `0` when there are none), and `createdAt = updatedAt = clock().toISOString()`. Name and rationale are validated by core `createProposal` (returns `invalid` on failure). With no Current it returns `no_current`.
- **createProposal duplicating a proposal**: the new board copies `source.board`. The new baseline copies `source.baseline`, as SPEC §3 requires. The same id, kind, version and timestamp rules apply. Duplicating an Accepted proposal produces a Draft. An unknown source returns `not_found`.
- **Copies are independent.** After any commit to one board, every other board loads unchanged.
- **commitBoard** checks in this order:
  1. Board id unknown → `not_found`.
  2. Stored kind is not `proposal`, or the owning proposal is `accepted` → `not_editable`.
  3. Stored version ≠ `expectedVersion` → `stale` with `currentVersion`.
  4. `next.kind !== 'proposal'` → `not_editable`.
  5. `createBoard({ ...next, version: expectedVersion + 1 }, loadWard())` fails → `invalid`.
  6. Otherwise delete and re-insert all board-owned rows, set `boards.version`, and set `boards.updated_at` and the proposal's `updatedAt` to `clock()`. All of this runs inside `BEGIN IMMEDIATE … COMMIT`. Any thrown error (for example an approval whose `approvedBy` is not in `users`) rolls back everything, and the error comes back as `invalid` with the database byte-for-byte unchanged.
  7. Return the board as `loadBoard` would now return it.
- The store never deletes members. Ward edits (T-026) and import replacement (T-058) are not part of this task.

### Row-id scoping (needed because 001's primary keys are global)
Core ids for board-owned entities are unique only within a board. Fixture proposals reuse their baseline's ids (see B-021). The store therefore writes each board-owned row id as `<boardId>:<coreId>` for board groups, calling groups, assignments and positions, and strips that exact prefix on load. Other row ids:
- Placements: `<boardId>:<positionId>`.
- Oversight: `<boardId>:oversight:<index>`.
- Approvals: `<boardId>:approval:<index>`.
- External callings: `<memberId>:external:<index>`.

Lineage ids, member ids, tag ids and board ids are stored unprefixed.

### Migration `002-board-persistence` (`apps/server/src/db/migrations/002-board-persistence.ts`, registered in `migrations/index.ts`)
Constraints that keep the existing tests unchanged:
- `test/db/migrate.test.ts` asserts the exact table list, so the migration must **not create or drop any table name**. The one rebuild below renames back to `oversight`.
- `test/db/schema.test.ts` inserts rows without the new columns, so every new column must be nullable or have a default.

Changes:
- `boards`: add `proposal_id TEXT`, plus `CREATE UNIQUE INDEX boards_proposal_id ON boards (proposal_id) WHERE proposal_id IS NOT NULL`.
- `board_groups`: add `group_key TEXT`.
- `calling_groups`: add `kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('presidency','bishopric','quorum','class','committee','other'))` and `group_key TEXT`.
- `calling_assignments`: add `leadership_role TEXT CHECK (leadership_role IS NULL OR leadership_role IN ('president','counselor','secretary'))`.
- `member_tags`, `external_callings`, `calling_tags`, `calling_affinities`, `dugout_inclusions`: each adds `sort_order INTEGER NOT NULL DEFAULT 0`.
- `oversight`: rebuild via create-new, copy, drop, rename (the table name `oversight` survives). Keep every existing column and foreign key, with these changes:
  - `position_id` becomes nullable.
  - Add `overseer TEXT CHECK (overseer IS NULL OR overseer IN ('bishop','first_counselor','second_counselor'))`.
  - Add `sort_order INTEGER NOT NULL DEFAULT 0`.
  - Add table check `CHECK (position_id IS NOT NULL OR overseer IS NOT NULL)`.
  - Existing rows are copied, with `overseer` NULL.
  - The store writes `overseer` and leaves `position_id` NULL.

### Field mapping (core ↔ row)
| Core | Row |
|---|---|
| `Member.tagIds` (ordered) | `member_tags` with `sort_order` = index |
| `Member.externalCallings` | `external_callings` with `sort_order` |
| `Member.needsApproval` | `needs_approval` 0/1 |
| `BoardGroup.key` | `board_groups.group_key` |
| `CallingGroup.kind` / `.key` | `calling_groups.kind` / `.group_key` |
| `CallingGroup.parent` | `board_group_id` xor `parent_calling_group_id` (both prefixed) |
| `CallingAssignment.prominent` | `prominence` 1/0 |
| `CallingAssignment.enabled` | `enabled` 1/0 |
| `CallingAssignment.leadershipRole` | `leadership_role` |
| `callingTagIds` / `preferredMemberTagIds` | `calling_tags` / `calling_affinities` with `sort_order` |
| `Board.placements[positionId] = memberId` | `placements` row; `assignment_id` taken from the position |
| `Board.oversight[i]` | `oversight` row with `overseer`, target, `fixed`, `sort_order = i` |
| `Board.dugoutInclusions[i]` | `dugout_inclusions` with `sort_order = i` |
| `Board.approvals[i]` | `approvals` with `approver_user_id = approvedBy`, `approved_at` |
| `Proposal` | proposal `boards` row (`id = board.id`, `proposal_id`, name, status, rationale, tab_order, accepted_*, `baseline_board_id = baseline.id`, created_at/updated_at = the proposal's) plus a baseline `boards` row (`name = '<proposal name> (baseline)'`) |

Every load runs through `createWard`, `createBoard` and `createProposal`, so loaded values are validated and deeply frozen. A row that fails validation throws: a corrupt database is a programming error, not a user error.

### Fixture seed (dev and e2e only; never imported by `apps/server/src/**`)
`apps/server/dev/seed-fixture.ts` exports `seedFixture(store: Store): void`. It writes `buildFixtureWard()` with `importVersion: 'fixture'`, then `insertProposal(buildFixtureProposal(current, ward))`, and throws if either step fails. `apps/server/dev/index.ts` re-exports it. `apps/server/package.json` adds the export `"./dev": "./dev/index.ts"`. `apps/server/src/**` must never import `@wardboard/core/fixtures` or `../dev`: the Docker image leaves out `packages/core/src/fixtures/` (T-066), so such an import would crash the container at start.

## Scope
May change:
- `apps/server/src/store/**` (new)
- `apps/server/src/db/migrations/002-board-persistence.ts` (new), `apps/server/src/db/migrations/index.ts` (one entry)
- `apps/server/src/index.ts` (export lines for the store API only)
- `apps/server/dev/seed-fixture.ts`, `apps/server/dev/index.ts` (new)
- `apps/server/package.json`: add the `@wardboard/core: "workspace:*"` dependency and the `./dev` export
- `apps/server/tsconfig.json`: add `"dev"` to `include`. `apps/server/eslint.config.*` only if `dev/` is not linted otherwise.
- `pnpm-lock.yaml` (workspace link only)
- `apps/server/test/store/**`, `apps/server/test/db/migration-002.test.ts` (new)

Must not change:
- `apps/server/src/server.ts`, `config.ts`, `identity/**`, `db/migrations/001-initial.ts`, `apps/server/test/db/schema.test.ts`, `apps/server/test/db/migrate.test.ts`, `packages/**`, `apps/web/**`, `docker/**`, `scripts/**`, and anything else

New dependencies allowed: `@wardboard/core` (workspace) in `apps/server`. Nothing from npm.

## Acceptance criteria
| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Migration 002 | `pnpm --filter @wardboard/server exec vitest run test/db/migration-002.test.ts` | all pass |
| 2 | Existing schema/migrate tests unchanged and green | `pnpm --filter @wardboard/server exec vitest run test/db` and `git diff origin/main --stat -- apps/server/test/db/schema.test.ts apps/server/test/db/migrate.test.ts` | pass; diff output empty |
| 3 | Round trip | `pnpm --filter @wardboard/server exec vitest run test/store/roundtrip.test.ts` | all pass |
| 4 | Proposals and commits | `pnpm --filter @wardboard/server exec vitest run test/store/proposals.test.ts test/store/commit.test.ts` | all pass |
| 5 | Seed and import isolation | `pnpm --filter @wardboard/server exec vitest run test/store/seed.test.ts` | all pass |
| 6 | No fixture import reachable from src | `grep -rn -e core/fixtures -e "/dev['/]" apps/server/src` | no output (exit 1) |
| 7 | Typecheck and lint | `pnpm -r typecheck && pnpm -r lint` | exit 0 |
| 8 | Quality gate (includes the Docker smoke) | `./scripts/verify.sh` | exits 0 (`verify: all steps passed`) |

## Unit tests to write
All tests use a file database in `mkdtemp` (via `openDatabase` and `migrate`), a fixed clock, and `sequentialIds`.

`test/db/migration-002.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `002 keeps the table list` | table names after migrating equal the 001 list | migration adds/drops a table |
| `002 preserves existing oversight rows` | apply 001 only, insert an oversight row with `position_id`, apply 002 → row survives with `overseer` NULL | rebuild drops data |
| `oversight requires position or overseer` | insert with both NULL → CHECK failure; `overseer='bishop'`, `position_id` NULL → ok; `overseer='pope'` → CHECK failure | missing checks |
| `calling group kind and leadership role are constrained` | invalid `kind` / `leadership_role` rejected; default `kind` is `other` | unconstrained columns |
| `proposal_id is unique when present` | two boards with the same `proposal_id` → UNIQUE failure; two NULLs → ok | non-partial or missing index |

`test/store/roundtrip.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `fixture ward and current round-trip deep-equal` | `initialize(buildFixtureWard())` → `loadWard()` and `loadCurrent().board` `toEqual` the inputs | dropped field, lost ordering, unprefixed/unstripped ids |
| `every mapped field survives` | a ward/board built for the test (via `createWard`/`createBoard`) with: removed member, `needsApproval: true`, two external callings, tags in non-alphabetical order, a hidden board group with `key`, nested calling group with `kind`/`key`, disabled non-prominent custom list assignment with calling tags and preferences in non-alphabetical order, `leadershipRole`, oversight on both target kinds incl. `fixed`, two dugout inclusions in non-sorted order, an approval (with a `users` row) → deep-equal after load | any single mapping wrong (each element has a distinct value so the test pins it) |
| `proposal sharing ids with its baseline round-trips` | `insertProposal(buildFixtureProposal(...))` → `loadProposal` deep-equals; both boards load independently | global PK collision, or prefix not applied |
| `initialize refuses a second time` | second call → `already_initialized`; data unchanged | overwrite |
| `initialize rejects invalid input and writes nothing` | board with a placement of an unknown member → `invalid`; `loadCurrent()` null and `members` empty | partial write |
| `importedAt and importVersion are recorded` | equals clock ISO and given version | wrong column |

`test/store/proposals.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `start from current snapshots baseline and board` | new proposal: baseline/board equal Current except `id`/`kind`/`version 0`; draft; tabOrder 0 then 1 | baseline references Current instead of copying |
| `duplicate keeps the source baseline and copies the source board` | after committing a change to A, duplicate A → B.board equals A.board's arrangement, B.baseline equals A.baseline (not Current) | baseline re-snapshotted from Current |
| `duplicate of accepted is draft` | source accepted (via `insertProposal`) → new status `draft`, `accepted` null | status copied |
| `create without current is no_current`; `unknown source is not_found`; `blank name is invalid` | error codes, nothing written | missing checks |
| `listProposals orders by tabOrder then id` | inserted out of order → ordered | unordered SELECT |

`test/store/commit.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `commit applies a core operation result and bumps version` | `moveToDugout` result committed with expectedVersion 0 → returned/loaded board equals op result with `version 1`; `updatedAt` = clock | version not bumped or not persisted |
| `stale expected version is rejected and nothing changes` | two commits from version 0 → second `stale` with `currentVersion: 1`; board equals first result | last-write-wins |
| `current, baseline and accepted proposal are not editable` | each → `not_editable`; rows unchanged | read-only not enforced in store |
| `unknown board is not_found` | — | — |
| `invalid board is rejected before writing` | placement of unknown member → `invalid`; version unchanged | write then validate |
| `failure mid-transaction rolls back` | approval whose `approvedBy` has no `users` row → `invalid`; every board table count and version unchanged | no transaction / partial delete |
| `commit to a proposal leaves current, its baseline and other proposals untouched` | deep-equal before/after for the others | shared rows |

`test/store/seed.test.ts`
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `seedFixture writes the fixture ward, current and one draft proposal` | counts match `FIXTURE_MEMBER_NAMES.length`; one proposal named `Spring adjustments` | partial seed |
| `src never imports fixtures or dev` | walks `apps/server/src/**/*.ts`, asserts no import specifier contains `core/fixtures` or resolves into `apps/server/dev` | Docker crash path re-introduced |

## Edge cases (each needs a test)
Covered above: empty store (`loadCurrent` null, `listProposals` empty), stale version, read-only kinds, invalid input, mid-transaction failure, duplicate of a duplicate keeping the original baseline (add: duplicate B of A, then C of B → C.baseline equals A.baseline).

## Human checks
none

## Out of scope
- Any HTTP/WebSocket route or `server.ts` change (T-024), proposal rename/accept/reopen (T-025), member profile edits (T-026), import replacement (T-058), import metadata in the core model (B-012), photos.
- Changing `001-initial.ts` or any existing test.
