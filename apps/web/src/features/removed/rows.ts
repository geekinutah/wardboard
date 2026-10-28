import { removedState, type Board, type MemberId, type PositionId, type Proposal, type Ward } from '@wardboard/core';

/** One removed placement as displayed on a removed member's row. */
export type RemovedRowPosition = {
  readonly positionId: PositionId;
  readonly title: string;
  readonly groupName: string;
};

/** One display row for a ward member whose `removed_date` is non-null (SPEC §8). */
export type RemovedMemberRow = {
  readonly memberId: MemberId;
  readonly name: string;
  readonly removedDate: string;
  readonly positions: readonly RemovedRowPosition[];
};

/** One display row for a proposal position whose lineage no longer exists in Current. */
export type RemovedPositionRow = {
  readonly positionId: PositionId;
  readonly title: string;
  readonly groupName: string;
  readonly occupantName: string | null;
};

/**
 * Display rows for the removed summary. `total` is the number of affected
 * members plus the number of affected positions (not the number of lines).
 */
export type RemovedRows = {
  readonly members: readonly RemovedMemberRow[];
  readonly positions: readonly RemovedPositionRow[];
  readonly total: number;
};

/**
 * Turns core's `removedState` into display rows. Nothing here decides what
 * counts as removed: core is the single source of the removal rules (SPEC §8).
 */
export function removedRows(proposal: Proposal, current: Board, ward: Ward): RemovedRows {
  const state = removedState(proposal, current, ward);
  const board = proposal.board;

  function titleAndGroup(positionId: PositionId): { title: string; groupName: string } {
    const slot = board.positions[positionId];
    if (slot === undefined) {
      throw new Error(`position ${positionId} is missing from the proposal board`);
    }
    const assignment = board.assignments[slot.assignmentId];
    if (assignment === undefined) {
      throw new Error(`assignment ${slot.assignmentId} is missing from the proposal board`);
    }
    const group = board.callingGroups[assignment.groupId];
    if (group === undefined) {
      throw new Error(`calling group ${assignment.groupId} is missing from the proposal board`);
    }
    return { title: assignment.title, groupName: group.name };
  }

  const members = state.members.map(({ memberId, positionIds }) => {
    const member = ward.members[memberId];
    if (member === undefined) {
      throw new Error(`member ${memberId} is missing from the ward`);
    }
    if (member.removedDate === null) {
      throw new Error(`member ${memberId} is not removed`);
    }
    return {
      memberId,
      name: member.name,
      removedDate: member.removedDate,
      positions: positionIds.map((positionId) => ({ positionId, ...titleAndGroup(positionId) })),
    };
  });

  const positions = state.positions.map((positionId) => {
    const occupantId = board.placements[positionId];
    const occupant = occupantId === undefined ? null : ward.members[occupantId] ?? null;
    return {
      positionId,
      ...titleAndGroup(positionId),
      occupantName: occupant === null ? null : occupant.name,
    };
  });

  return {
    members,
    positions,
    total: members.length + positions.length,
  };
}
