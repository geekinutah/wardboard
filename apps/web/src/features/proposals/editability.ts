import { assertNever, type Board, type ProposalStatus } from '@wardboard/core';

export type Editability =
  | { editable: true }
  | { editable: false; reason: 'current' | 'baseline' | 'accepted' | 'unknown' };

export function boardEditability(
  board: Pick<Board, 'kind'>,
  proposal: { status: ProposalStatus } | null,
): Editability {
  switch (board.kind) {
    case 'current':
      return { editable: false, reason: 'current' };
    case 'baseline':
      return { editable: false, reason: 'baseline' };
    case 'proposal':
      return proposalEditability(proposal);
    default:
      return assertNever(board.kind);
  }
}

function proposalEditability(proposal: { status: ProposalStatus } | null): Editability {
  if (proposal === null) {
    // Fail closed while the proposal view has not loaded.
    return { editable: false, reason: 'unknown' };
  }
  switch (proposal.status) {
    case 'draft':
      return { editable: true };
    case 'accepted':
      return { editable: false, reason: 'accepted' };
    default:
      return assertNever(proposal.status);
  }
}
