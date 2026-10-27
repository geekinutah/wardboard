import type { Proposal, SummaryGroup } from '@wardboard/core';

export type ProposalDetail = {
  id: Proposal['id'];
  name: string;
  status: Proposal['status'];
  rationale: string | null;
  baselineBoardId: Proposal['baseline']['id'];
  boardId: Proposal['board']['id'];
  createdAt: string;
  updatedAt: string;
  accepted: null | {
    byLogin: string;
    at: string;
    summary: SummaryGroup[];
  };
};

export function toProposalDetail(
  proposal: Proposal,
  users: readonly { id: string; login: string }[],
): ProposalDetail {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
    boardId: proposal.board.id,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    accepted: acceptedDetail(proposal, users),
  };
}

function acceptedDetail(
  proposal: Proposal,
  users: readonly { id: string; login: string }[],
): ProposalDetail['accepted'] {
  const accepted = proposal.accepted;
  if (accepted === null) return null;
  const user = users.find((item) => item.id === accepted.by);
  if (user === undefined) {
    throw new Error(`accepting user ${accepted.by} does not exist`);
  }
  return { byLogin: user.login, at: accepted.at, summary: parsedSummary(accepted.summary) };
}

function parsedSummary(summary: string): SummaryGroup[] {
  const value: unknown = JSON.parse(summary);
  if (!Array.isArray(value)) {
    throw new Error('accepted summary must be a JSON array');
  }
  return value as SummaryGroup[];
}
