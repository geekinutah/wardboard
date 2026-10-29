import type { Board, BoardId } from '@wardboard/core';

/**
 * The Current board a ward's first import plans against: version 0 and no
 * structure, placements, oversight, approvals or dugout inclusions. The import
 * planner creates every group, calling and position the reports supply.
 */
export function emptyCurrentBoard(id: BoardId): Board {
  return {
    id,
    kind: 'current',
    version: 0,
    boardGroups: {},
    callingGroups: {},
    assignments: {},
    positions: {},
    placements: {},
    oversight: [],
    dugoutInclusions: [],
    approvals: [],
  };
}
