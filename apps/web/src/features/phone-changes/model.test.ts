import { describe, expect, it } from 'vitest';
import {
  placeInPosition,
  sequentialIds,
  type MemberId,
  type OperationContext,
  type Proposal,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { buildPhoneChangesModel } from './model.ts';

describe('buildPhoneChangesModel', () => {
  it('buildPhoneChangesModel computes net callings, releases, and position changes', () => {
    const data = buildPreviewData();
    const model = buildPhoneChangesModel(data.proposal, data.current, data.ward);

    expect(model.proposalName).toBe('Spring adjustments');
    expect(model.status).toBe('draft');
    expect(model.subtitle).toBe('Spring adjustments vs. its Jan 4 baseline \u00B7 net only');
    expect(model.removedItems).toHaveLength(0);

    // Suggested callings
    expect(model.callings).toHaveLength(1);
    expect(model.callings[0]?.key).toBeTruthy();
    expect(model.callings[0]?.who).toBe('Ivy Notreal');
    expect(model.callings[0]?.what).toBe('Relief Society \u00B7 Relief Society Teacher');

    // Suggested releases
    expect(model.releases).toHaveLength(1);
    expect(model.releases[0]?.key).toBeTruthy();
    expect(model.releases[0]?.who).toBe('Ari Sample');
    expect(model.releases[0]?.what).toBe('Primary \u00B7 Second Counselor');

    // Position changes
    expect(model.positionChanges).toHaveLength(1);
    expect(model.positionChanges[0]?.key).toBeTruthy();
    expect(model.positionChanges[0]?.who).toBe('Added');
    expect(model.positionChanges[0]?.what).toBe('Sunday School \u00B7 Gospel Doctrine Teacher');

    expect(model.canAccept).toBe(true);
    expect(model.acceptBlockReason).toBeNull();
  });

  it('buildPhoneChangesModel flags removed members and removed positions and blocks acceptance', () => {
    const data = buildPreviewData();

    // 1 removed member: Flo Madeup (Music Coordinator)
    const flo = Object.values(data.ward.members).find((m) => m.name === 'Flo Madeup');
    if (flo === undefined) {
      throw new Error('missing Flo Madeup in fixture ward');
    }
    const modifiedWard = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [flo.id]: {
          ...flo,
          removedDate: '2026-10-24',
        },
      },
    };

    // 1 removed position: Livestream Coordinator held by Liv Example
    const liveStreamSlot = Object.values(data.current.positions).find((p) => {
      const assignment = data.current.assignments[p.assignmentId];
      return assignment?.title === 'Livestream Coordinator';
    });
    if (liveStreamSlot === undefined) {
      throw new Error('missing Livestream Coordinator in fixture current');
    }
    const remainingPositions = Object.fromEntries(
      Object.entries(data.current.positions).filter(([id]) => id !== liveStreamSlot.id),
    );
    const modifiedCurrent = {
      ...data.current,
      positions: remainingPositions,
    };

    const model = buildPhoneChangesModel(data.proposal, modifiedCurrent, modifiedWard);

    expect(model.removedItems).toHaveLength(2);
    expect(model.removedItems[0]?.key).toBeTruthy();
    expect(model.removedItems[0]?.kind).toBe('member');
    expect(model.removedItems[0]?.headline).toBe('Flo Madeup');
    expect(model.removedItems[0]?.detail).toBe('Member removed \u00B7 Music Coordinator here');

    expect(model.removedItems[1]?.key).toBeTruthy();
    expect(model.removedItems[1]?.kind).toBe('position');
    expect(model.removedItems[1]?.headline).toBe('Ward-wide Callings \u00B7 Livestream Coordinator');
    expect(model.removedItems[1]?.detail).toBe('Position removed \u00B7 held by Liv Example');

    expect(model.canAccept).toBe(false);
    expect(model.acceptBlockReason).toBe('Resolve the 2 removed items to accept');
  });

  it('buildPhoneChangesModel blocks acceptance when a needs-approval placement is unapproved', () => {
    const data = buildPreviewData();
    const ctx: OperationContext = { ward: data.ward, ids: sequentialIds('approval-test') };

    // Find Cy Mockup (needsApproval: true)
    const cy = Object.values(data.ward.members).find((m) => m.name === 'Cy Mockup');
    if (cy === undefined) {
      throw new Error('missing Cy Mockup in fixture ward');
    }

    // Find a vacant position on proposal.board not held by Cy
    const vacantSlot = Object.values(data.proposal.board.positions).find((p) => {
      const placement = data.proposal.board.placements[p.id];
      const assignment = data.proposal.board.assignments[p.assignmentId];
      return placement === undefined && assignment?.type === 'single';
    });
    if (vacantSlot === undefined) {
      throw new Error('missing vacant single position');
    }

    const placed = placeInPosition(data.proposal.board, ctx, {
      memberId: cy.id,
      from: null,
      to: vacantSlot.id,
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) {
      return;
    }

    const unapprovedProposal: Proposal = {
      ...data.proposal,
      board: placed.board,
    };

    const model = buildPhoneChangesModel(unapprovedProposal, data.current, data.ward);
    expect(model.canAccept).toBe(false);
    expect(model.acceptBlockReason).toBe('Approve 1 placement to accept');

    // Combine with 1 removed member
    const flo = Object.values(data.ward.members).find((m) => m.name === 'Flo Madeup');
    if (flo === undefined) {
      throw new Error('missing Flo Madeup');
    }
    const modifiedWard = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [flo.id]: {
          ...flo,
          removedDate: '2026-10-24',
        },
      },
    };

    const combinedModel = buildPhoneChangesModel(unapprovedProposal, data.current, modifiedWard);
    expect(combinedModel.canAccept).toBe(false);
    expect(combinedModel.acceptBlockReason).toBe('Resolve 1 removed item and 1 unapproved placement to accept');
  });

  it('handles singular removed item reason', () => {
    const data = buildPreviewData();
    const flo = Object.values(data.ward.members).find((m) => m.name === 'Flo Madeup');
    if (flo === undefined) {
      throw new Error('missing Flo Madeup');
    }
    const modifiedWard = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [flo.id]: {
          ...flo,
          removedDate: '2026-10-24',
        },
      },
    };

    const model = buildPhoneChangesModel(data.proposal, data.current, modifiedWard);
    expect(model.removedItems).toHaveLength(1);
    expect(model.canAccept).toBe(false);
    expect(model.acceptBlockReason).toBe('Resolve the 1 removed item to accept');
  });

  it('handles plural unapproved placements and plural removed items together', () => {
    const data = buildPreviewData();

    // 2 members requiring approval
    const adult1 = Object.values(data.ward.members).find((m) => m.name === 'Cy Mockup');
    if (adult1 === undefined) {
      throw new Error('missing Cy Mockup');
    }

    // Create another member with needsApproval: true
    const adult2Id = 'm-0099' as MemberId;
    const wardWithTwo: typeof data.ward = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [adult2Id]: {
          id: adult2Id,
          name: 'Dana NeedsApproval',
          category: 'adult',
          gender: 'female',
          priesthood: 'none',
          birthDate: '1990-01-01',
          membershipRecordNumber: null,
          callingLimit: 1,
          moveInDate: null,
          notGospelLivingDate: null,
          needsApproval: true,
          outOfUnit: false,
          homeUnit: null,
          phone: null,
          email: null,
          photoUrl: null,
          removedDate: null,
          recommendType: 'none',
          recommendStatus: 'none',
          recommendExpirationDate: null,
          marriageDate: null,
          templeMarriage: false,
          endowmentDate: null,
        },
      },
    };
    const ctx: OperationContext = { ward: wardWithTwo, ids: sequentialIds('multi-approval') };

    const vacantSingles = Object.values(data.proposal.board.positions).filter((p) => {
      const placement = data.proposal.board.placements[p.id];
      const assignment = data.proposal.board.assignments[p.assignmentId];
      return placement === undefined && assignment?.type === 'single';
    });

    const slot0 = vacantSingles[0];
    const slot1 = vacantSingles[1];
    if (slot0 === undefined || slot1 === undefined) {
      throw new Error('missing vacant single positions');
    }

    let board = data.proposal.board;
    const p1 = placeInPosition(board, ctx, { memberId: adult1.id, from: null, to: slot0.id });
    expect(p1.ok).toBe(true);
    if (!p1.ok) {
      return;
    }
    board = p1.board;

    const p2 = placeInPosition(board, ctx, { memberId: adult2Id, from: null, to: slot1.id });
    expect(p2.ok).toBe(true);
    if (!p2.ok) {
      return;
    }
    board = p2.board;

    const proposalWithTwoUnapproved: Proposal = {
      ...data.proposal,
      board,
    };

    const modelUnapprovedOnly = buildPhoneChangesModel(proposalWithTwoUnapproved, data.current, wardWithTwo);
    expect(modelUnapprovedOnly.acceptBlockReason).toBe('Approve 2 placements to accept');

    // Now add 2 removed items: Flo Madeup + Livestream Coordinator
    const floEntry = Object.values(wardWithTwo.members).find((m) => m.name === 'Flo Madeup');
    if (floEntry === undefined) {
      throw new Error('missing Flo Madeup');
    }
    const wardWithRemoved: typeof wardWithTwo = {
      ...wardWithTwo,
      members: {
        ...wardWithTwo.members,
        [floEntry.id]: {
          ...floEntry,
          removedDate: '2026-10-24',
        },
      },
    };

    const liveStreamSlot = Object.values(data.current.positions).find((p) => {
      const assignment = data.current.assignments[p.assignmentId];
      return assignment?.title === 'Livestream Coordinator';
    });
    if (liveStreamSlot === undefined) {
      throw new Error('missing Livestream Coordinator');
    }
    const remainingPositions = Object.fromEntries(
      Object.entries(data.current.positions).filter(([id]) => id !== liveStreamSlot.id),
    );
    const currentWithRemoved = {
      ...data.current,
      positions: remainingPositions,
    };

    const combined = buildPhoneChangesModel(proposalWithTwoUnapproved, currentWithRemoved, wardWithRemoved);
    expect(combined.acceptBlockReason).toBe('Resolve 2 removed items and 2 unapproved placements to accept');
  });

  it('reports vacant detail for a removed vacant position', () => {
    const data = buildPreviewData();

    // Chorister in Music is vacant on proposal.board and baseline
    const choristerSlot = Object.values(data.proposal.board.positions).find((p) => {
      const assignment = data.proposal.board.assignments[p.assignmentId];
      return assignment?.title === 'Chorister';
    });
    if (choristerSlot === undefined) {
      throw new Error('missing Chorister position');
    }
    expect(data.proposal.board.placements[choristerSlot.id]).toBeUndefined();

    // Remove Chorister from current
    const remainingPositions = Object.fromEntries(
      Object.entries(data.current.positions).filter(([id]) => id !== choristerSlot.id),
    );
    const modifiedCurrent = {
      ...data.current,
      positions: remainingPositions,
    };

    const model = buildPhoneChangesModel(data.proposal, modifiedCurrent, data.ward);
    const removedPosition = model.removedItems.find((item) => item.headline.includes('Chorister'));
    expect(removedPosition).toBeDefined();
    expect(removedPosition?.detail).toBe('Position removed \u00B7 vacant here');
  });

  it('sets canAccept to false and acceptBlockReason to null when proposal is accepted', () => {
    const data = buildPreviewData();
    const acceptedProposal: Proposal = {
      ...data.proposal,
      status: 'accepted',
    };

    const model = buildPhoneChangesModel(acceptedProposal, data.current, data.ward);
    expect(model.status).toBe('accepted');
    expect(model.canAccept).toBe(false);
    expect(model.acceptBlockReason).toBeNull();
  });

  it('formats subtitle without baseline date if createdAt is unparseable', () => {
    const data = buildPreviewData();
    const unparseableProposal: Proposal = {
      ...data.proposal,
      createdAt: 'invalid-date',
    };

    const model = buildPhoneChangesModel(unparseableProposal, data.current, data.ward);
    expect(model.subtitle).toBe('Spring adjustments \u00B7 net only');
  });
});
