import type {
  Board,
  BoardId,
  IdGenerator,
  Proposal,
  ProposalAcceptance,
  ProposalId,
  ProposalStatus,
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
}
