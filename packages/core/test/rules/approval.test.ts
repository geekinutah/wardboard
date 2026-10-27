import { describe, expect, it } from 'vitest';
import {
  addToList,
  APPROVAL_ERROR_CODES,
  approvalRequirements,
  approvePlacement,
  boardGroupId,
  boardId,
  createBoard,
  createProposal,
  createWard,
  dropAllApprovals,
  dropMemberApprovals,
  lineageId,
  memberId,
  placeInPosition,
  positionId,
  proposalId,
  unapprovedPlacements,
  userId,
  type Approval,
  type Board,
  type BoardGroupKey,
  type CallingGroup,
  type MemberId,
  type PositionId,
  type Proposal,
  type Ward,
} from '../../src/index.ts';
import { buildFixtureProposal, buildFixtureWard } from '../../src/fixtures/index.ts';
import { assignment, callingGroup, member, position, valueOf, wardOf } from '../model/helpers.ts';
import {
  assignmentNamed,
  contextFor,
  expectError,
  expectOk,
  isDeeplyFrozen,
  memberNamed,
  positionNamed,
  positionsOf,
  rebuild,
} from '../ops/helpers.ts';

const PRIMARY = ['Primary Teachers', 'Primary Teacher'] as const;
const CHORISTER = ['Music', 'Chorister'] as const;
const DEACONS_COUNSELOR = ['Deacons Quorum', 'Deacons Quorum First Counselor'] as const;
const RS_TEACHERS = ['Relief Society Teachers', 'Relief Society Teacher'] as const;
const SS_SECRETARY = ['Sunday School Presidency', 'Secretary'] as const;

const APPROVER = userId('u-editor');
const APPROVED_AT = '2026-03-01T15:04:05Z';
const APPROVED_AT_OFFSET = '2026-03-01T15:04:05-06:00';

interface FixtureProposal {
  readonly ward: Ward;
  readonly current: Board;
  readonly proposal: Proposal;
  readonly cy: MemberId;
  readonly primary: PositionId;
  readonly chorister: PositionId;
}

function fixtureProposal(): FixtureProposal {
  const { ward, current } = buildFixtureWard();
  const proposal = buildFixtureProposal(current, ward);
  const cy = memberNamed(ward, 'Cy Mockup');
  return {
    ward,
    current,
    proposal,
    cy,
    primary: positionNamed(proposal.board, ...PRIMARY, 1),
    chorister: positionNamed(proposal.board, ...CHORISTER),
  };
}

function replaceBoard(proposal: Proposal, ward: Ward, board: Board): Proposal {
  return valueOf(createProposal({ ...proposal, board }, ward));
}

function replaceBaseline(proposal: Proposal, ward: Ward, baseline: Board): Proposal {
  return valueOf(createProposal({ ...proposal, baseline }, ward));
}

function withStatus(proposal: Proposal, ward: Ward, status: 'draft' | 'accepted'): Proposal {
  if (status === 'accepted') {
    return valueOf(
      createProposal(
        {
          ...proposal,
          status,
          accepted: { by: userId('u-admin'), at: '2026-04-02T18:00:00Z', summary: 'Accepted for the test.' },
        },
        ward,
      ),
    );
  }
  return valueOf(createProposal({ ...proposal, status, accepted: null }, ward));
}

function withNeedsApproval(ward: Ward, id: MemberId, needsApproval: boolean): Ward {
  const current = ward.members[id];
  if (current === undefined) {
    throw new Error(`missing member ${id}`);
  }
  return valueOf(
    createWard({
      tags: ward.tags,
      members: { ...ward.members, [id]: { ...current, needsApproval } },
    }),
  );
}

function place(proposal: Proposal, ward: Ward, member: MemberId, from: PositionId | null, to: PositionId): Proposal {
  const board = expectOk(placeInPosition(proposal.board, contextFor(ward), { memberId: member, from, to }));
  return replaceBoard(proposal, ward, board);
}

function approvalOf(member: MemberId, position: PositionId, approvedBy = APPROVER, approvedAt = APPROVED_AT): Approval {
  return { memberId: member, positionId: position, approvedBy, approvedAt };
}

function withoutPosition<V>(record: Readonly<Record<PositionId, V>>, key: PositionId): Record<PositionId, V> {
  const copy: Record<PositionId, V> = {};
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key && value !== undefined) {
      copy[positionId(entryKey)] = value;
    }
  }
  return copy;
}

function approve(
  board: Board,
  ward: Ward,
  baseline: Board,
  member: MemberId,
  placedAt: PositionId,
  approvedBy = APPROVER,
  approvedAt = APPROVED_AT,
): Board {
  return expectOk(
    approvePlacement(board, contextFor(ward), {
      baseline,
      memberId: member,
      positionId: placedAt,
      approvedBy,
      approvedAt,
    }),
  );
}

/** Swaps lineage ids and moves `member` from `from` to `to`, so position id and lineage no longer agree. */
function crossLineages(board: Board, ward: Ward, from: PositionId, to: PositionId, occupant: MemberId): Board {
  const fromPosition = board.positions[from];
  const toPosition = board.positions[to];
  if (fromPosition === undefined || toPosition === undefined) {
    throw new Error('missing position');
  }
  const placements: Record<PositionId, MemberId> = { ...withoutPosition(board.placements, from), [to]: occupant };
  return rebuild(board, ward, {
    positions: {
      ...board.positions,
      [from]: { ...fromPosition, lineageId: toPosition.lineageId },
      [to]: { ...toPosition, lineageId: fromPosition.lineageId },
    },
    placements,
  });
}

function rekeyPosition(board: Board, ward: Ward, from: PositionId, to: PositionId): Board {
  const current = board.positions[from];
  if (current === undefined) {
    throw new Error(`missing position ${from}`);
  }
  const positions: Record<PositionId, (typeof current)> = {
    ...withoutPosition(board.positions, from),
    [to]: { ...current, id: to },
  };
  const occupant = board.placements[from];
  const placements: Record<PositionId, MemberId> =
    occupant === undefined
      ? withoutPosition(board.placements, from)
      : { ...withoutPosition(board.placements, from), [to]: occupant };
  return rebuild(board, ward, {
    positions,
    placements,
    approvals: board.approvals.map((entry) => (entry.positionId === from ? { ...entry, positionId: to } : entry)),
  });
}

function swapBoardGroupOrder(board: Board, ward: Ward, keyA: BoardGroupKey, keyB: BoardGroupKey): Board {
  const groupA = Object.values(board.boardGroups).find((group) => group.key === keyA);
  const groupB = Object.values(board.boardGroups).find((group) => group.key === keyB);
  if (groupA === undefined || groupB === undefined) {
    throw new Error('missing board group');
  }
  return rebuild(board, ward, {
    boardGroups: {
      ...board.boardGroups,
      [groupA.id]: { ...groupA, order: groupB.order },
      [groupB.id]: { ...groupB, order: groupA.order },
    },
  });
}

describe('needs-approval placements', () => {
  it('an unchanged placement needs no approval', () => {
    const { ward, proposal, cy, primary } = fixtureProposal();

    expect(proposal.board.placements[primary]).toBe(cy);
    expect(ward.members[cy]?.needsApproval).toBe(true);
    expect(approvalRequirements(proposal, ward)).toEqual([]);
    expect(unapprovedPlacements(proposal, ward)).toEqual([]);
  });

  it('a suggested calling for a flagged member needs approval', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);

    expect(approvalRequirements(moved, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: null },
    ]);

    // The destination position id is occupied by Cy on the baseline, but under a different lineage.
    // Comparing position ids would hide the suggested calling.
    const crossedBaseline = crossLineages(setup.proposal.baseline, setup.ward, setup.primary, setup.chorister, setup.cy);
    const crossed = replaceBaseline(moved, setup.ward, crossedBaseline);
    const proposalLineage = crossed.board.positions[setup.chorister]?.lineageId;
    const baselineLineage = crossed.baseline.positions[setup.chorister]?.lineageId;

    expect(crossed.baseline.placements[setup.chorister]).toBe(setup.cy);
    expect(proposalLineage).toBeDefined();
    expect(proposalLineage).not.toBe(baselineLineage);
    expect(approvalRequirements(crossed, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: null },
    ]);
    expect(approve(crossed.board, setup.ward, crossed.baseline, setup.cy, setup.chorister).approvals).toEqual([
      approvalOf(setup.cy, setup.chorister),
    ]);
  });

  it('an unflagged member never needs approval', () => {
    const { ward, proposal } = fixtureProposal();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const chorister = positionNamed(proposal.board, ...CHORISTER);

    expect(ward.members[ivy]?.needsApproval).toBe(false);
    expect(ward.members[ivy]?.tagIds.length).toBeGreaterThan(0);

    const moved = place(proposal, ward, ivy, null, chorister);

    expect(moved.board.placements[chorister]).toBe(ivy);
    expect(approvalRequirements(moved, ward)).toEqual([]);
  });

  it('a position added in the proposal needs approval', () => {
    const setup = fixtureProposal();
    const ivy = memberNamed(setup.ward, 'Ivy Notreal');
    const teachers = assignmentNamed(setup.proposal.board, ...RS_TEACHERS);
    const filled = expectOk(
      addToList(setup.proposal.board, contextFor(setup.ward, 'fill'), {
        memberId: ivy,
        from: null,
        assignmentId: teachers.id,
      }),
    );
    expect(positionsOf(filled, teachers.id).every((slot) => filled.placements[slot.id] !== undefined)).toBe(true);

    const added = expectOk(
      addToList(filled, contextFor(setup.ward, 'add'), {
        memberId: setup.cy,
        from: setup.primary,
        assignmentId: teachers.id,
      }),
    );
    const created = positionsOf(added, teachers.id).filter((slot) => !(slot.id in filled.positions));
    expect(created).toHaveLength(1);
    const createdId = created[0]?.id;
    if (createdId === undefined) {
      throw new Error('expected a new list position');
    }
    const createdLineage = added.positions[createdId]?.lineageId;
    expect(
      Object.values(setup.proposal.baseline.positions).some((slot) => slot.lineageId === createdLineage),
    ).toBe(false);

    const next = replaceBoard(setup.proposal, setup.ward, added);
    expect(approvalRequirements(next, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: createdId, approval: null },
    ]);
  });

  it('approvePlacement records approver and time', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const before = moved.board;

    const next = approve(before, setup.ward, moved.baseline, setup.cy, setup.chorister, APPROVER, APPROVED_AT_OFFSET);
    const approval = approvalOf(setup.cy, setup.chorister, APPROVER, APPROVED_AT_OFFSET);

    expect(next.approvals).toEqual([approval]);
    expect(next.id).toBe(before.id);
    expect(next.kind).toBe(before.kind);
    expect(next.version).toBe(before.version);
    expect({ ...next, approvals: before.approvals }).toEqual(before);

    const recorded = replaceBoard(moved, setup.ward, next);
    expect(approvalRequirements(recorded, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval },
    ]);
  });

  it('approval is tied to member and position', () => {
    const setup = fixtureProposal();
    const deacons = positionNamed(setup.proposal.board, ...DEACONS_COUNSELOR);
    const secretary = positionNamed(setup.proposal.board, ...SS_SECRETARY);
    const holdingBoth = place(
      place(setup.proposal, setup.ward, setup.cy, null, setup.chorister),
      setup.ward,
      setup.cy,
      null,
      deacons,
    );
    const approved = approve(holdingBoth.board, setup.ward, holdingBoth.baseline, setup.cy, setup.chorister);
    const moved = expectOk(
      placeInPosition(approved, contextFor(setup.ward), { memberId: setup.cy, from: deacons, to: secretary }),
    );
    const proposal = replaceBoard(holdingBoth, setup.ward, moved);
    const kept = approvalOf(setup.cy, setup.chorister);

    expect(moved.approvals).toEqual([kept]);
    expect(approvalRequirements(proposal, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: secretary, approval: null },
      { memberId: setup.cy, positionId: setup.chorister, approval: kept },
    ]);
  });

  it('approving what needs no approval is refused', () => {
    const setup = fixtureProposal();
    const ctx = contextFor(setup.ward);
    const unchanged = expectError(
      approvePlacement(setup.proposal.board, ctx, {
        baseline: setup.proposal.baseline,
        memberId: setup.cy,
        positionId: setup.primary,
        approvedBy: APPROVER,
        approvedAt: APPROVED_AT,
      }),
    );
    const ivy = memberNamed(setup.ward, 'Ivy Notreal');
    const placed = expectOk(
      placeInPosition(setup.proposal.board, ctx, { memberId: ivy, from: null, to: setup.chorister }),
    );
    const unflagged = expectError(
      approvePlacement(placed, ctx, {
        baseline: setup.proposal.baseline,
        memberId: ivy,
        positionId: setup.chorister,
        approvedBy: APPROVER,
        approvedAt: APPROVED_AT,
      }),
    );

    expect([unchanged.code, unflagged.code]).toEqual(['approval_not_required', 'approval_not_required']);
    expect(setup.proposal.board.approvals).toEqual([]);
    expect(placed.approvals).toEqual([]);
  });

  it('approving twice is refused', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const first = approve(moved.board, setup.ward, moved.baseline, setup.cy, setup.chorister);
    const snapshot = structuredClone(first);

    const second = expectError(
      approvePlacement(first, contextFor(setup.ward), {
        baseline: moved.baseline,
        memberId: setup.cy,
        positionId: setup.chorister,
        approvedBy: userId('u-other'),
        approvedAt: '2026-04-01T00:00:00Z',
      }),
    );

    expect(second.code).toBe('already_approved');
    expect(first).toEqual(snapshot);
    expect(first.approvals).toEqual([approvalOf(setup.cy, setup.chorister)]);
  });

  it('approvePlacement validates its inputs', () => {
    expect(APPROVAL_ERROR_CODES).toEqual(['not_placed', 'approval_not_required', 'already_approved']);

    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const snapshot = structuredClone(moved.board);
    const ctx = contextFor(setup.ward);
    const valid = {
      baseline: moved.baseline,
      memberId: setup.cy,
      positionId: setup.chorister,
      approvedBy: APPROVER,
      approvedAt: APPROVED_AT,
    };

    const emptyApprover = expectError(approvePlacement(moved.board, ctx, { ...valid, approvedBy: userId('') }));
    const blankApprover = expectError(approvePlacement(moved.board, ctx, { ...valid, approvedBy: userId('   ') }));
    const noZone = expectError(approvePlacement(moved.board, ctx, { ...valid, approvedAt: '2026-03-01T15:04:05' }));
    const impossibleDay = expectError(
      approvePlacement(moved.board, ctx, { ...valid, approvedAt: '2026-02-31T00:00:00Z' }),
    );
    const proposalBaseline = expectError(approvePlacement(moved.board, ctx, { ...valid, baseline: moved.board }));
    const currentBaseline = expectError(approvePlacement(moved.board, ctx, { ...valid, baseline: setup.current }));
    const unknownMember = expectError(
      approvePlacement(moved.board, ctx, { ...valid, memberId: memberId('m-missing') }),
    );
    const unknownPosition = expectError(
      approvePlacement(moved.board, ctx, { ...valid, positionId: positionId('p-missing') }),
    );
    const notInPrimary = expectError(approvePlacement(moved.board, ctx, { ...valid, positionId: setup.primary }));
    const secretary = positionNamed(moved.board, ...SS_SECRETARY);
    const notInVacancy = expectError(approvePlacement(moved.board, ctx, { ...valid, positionId: secretary }));

    expect(emptyApprover.code).toBe('invalid_operation');
    expect(blankApprover.code).toBe('invalid_operation');
    expect(noZone.code).toBe('invalid_operation');
    expect(impossibleDay.code).toBe('invalid_operation');
    expect(proposalBaseline.code).toBe('invalid_operation');
    expect(currentBaseline.code).toBe('invalid_operation');
    expect(unknownMember.code).toBe('not_found');
    expect(unknownPosition.code).toBe('not_found');
    expect(notInPrimary.code).toBe('not_placed');
    expect(notInVacancy.code).toBe('not_placed');
    expect(moved.board).toEqual(snapshot);
  });

  it('approvePlacement refuses non-proposal boards', () => {
    const { ward, current, proposal, cy, primary } = fixtureProposal();
    const ctx = contextFor(ward);
    const request = {
      baseline: proposal.baseline,
      memberId: cy,
      positionId: primary,
      approvedBy: APPROVER,
      approvedAt: APPROVED_AT,
    };

    expect(expectError(approvePlacement(current, ctx, request)).code).toBe('board_not_editable');
    expect(expectError(approvePlacement(proposal.baseline, ctx, request)).code).toBe('board_not_editable');
  });

  it('accepted proposals report no requirements', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const accepted = withStatus(moved, setup.ward, 'accepted');

    expect(accepted.status).toBe('accepted');
    expect(approvalRequirements(accepted, setup.ward)).toEqual([]);
    expect(unapprovedPlacements(accepted, setup.ward)).toEqual([]);

    const draft = withStatus(accepted, setup.ward, 'draft');
    expect(approvalRequirements(draft, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: null },
    ]);
  });

  it('clearing the flag removes the requirement', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const cleared = withNeedsApproval(setup.ward, setup.cy, false);

    expect(cleared.members[setup.cy]?.needsApproval).toBe(false);
    expect(approvalRequirements(moved, cleared)).toEqual([]);
    expect(approvalRequirements(moved, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: null },
    ]);
  });

  it('dropMemberApprovals removes only that member\'s approvals', () => {
    const setup = fixtureProposal();
    const bea = memberNamed(setup.ward, 'Bea Placeholder');
    const ward = withNeedsApproval(setup.ward, bea, true);
    const deacons = positionNamed(setup.proposal.board, ...DEACONS_COUNSELOR);
    const secretary = positionNamed(setup.proposal.board, ...SS_SECRETARY);
    const placed = place(
      place(place(setup.proposal, ward, setup.cy, null, setup.chorister), ward, setup.cy, null, deacons),
      ward,
      bea,
      positionNamed(setup.proposal.board, ...PRIMARY, 0),
      secretary,
    );
    const cyChorister = approve(placed.board, ward, placed.baseline, setup.cy, setup.chorister);
    const cyBoth = approve(cyChorister, ward, placed.baseline, setup.cy, deacons);
    const all = approve(cyBoth, ward, placed.baseline, bea, secretary, userId('u-bea'), '2026-03-02T10:00:00+00:00');
    const dropped = dropMemberApprovals(all, ward, setup.cy);

    expect(dropped.approvals).toEqual([approvalOf(bea, secretary, userId('u-bea'), '2026-03-02T10:00:00+00:00')]);
    expect(dropped.placements).toEqual(all.placements);
    expect(dropMemberApprovals(dropped, ward, setup.cy)).toEqual(dropped);

    const currentApproved = rebuild(setup.current, ward, { approvals: [approvalOf(setup.cy, setup.primary)] });
    const currentDropped = dropMemberApprovals(currentApproved, ward, setup.cy);
    expect(currentDropped.kind).toBe('current');
    expect(currentDropped.approvals).toEqual([]);
    expect(currentDropped.placements).toEqual(setup.current.placements);
  });

  it('dropAllApprovals empties approvals and keeps placements', () => {
    const setup = fixtureProposal();
    const bea = memberNamed(setup.ward, 'Bea Placeholder');
    const beaPosition = positionNamed(setup.proposal.board, ...PRIMARY, 0);
    const board = rebuild(setup.proposal.board, setup.ward, {
      approvals: [approvalOf(bea, beaPosition), approvalOf(setup.cy, setup.primary)],
    });

    const dropped = dropAllApprovals(board, setup.ward);

    expect(dropped.approvals).toEqual([]);
    expect(dropped.placements).toEqual(board.placements);
    expect(dropped.positions).toEqual(board.positions);
    expect(dropped.id).toBe(board.id);
    expect(dropped.kind).toBe(board.kind);
    expect(dropped.version).toBe(board.version);
    expect({ ...dropped, approvals: board.approvals }).toEqual(board);
    expect(dropAllApprovals(dropped, setup.ward)).toEqual(dropped);

    const baseline = rebuild(setup.proposal.baseline, setup.ward, {
      approvals: [approvalOf(setup.cy, setup.primary)],
    });
    const baselineDropped = dropAllApprovals(baseline, setup.ward);
    expect(baselineDropped.kind).toBe('baseline');
    expect(baselineDropped.approvals).toEqual([]);
    expect(baselineDropped.placements).toEqual(baseline.placements);
  });

  it('unapprovedPlacements lists only unapproved requirements', () => {
    const setup = fixtureProposal();
    const deacons = positionNamed(setup.proposal.board, ...DEACONS_COUNSELOR);
    const holdingBoth = place(
      place(setup.proposal, setup.ward, setup.cy, null, deacons),
      setup.ward,
      setup.cy,
      null,
      setup.chorister,
    );
    const approved = approve(holdingBoth.board, setup.ward, holdingBoth.baseline, setup.cy, deacons);
    const oneLeft = replaceBoard(holdingBoth, setup.ward, approved);

    expect(unapprovedPlacements(oneLeft, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: null },
    ]);

    const both = approve(approved, setup.ward, holdingBoth.baseline, setup.cy, setup.chorister, APPROVER, APPROVED_AT_OFFSET);
    expect(unapprovedPlacements(replaceBoard(oneLeft, setup.ward, both), setup.ward)).toEqual([]);
  });

  it('results are frozen and inputs untouched', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const proposalSnapshot = structuredClone(moved);
    const wardSnapshot = structuredClone(setup.ward);
    const baselineSnapshot = structuredClone(moved.baseline);

    const none = approvalRequirements(setup.proposal, setup.ward);
    const requirements = approvalRequirements(moved, setup.ward);
    const pending = unapprovedPlacements(moved, setup.ward);
    const approved = approve(moved.board, setup.ward, moved.baseline, setup.cy, setup.chorister);
    const approvedSnapshot = structuredClone(approved);
    const memberDropped = dropMemberApprovals(approved, setup.ward, setup.cy);
    const allDropped = dropAllApprovals(approved, setup.ward);

    expect(none).toEqual([]);
    expect(isDeeplyFrozen(none)).toBe(true);
    expect(isDeeplyFrozen(requirements)).toBe(true);
    expect(isDeeplyFrozen(pending)).toBe(true);
    expect(isDeeplyFrozen(approved)).toBe(true);
    expect(isDeeplyFrozen(memberDropped)).toBe(true);
    expect(isDeeplyFrozen(allDropped)).toBe(true);
    expect(memberDropped.approvals).toEqual([]);
    expect(allDropped.approvals).toEqual([]);
    expect(moved).toEqual(proposalSnapshot);
    expect(setup.ward).toEqual(wardSnapshot);
    expect(moved.baseline).toEqual(baselineSnapshot);
    expect(approved).toEqual(approvedSnapshot);
  });

  it('a flagged member with two suggested callings needs an approval for each', () => {
    const setup = fixtureProposal();
    const deacons = positionNamed(setup.proposal.board, ...DEACONS_COUNSELOR);
    const swappedBoard = swapBoardGroupOrder(setup.proposal.board, setup.ward, 'aaronic_priesthood', 'ward_wide');
    const swapped = replaceBoard(setup.proposal, setup.ward, swappedBoard);
    const holdingBoth = place(place(swapped, setup.ward, setup.cy, null, deacons), setup.ward, setup.cy, null, setup.chorister);
    // Ward-wide now sorts before Aaronic, so chorister precedes deacons even though its id is greater.
    expect(deacons < setup.chorister).toBe(true);

    const approvedChorister = approve(holdingBoth.board, setup.ward, holdingBoth.baseline, setup.cy, setup.chorister);
    const partial = replaceBoard(holdingBoth, setup.ward, approvedChorister);
    const choristerApproval = approvalOf(setup.cy, setup.chorister);

    expect(approvalRequirements(partial, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: choristerApproval },
      { memberId: setup.cy, positionId: deacons, approval: null },
    ]);
    expect(unapprovedPlacements(partial, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: deacons, approval: null },
    ]);

    const deaconsApproval = approvalOf(setup.cy, deacons, userId('u-other'), APPROVED_AT_OFFSET);
    const both = approve(
      approvedChorister,
      setup.ward,
      holdingBoth.baseline,
      setup.cy,
      deacons,
      deaconsApproval.approvedBy,
      deaconsApproval.approvedAt,
    );
    expect(approvalRequirements(replaceBoard(partial, setup.ward, both), setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: choristerApproval },
      { memberId: setup.cy, positionId: deacons, approval: deaconsApproval },
    ]);

    const nested = nestedCallings();
    const middle = approve(nested.proposal.board, nested.ward, nested.proposal.baseline, nested.member, nested.second);
    const recorded = replaceBoard(nested.proposal, nested.ward, middle);
    const middleApproval = approvalOf(nested.member, nested.second);

    expect(approvalRequirements(recorded, nested.ward).map((requirement) => requirement.positionId)).toEqual([
      nested.first,
      nested.second,
      nested.third,
      nested.fourth,
    ]);
    expect(approvalRequirements(recorded, nested.ward)).toEqual([
      { memberId: nested.member, positionId: nested.first, approval: null },
      { memberId: nested.member, positionId: nested.second, approval: middleApproval },
      { memberId: nested.member, positionId: nested.third, approval: null },
      { memberId: nested.member, positionId: nested.fourth, approval: null },
    ]);
  });

  it('a flagged member placed back into their baseline position needs no approval', () => {
    const setup = fixtureProposal();
    const away = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    expect(approvalRequirements(away, setup.ward)).toEqual([
      { memberId: setup.cy, positionId: setup.chorister, approval: null },
    ]);

    const teachers = assignmentNamed(away.board, ...PRIMARY);
    const returnedBoard = expectOk(
      addToList(away.board, contextFor(setup.ward), {
        memberId: setup.cy,
        from: setup.chorister,
        assignmentId: teachers.id,
      }),
    );
    const returned = replaceBoard(away, setup.ward, returnedBoard);
    expect(returned.board.placements[setup.primary]).toBe(setup.cy);
    expect(approvalRequirements(returned, setup.ward)).toEqual([]);

    // Same lineage as the baseline calling, but a position id the baseline does not use.
    const rekeyedId = positionId('p-rekeyed-cy');
    const rekeyed = replaceBoard(returned, setup.ward, rekeyPosition(returned.board, setup.ward, setup.primary, rekeyedId));
    expect(rekeyed.baseline.placements[setup.primary]).toBe(setup.cy);
    expect(rekeyed.board.placements[rekeyedId]).toBe(setup.cy);
    expect(rekeyed.board.positions[rekeyedId]?.lineageId).toBe(rekeyed.baseline.positions[setup.primary]?.lineageId);
    expect(rekeyed.baseline.positions[rekeyedId]).toBeUndefined();
    expect(approvalRequirements(rekeyed, setup.ward)).toEqual([]);
    expect(
      expectError(
        approvePlacement(rekeyed.board, contextFor(setup.ward), {
          baseline: rekeyed.baseline,
          memberId: setup.cy,
          positionId: rekeyedId,
          approvedBy: APPROVER,
          approvedAt: APPROVED_AT,
        }),
      ).code,
    ).toBe('approval_not_required');
  });

  it('clearing the flag leaves stored approvals in place', () => {
    const setup = fixtureProposal();
    const moved = place(setup.proposal, setup.ward, setup.cy, setup.primary, setup.chorister);
    const approved = approve(moved.board, setup.ward, moved.baseline, setup.cy, setup.chorister);
    const proposal = replaceBoard(moved, setup.ward, approved);
    const cleared = withNeedsApproval(setup.ward, setup.cy, false);
    const snapshot = structuredClone(proposal);

    expect(approvalRequirements(proposal, cleared)).toEqual([]);
    expect(unapprovedPlacements(proposal, cleared)).toEqual([]);
    expect(proposal.board.approvals).toEqual([approvalOf(setup.cy, setup.chorister)]);
    expect(proposal).toEqual(snapshot);
  });
});

interface NestedCallings {
  readonly ward: Ward;
  readonly proposal: Proposal;
  readonly member: MemberId;
  /** Board group 0, calling-group chain [0, 0], high position order, late id. */
  readonly first: PositionId;
  /** Same parents as `first` through the first chain entry; leaf order pushes it after `first`. */
  readonly second: PositionId;
  /** Earlier leaf order than `second`, but a later parent, so it sorts after both. */
  readonly third: PositionId;
  /** Earliest chain under a later board group. */
  readonly fourth: PositionId;
}

function nestedCallings(): NestedCallings {
  const flagged = member('m-flag', { name: 'Ada Flagged', needsApproval: true });
  const ward = wardOf(flagged);
  const early = boardGroupId('bg-early');
  const late = boardGroupId('bg-late');
  const parentEarly = callingGroup('cg-parent-early', { name: 'Early parent', order: 0, parent: { kind: 'boardGroup', id: early } });
  const parentNext = callingGroup('cg-parent-next', { name: 'Next parent', order: 1, parent: { kind: 'boardGroup', id: early } });
  const parentLate = callingGroup('cg-parent-late', { name: 'Late parent', order: 0, parent: { kind: 'boardGroup', id: late } });
  const leafFirst = callingGroup('cg-leaf-first', {
    name: 'Leaf first',
    order: 0,
    parent: { kind: 'callingGroup', id: parentEarly.id },
  });
  const leafSecond = callingGroup('cg-leaf-second', {
    name: 'Leaf second',
    order: 1,
    parent: { kind: 'callingGroup', id: parentEarly.id },
  });
  const leafThird = callingGroup('cg-leaf-third', {
    name: 'Leaf third',
    order: 0,
    parent: { kind: 'callingGroup', id: parentNext.id },
  });
  const leafFourth = callingGroup('cg-leaf-fourth', {
    name: 'Leaf fourth',
    order: 0,
    parent: { kind: 'callingGroup', id: parentLate.id },
  });
  const groups: readonly CallingGroup[] = [parentEarly, parentNext, parentLate, leafFirst, leafSecond, leafThird, leafFourth];
  const slots = [
    positioned('p-m', 'a-m', leafFirst.id, 'ln-m', 5),
    positioned('p-b', 'a-b', leafSecond.id, 'ln-b', 0),
    positioned('p-a', 'a-a', leafThird.id, 'ln-a', 0),
    positioned('p-0', 'a-0', leafFourth.id, 'ln-0', 0),
  ] as const;
  const structure = {
    version: 3,
    boardGroups: {
      [early]: { id: early, name: 'Early', order: 0, visible: true, key: null },
      [late]: { id: late, name: 'Late', order: 1, visible: true, key: null },
    },
    callingGroups: Object.fromEntries(groups.map((group) => [group.id, group])),
    assignments: Object.fromEntries(slots.map((slot) => [slot.assignment.id, slot.assignment])),
    positions: Object.fromEntries(slots.map((slot) => [slot.position.id, slot.position])),
    oversight: [],
    dugoutInclusions: [],
    approvals: [],
  };
  const baseline = valueOf(
    createBoard({ ...structure, id: boardId('b-nested-baseline'), kind: 'baseline', placements: {} }, ward),
  );
  const board = valueOf(
    createBoard(
      {
        ...structure,
        id: boardId('b-nested-board'),
        kind: 'proposal',
        placements: {
          [slots[0].position.id]: flagged.id,
          [slots[1].position.id]: flagged.id,
          [slots[2].position.id]: flagged.id,
          [slots[3].position.id]: flagged.id,
        },
      },
      ward,
    ),
  );
  const proposal = valueOf(
    createProposal(
      {
        id: proposalId('pr-nested'),
        name: 'Nested callings',
        rationale: null,
        status: 'draft',
        accepted: null,
        baseline,
        board,
        tabOrder: 0,
        createdAt: '2026-01-04T12:00:00Z',
        updatedAt: '2026-01-04T12:00:00Z',
      },
      ward,
    ),
  );
  return {
    ward,
    proposal,
    member: flagged.id,
    first: slots[0].position.id,
    second: slots[1].position.id,
    third: slots[2].position.id,
    fourth: slots[3].position.id,
  };
}

function positioned(id: string, assignmentKey: string, groupId: CallingGroup['id'], lineage: string, order: number) {
  return {
    assignment: assignment(assignmentKey, { groupId, title: assignmentKey, order: 0 }),
    position: position(id, assignmentKey, { lineageId: lineageId(lineage), order }),
  };
}
