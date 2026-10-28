import {
  acceptanceEligibility,
  rootBoardGroupOf,
  unapprovedPlacements,
  type Board,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';

/*
 * Pure helpers for the accepted-proposal view (SPEC §3). Eligibility and
 * approval rules live in core; this only turns their results into sentences.
 */

/** "{org} · {title}" for a position on the proposal board, or null when it is missing. */
function positionLabel(board: Board, id: PositionId): string | null {
  const position = board.positions[id];
  const assignment = position === undefined ? undefined : board.assignments[position.assignmentId];
  if (assignment === undefined) {
    return null;
  }
  const group = board.boardGroups[rootBoardGroupOf(board, assignment.groupId)];
  return group === undefined ? assignment.title : `${group.name} · ${assignment.title}`;
}

/**
 * Why a Draft proposal cannot be accepted: removal reasons first, then
 * unapproved needs-approval placements, each in core order. An Accepted
 * proposal has no reasons.
 */
export function acceptBlockReasons(proposal: Proposal, current: Board, ward: Ward): string[] {
  if (proposal.status === 'accepted') {
    return [];
  }
  const nameOf = (memberId: string): string => ward.members[memberId as keyof Ward['members']]?.name ?? memberId;
  const reasons: string[] = [];
  for (const reason of acceptanceEligibility(proposal, current, ward).reasons) {
    if (reason.kind === 'removed_member') {
      reasons.push(`${nameOf(reason.memberId)} is no longer in the ward`);
    } else {
      const label = positionLabel(proposal.board, reason.positionId) ?? reason.positionId;
      reasons.push(`${label} no longer exists in Current`);
    }
  }
  for (const requirement of unapprovedPlacements(proposal, ward)) {
    const label = positionLabel(proposal.board, requirement.positionId) ?? requirement.positionId;
    reasons.push(`${nameOf(requirement.memberId)} needs approval as ${label}`);
  }
  return reasons;
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Oct 26, 2026" (UTC), or null when `iso` is not a date. */
export function formatAcceptedDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date);
}

/** Newest accepted first, ties by name. Returns a new array. */
export function sortHistory<T extends { name: string; acceptedAt: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    const left = Date.parse(a.acceptedAt);
    const right = Date.parse(b.acceptedAt);
    const l = Number.isNaN(left) ? Number.NEGATIVE_INFINITY : left;
    const r = Number.isNaN(right) ? Number.NEGATIVE_INFINITY : right;
    if (l !== r) {
      return r > l ? 1 : -1;
    }
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
}
