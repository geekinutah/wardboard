# T-007: Domain model and fictional fixture ward

**Milestone:** 2 — Board domain
**Depends on:** T-001 (done)
**Spec refs:** SPEC.md §3 (Current/Proposal, Draft/Accepted, baseline snapshot), §4 (board groups, bishopric, Aaronic Priesthood, oversight seed), §5 (single vs list, positions, dugout), §6 (tags, affinities, `needs_approval`, approvals), §7 (logical data model — preserve every distinction), §8 (`removed_date`, no Church identifiers); AGENTS.md (logic in `packages/core`, pure functions, fictional fixtures, deterministic)

## Goal
`packages/core` has the immutable, typed domain model for WardBoard (ward-wide members and tags; board-owned structure, placements, oversight, dugout inclusions and approvals; proposals with baselines), validated constructors that reject structurally invalid boards with precise errors, and a deterministic fictional fixture ward every later task can build on.

## Design decisions (binding for this task)
- **Location**: `packages/core/src/model/` (types, `Result`, validation, constructors, id generator) and `packages/core/src/fixtures/` (fixture ward builder). `src/index.ts` re-exports the model. `package.json` `exports` adds a `"./fixtures": "./src/fixtures/index.ts"` subpath so the server and web e2e can seed from it later.
- **Purity**: no I/O, no `node:` imports, no `Date.now()`/`new Date()`/`Math.random()`/`crypto.randomUUID()` anywhere in `packages/core/src`. Ids and times come in as arguments; `sequentialIds(prefix)` returns a deterministic `IdGenerator` (`() => string`, e.g. `p-0001`, `p-0002`, …).
- **Immutability**: every exported type uses `readonly` properties/arrays/records. Constructors return deeply frozen values (`Object.freeze` recursively) so accidental mutation throws in strict mode.
- **Ids**: branded string types — `MemberId`, `TagId`, `BoardId`, `BoardGroupId`, `CallingGroupId`, `AssignmentId`, `PositionId`, `LineageId`, `UserId`, `ProposalId` — with small helper constructors (e.g. `memberId('m-1')`). Brands are type-only (erasable syntax; no enums, no namespaces, no parameter properties — required by Node type stripping).
- **`Result<T>`**: `{ ok: true; value: T } | { ok: false; errors: readonly ValidationError[] }`; `ValidationError = { code: string; path: string; message: string }`. Codes are stable string literals (listed below) so later tasks and the UI can branch on them.
- **Ward-wide data** (`Ward`): `members: Record<MemberId, Member>`, `tags: Record<TagId, Tag>`.
  - `Member`: `id`, `name` (trimmed, non-empty), `category: 'adult' | 'youth'`, `photoRef: string | null`, `note: string | null` (≤ 280 chars, matching T-005's schema), `tagIds: readonly TagId[]` (unique), `needsApproval: boolean`, `removedDate: string | null` (ISO `YYYY-MM-DD`, must be a real calendar date), `externalCallings: readonly { unit: string; title: string }[]`. No other fields — in particular nothing for contact details, birth date/age, gender, or any Church identifier.
  - `Tag`: `id`, `name` (trimmed, non-empty, unique case-insensitively within the ward).
- **Board** (one shape for Current, a proposal's working board, and a proposal's baseline snapshot), normalized as records keyed by id so later operations are simple immutable updates:
  - `id`, `kind: 'current' | 'proposal' | 'baseline'`, `version: number` (integer ≥ 0).
  - `boardGroups: Record<BoardGroupId, BoardGroup>` — `name`, `order`, `visible`, `key: BoardGroupKey | null` where `BoardGroupKey = 'bishopric' | 'elders_quorum' | 'relief_society' | 'aaronic_priesthood' | 'young_women' | 'primary' | 'sunday_school' | 'ward_wide'` (unique per board when non-null; used later by oversight and the accepted summary).
  - `callingGroups: Record<CallingGroupId, CallingGroup>` — `name`, `order`, `parent: { kind: 'boardGroup'; id } | { kind: 'callingGroup'; id }`, `kind: 'presidency' | 'bishopric' | 'quorum' | 'class' | 'committee' | 'other'`, `key: string | null` (well-known groups such as `'priests_quorum'`, `'elders_quorum_presidency'`; unique per board when non-null).
  - `assignments: Record<AssignmentId, CallingAssignment>` — `groupId: CallingGroupId`, `title`, `type: 'single' | 'list'`, `order`, `enabled`, `prominent` (overview prominence), `origin: 'standard' | 'custom'`, `leadershipRole: 'president' | 'counselor' | null` (the bishop is `president` of the `bishopric` group; consumed by T-013), `callingTagIds: readonly TagId[]`, `preferredMemberTagIds: readonly TagId[]` (affinities).
  - `positions: Record<PositionId, Position>` — `assignmentId`, `lineageId`, `order`.
  - `placements: Record<PositionId, MemberId>` — one occupant per position by construction; a member may occupy many different positions.
  - `oversight: readonly Oversight[]` — `{ overseer: 'bishop' | 'first_counselor' | 'second_counselor'; target: { kind: 'boardGroup' | 'callingGroup'; id }; fixed: boolean }`.
  - `dugoutInclusions: readonly MemberId[]` (explicit inclusions only; derived no-calling membership is T-008).
  - `approvals: readonly Approval[]` — `{ memberId; positionId; approvedBy: UserId; approvedAt: string /* ISO timestamp */ }`.
- **`Proposal`**: `id`, `name` (trimmed, non-empty), `rationale: string | null`, `status: 'draft' | 'accepted'`, `accepted: { by: UserId; at: string; summary: string } | null` (non-null iff status is accepted), `baseline: Board` (kind `baseline`), `board: Board` (kind `proposal`), `tabOrder: number`, `createdAt`, `updatedAt` (ISO strings supplied by the caller).
- **Constructors**: `createWard(input): Result<Ward>`, `createBoard(input, ward): Result<Board>`, `createProposal(input, ward): Result<Proposal>`. They collect **all** errors (not just the first). `createBoard` checks, with these error codes:
  - `dangling_reference` — calling group parent, assignment group, position assignment, placement position/member, approval member/position, oversight target, dugout member, or tag id not found;
  - `group_cycle` — calling-group parent chain loops;
  - `single_position_count` — a `single` assignment must have exactly one position;
  - `list_duplicate_member` — the same member placed twice within one `list` assignment;
  - `duplicate_lineage` — two positions on one board share a `lineageId`;
  - `duplicate_key` — repeated non-null board-group or calling-group `key`;
  - `fixed_oversight` — a `fixed: true` oversight entry is anything other than bishop → the calling group keyed `priests_quorum`; and if a `priests_quorum` group exists, that fixed entry must exist exactly once;
  - `approval_not_placed` — an approval for a member/position pair that is not a current placement;
  - `invalid_field` — empty/whitespace names or titles, negative or non-integer `version`/`order`, bad enum values (at runtime), note > 280, impossible `removedDate`, duplicate tag ids on a member.
  - `createWard` reports `invalid_field` and `duplicate_tag_name`. `createProposal` reports `invalid_field` (including accepted/summary mismatch), `board_kind` (baseline not `baseline` / board not `proposal`), and errors from validating both boards, with `path` prefixed `baseline.` / `board.`.
- **Fixture ward** — `buildFixtureWard(): { ward: Ward; current: Board }` and `buildFixtureProposal(current, ward, overrides?): Proposal`:
  - Deterministic: two calls return deep-equal values; ids from `sequentialIds`; fixed ISO times like `2026-01-04T12:00:00Z`.
  - Obviously fictional names (e.g. "Ada Fictional", "Ben Example"); ~40 members including adults and youth, at least one `needsApproval` member, one member with two callings, at least three members with no calling (dugout candidates), and members with tags. No `removedDate` in the fixture's Current.
  - All eight §4 board groups with their `key`s. Bishopric (bishop + 1st/2nd counselor as single positions, `leadershipRole` set) plus clerk and executive secretary as support roles; Relief Society presidency (president, two counselors, secretary) and a teachers `list` of 4 positions with 3 filled; Elders Quorum presidency keyed `elders_quorum_presidency`; Aaronic Priesthood with deacons, teachers and a priests quorum keyed `priests_quorum`; Young Women, Primary and Sunday School each with at least one presidency and a class/list; Ward-wide Callings with at least one subgroup (e.g. Music). At least one vacant single position and one custom (`origin: 'custom'`) assignment.
  - Oversight seeded per SPEC §4's proposed default: bishop → priests quorum (`fixed: true`), 1st counselor → teachers quorum and Sunday School, 2nd counselor → deacons quorum and Primary.
  - Calling tags/affinities on at least one assignment that match at least one member tag.
  - `buildFixtureProposal` returns a Draft proposal whose `baseline` and `board` are structurally equal copies of Current with their own board ids and kinds.

## Scope
May change:
- `packages/core/src/model/` (new)
- `packages/core/src/fixtures/` (new)
- `packages/core/src/index.ts` (export lines only)
- `packages/core/package.json` (`exports` subpath only)
- `packages/core/test/model/`, `packages/core/test/fixtures/` (new)

Must not change:
- `packages/core/src/util/**` and its tests, `apps/**`, `scripts/**`, root configs, `docs/**`, `SPEC.md`, anything else

New dependencies allowed: none.

## Acceptance criteria

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Model tests | `pnpm --filter core test -- model` | all tests in `test/model/` pass |
| 2 | Fixture tests | `pnpm --filter core test -- fixtures` | all tests in `test/fixtures/` pass |
| 3 | Fixture is importable by subpath, unbuilt | `pnpm --filter core exec node -e "import('@wardboard/core/fixtures').then(m => { const f = m.buildFixtureWard(); console.log(Object.keys(f.ward.members).length > 30, f.current.kind) })"` | prints `true current` |
| 4 | Core stays pure | `pnpm --filter core test -- purity` | the purity test passes |
| 5 | Typecheck and lint | `pnpm --filter core typecheck && pnpm --filter core lint` | exit 0 |
| 6 | Quality gate | `./scripts/verify.sh` | exits 0 |

## Unit tests to write
| Test name | Behavior it proves | A bug that would make it fail |
|---|---|---|
| `createWard accepts a valid ward` | minimal valid input → `ok: true`, value deep-equals normalized input | over-strict validation |
| `createWard rejects duplicate tag names case-insensitively` | `Youth` and `youth` → `duplicate_tag_name` | case-sensitive compare |
| `createWard validates member fields` | empty name, 281-char note, `removedDate: '2026-02-30'`, duplicate tag id on a member → one `invalid_field` each, all reported together with distinct paths | stops at first error; accepts Feb 30 |
| `createWard accepts note boundary 280` | 280 chars ok | off-by-one |
| `member has no disallowed fields` | keys of a constructed member are exactly the allowed set | someone adds `birthDate` |
| `createBoard accepts the minimal valid board` | one group, one single assignment, one position, one placement → ok | — |
| `createBoard reports every dangling reference` | a board with a bad parent, bad assignment group, bad position assignment, placement to missing member, missing oversight target, dugout of unknown member → six `dangling_reference` errors with paths | partial checks |
| `createBoard rejects calling-group cycles` | A→B→A → `group_cycle` (and no infinite loop) | infinite recursion |
| `createBoard enforces exactly one position per single assignment` | 0 or 2 positions → `single_position_count` | list rules applied to singles |
| `createBoard rejects the same member twice in one list` | → `list_duplicate_member` | missing check |
| `createBoard allows one member in several assignments` | member in RS teacher list and Primary single → ok | over-restriction |
| `createBoard rejects duplicate lineage ids and duplicate keys` | → `duplicate_lineage`, `duplicate_key` | missing uniqueness |
| `createBoard enforces the fixed bishop oversight` | fixed entry for a counselor → `fixed_oversight`; priests quorum present but no fixed bishop entry → `fixed_oversight`; two fixed entries → `fixed_oversight` | fixed flag unchecked |
| `createBoard rejects approvals for unplaced pairs` | → `approval_not_placed` | missing check |
| `constructed boards are deeply frozen` | assigning to `board.placements[x]` or pushing to `board.dugoutInclusions` throws | shallow freeze |
| `createProposal validates kinds and acceptance` | baseline kind `proposal` → `board_kind`; `status: 'accepted'` with `accepted: null` → `invalid_field`; draft with non-null `accepted` → `invalid_field`; errors inside boards are prefixed `baseline.`/`board.` | unchecked invariants |
| `sequentialIds is deterministic and independent per generator` | two generators with the same prefix yield the same sequence; calls advance | shared global counter |
| `fixture ward is deterministic` | two `buildFixtureWard()` calls are deep-equal | uses Math.random/Date |
| `fixture ward validates` | re-running `createWard`/`createBoard` on the fixture's data → ok | fixture drifts from validation |
| `fixture covers the required scenarios` | ≥ 1 needsApproval member; ≥ 1 member with 2 callings; ≥ 3 members with no placement; a list with a vacancy; a vacant single; a custom assignment; all 8 board-group keys; `priests_quorum` and `elders_quorum_presidency` keys; fixed bishop oversight; an affinity matching a member tag; adults and youth | fixture missing a case later tasks need |
| `fixture names are fictional` | every member name is in the fixture's own fictional name list (no external data) | — (documents the rule; also guards against copy-paste) |
| `fixture proposal is an independent copy` | proposal baseline/board structurally equal Current except ids/kinds; changing the proposal input record doesn't affect Current (immutability) | shared references |
| `core source is pure` (`test/purity.test.ts`) | scanning `packages/core/src/**/*.ts` finds no `from 'node:`, `Date.now(`, `new Date(`, `Math.random(`, `randomUUID(`, `fetch(` | impure code in core |

## Edge cases (each needs a test)
- Empty ward (no members) and an empty board (no groups) are valid.
- Every error code above appears in at least one test; multiple errors are reported together.
- Calendar edge: `2028-02-29` valid, `2026-02-29` invalid.
- Calling-group cycle detection terminates.

## Human checks
none

## Out of scope
- Derived views (T-008), any operation (T-009+), diff (T-016), rules (T-014/T-015/T-017), search (T-019), tag operations (T-020).
- Persistence mapping to T-005's SQLite schema (T-023).
- Changing `assertNever` or its tests (B-002 is separate).
