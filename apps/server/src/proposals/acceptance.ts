import {
  acceptanceEligibility,
  unapprovedPlacements,
  type Board,
  type Proposal,
  type Ward,
} from '@wardboard/core';

function countLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

export function checkAcceptance(
  proposal: Proposal,
  current: Board,
  ward: Ward,
): { ok: true } | { ok: false; code: 'removed_items' | 'unapproved_placements'; message: string } {
  const eligibility = acceptanceEligibility(proposal, current, ward);
  if (!eligibility.eligible) {
    let members = 0;
    let positions = 0;
    for (const reason of eligibility.reasons) {
      if (reason.kind === 'removed_member') members += 1;
      else positions += 1;
    }
    const parts: string[] = [];
    if (members > 0) parts.push(countLabel(members, 'removed member', 'removed members'));
    if (positions > 0) parts.push(countLabel(positions, 'removed position', 'removed positions'));
    return { ok: false, code: 'removed_items', message: parts.join(', ') };
  }

  const pending = unapprovedPlacements(proposal, ward);
  if (pending.length > 0) {
    return {
      ok: false,
      code: 'unapproved_placements',
      message: countLabel(pending.length, 'unapproved placement', 'unapproved placements'),
    };
  }
  return { ok: true };
}
