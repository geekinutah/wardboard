import { acceptedSummary, positionId, releaseCalling, sequentialIds, type Proposal } from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { describe, expect, it } from 'vitest';
import { freezeSummary } from '../../src/proposals/index.ts';

function withBoard(proposal: Proposal, board: Proposal['board']): Proposal {
  return { ...proposal, board };
}

describe('frozen summary', () => {
  it('freezeSummary round-trips to acceptedSummary output; no changes → "[]"', () => {
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const dora = Object.values(ward.members).find((member) => member.name === 'Dora Placeholder');
    if (dora === undefined) throw new Error('missing Dora Placeholder');
    const clerk = Object.entries(proposal.board.placements).find(([, occupant]) => occupant === dora.id);
    if (clerk === undefined) throw new Error('Dora Placeholder is not placed');
    const [clerkId] = clerk;
    const released = releaseCalling(
      proposal.board,
      { ward, ids: sequentialIds('release') },
      { memberId: dora.id, positionId: positionId(clerkId) },
    );
    if (!released.ok) throw new Error(released.error.message);
    const changed = withBoard(proposal, released.board);

    const frozen = freezeSummary(changed, ward);
    expect(frozen).toBe(JSON.stringify(acceptedSummary(changed, ward)));
    expect(JSON.parse(frozen)).toEqual(acceptedSummary(changed, ward));
    expect(frozen).toContain('Dora Placeholder');
    expect(freezeSummary(proposal, ward)).toBe('[]');
  });
});
