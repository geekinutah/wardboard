import type {
  Board,
  BoardId,
  IdGenerator,
  MemberId,
  Proposal,
  ProposalAcceptance,
  ProposalId,
  ProposalStatus,
  TagId,
  TagUsage,
  Ward,
} from '@wardboard/core';

export type StoreClock = () => Date;

export type CurrentRecord = { board: Board; importVersion: string; importedAt: string };

export type ProposalSummary = {
  id: ProposalId;
  name: string;
  status: ProposalStatus;
  tabOrder: number;
  boardId: BoardId;
  version: number;
  updatedAt: string;
  /**
   * When the proposal was accepted, or null for a Draft. The store always sets
   * it; it is optional in this type only so existing web test fixtures that
   * build summaries by hand still typecheck until the web client adopts it.
   */
  acceptedAt?: string | null;
};

export type StoreError =
  | { code: 'not_found'; message: string }
  | { code: 'not_editable'; message: string }
  | { code: 'stale'; message: string; currentVersion: number }
  | { code: 'invalid'; message: string }
  | { code: 'no_current'; message: string }
  | { code: 'already_initialized'; message: string };

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

export interface Store {
  /** One transaction. Writes ward + Current. Refuses when a Current board already exists. */
  initialize(input: { ward: Ward; current: Board; importVersion: string }): StoreResult<void>;
  loadWard(): Ward;
  loadCurrent(): CurrentRecord | null;
  listProposals(): readonly ProposalSummary[];
  loadProposal(id: ProposalId): Proposal | null;
  /** Returns the board with this id (Current, any baseline, or any proposal board), or null. */
  loadBoard(boardId: BoardId): Board | null;
  /** Inserts an already-built Proposal verbatim (fixture seeding and tests). Refuses an existing id (`invalid`). */
  insertProposal(proposal: Proposal): StoreResult<void>;
  createProposal(
    input: {
      name: string;
      rationale: string | null;
      source: { kind: 'current' } | { kind: 'proposal'; id: ProposalId };
    },
    ids: IdGenerator,
  ): StoreResult<Proposal>;
  /** Replaces every board-owned row of `next.id` and sets version = expectedVersion + 1, in one transaction. */
  commitBoard(next: Board, expectedVersion: number): StoreResult<Board>;
  /** Sets name, rationale, and updated_at. Does not change the board version. */
  updateProposalMeta(
    id: ProposalId,
    meta: { name: string; rationale: string | null },
  ): StoreResult<Proposal>;
  /** Writes acceptance, or clears it when `accepted` is null. Does not change the board version. */
  setProposalAcceptance(id: ProposalId, accepted: ProposalAcceptance | null): StoreResult<Proposal>;
  /** Replaces name, note, tags, and/or photoRef for one member. Unknown member is `not_found`; other failures are `invalid`. */
  updateMemberProfile(
    id: MemberId,
    patch: { name?: string; note?: string | null; tagIds?: readonly TagId[]; photoRef?: string },
  ): StoreResult<Ward>;
  /** Adds a tag through core `createTag`. Duplicate names are `invalid`. */
  createTag(name: string, ids: IdGenerator): StoreResult<{ ward: Ward; tagId: TagId }>;
  /** Renames a tag through core `renameTag`. Unknown tag is `not_found`; duplicate names are `invalid`. */
  renameTag(id: TagId, name: string): StoreResult<Ward>;
  /**
   * Sets `needsApproval`. Turning it on drops that member's approvals on Draft
   * working boards only, and returns those boards at `version + 1`.
   */
  setNeedsApproval(id: MemberId, value: boolean): StoreResult<{ ward: Ward; boards: readonly Board[] }>;
  /**
   * Deletes a tag through core `deleteTag` across the ward and every stored board
   * (Current, each working board, each baseline), in one transaction. Changed
   * Current and working boards are written at `version + 1` and returned; changed
   * baselines are rewritten in place with no version change. Unknown tag is `not_found`.
   */
  deleteTag(id: TagId): StoreResult<{ ward: Ward; boards: readonly Board[] }>;
  /** Core `tagUsage` over the ward, Current, and every proposal working board (not baselines). */
  tagUsage(id: TagId): StoreResult<TagUsage>;
  /** `showNeedsApproval` from the settings row, or false when the row is absent. */
  loadSettings(): { showNeedsApproval: boolean };
  /** Writes the `showNeedsApproval` settings row as a JSON boolean. */
  setShowNeedsApproval(value: boolean): void;
  /**
   * Replaces ward members and the current board after createWard and createBoard
   * succeed. Rechecks expectedVersion inside the transaction before any write.
   */
  replaceCurrent(input: {
    ward: Ward;
    current: Board;
    expectedVersion: number;
    importVersion: string;
    importedAt: string;
  }): StoreResult<{ ward: Ward; current: CurrentRecord }>;
}
