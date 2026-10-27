import type { Board, Proposal, ProposalStatus } from '@wardboard/core';

/** `boards.current`. Not exported by the server package; matches `channel.ts`. */
export type CurrentInfo = {
  boardId: Board['id'];
  version: number;
  importVersion: string;
  importedAt: string;
};

/** `snapshot.proposal` and `boards` do not carry this view. Null when the board is not a proposal. */
export type ProposalView = {
  id: Proposal['id'];
  name: string;
  status: ProposalStatus;
  rationale: string | null;
  baselineBoardId: Board['id'];
};
