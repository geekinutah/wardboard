import { diffBoards } from '../diff/diff.ts';
import { deepFreeze } from '../model/freeze.ts';
import type { AssignmentId, BoardGroupId, CallingGroupId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, CallingAssignment, CallingGroup, Overseer, Position } from '../model/types.ts';
import { overseerOf } from '../summary/oversight.ts';

export interface OrgLeadershipCard {
  readonly positionId: PositionId;
  readonly assignmentId: AssignmentId;
  readonly title: string;
  readonly memberId: MemberId | null;
  readonly proposed: boolean;
}

export interface OrgGroupRow {
  readonly callingGroupId: CallingGroupId;
  readonly name: string;
  readonly filledCount: number;
  readonly vacantCount: number;
  readonly overseer: Overseer;
}

export interface OrganizationView {
  readonly boardGroupId: BoardGroupId;
  readonly name: string;
  readonly overseer: Overseer;
  readonly leadership: readonly OrgLeadershipCard[];
  readonly groups: readonly OrgGroupRow[];
}

function compareOrderThenId<T extends { readonly order: number; readonly id: string }>(a: T, b: T): number {
  if (a.order !== b.order) {
    return a.order - b.order;
  }
  return a.id.localeCompare(b.id, 'en');
}

function isLeadershipGroup(group: CallingGroup): boolean {
  return group.kind === 'presidency' || group.kind === 'bishopric';
}

function descendantGroupIds(board: Board, rootGroupId: CallingGroupId): Set<CallingGroupId> {
  const result = new Set<CallingGroupId>([rootGroupId]);
  let added = true;
  while (added) {
    added = false;
    for (const group of Object.values(board.callingGroups)) {
      if (group.parent.kind === 'callingGroup' && result.has(group.parent.id) && !result.has(group.id)) {
        result.add(group.id);
        added = true;
      }
    }
  }
  return result;
}

/**
 * Returns leadership cards and group summary rows for a board group.
 * Derived read model; never stored.
 */
export function organizationView(
  board: Board,
  boardGroupId: BoardGroupId,
  baseline: Board | null,
): OrganizationView {
  const boardGroup = board.boardGroups[boardGroupId];
  if (boardGroup === undefined) {
    throw new TypeError(`board group ${boardGroupId} does not exist`);
  }

  const overseer = overseerOf(board, { kind: 'boardGroup', id: boardGroupId });

  const topCallingGroups = Object.values(board.callingGroups)
    .filter((g) => g.parent.kind === 'boardGroup' && g.parent.id === boardGroupId)
    .sort(compareOrderThenId);

  const proposedPositionIds: ReadonlySet<PositionId> =
    baseline !== null
      ? new Set(diffBoards(baseline, board).callings.map((c) => c.positionId))
      : new Set();

  // Leadership groups
  const leadershipGroups = topCallingGroups.filter(isLeadershipGroup);
  const leadership: OrgLeadershipCard[] = [];

  for (const group of leadershipGroups) {
    const assignments = Object.values(board.assignments)
      .filter((a): a is CallingAssignment => a.groupId === group.id && a.enabled)
      .sort(compareOrderThenId);

    for (const assignment of assignments) {
      const positions = Object.values(board.positions)
        .filter((p): p is Position => p.assignmentId === assignment.id)
        .sort(compareOrderThenId);

      for (const pos of positions) {
        const memberId = board.placements[pos.id] ?? null;
        leadership.push({
          positionId: pos.id,
          assignmentId: assignment.id,
          title: assignment.title,
          memberId,
          proposed: proposedPositionIds.has(pos.id),
        });
      }
    }
  }

  // Rows (every other top-level calling group)
  const rowGroups = topCallingGroups.filter((g) => !isLeadershipGroup(g));
  const groups: OrgGroupRow[] = [];

  for (const group of rowGroups) {
    const subtreeIds = descendantGroupIds(board, group.id);
    const enabledAssignmentIds = new Set(
      Object.values(board.assignments)
        .filter((a) => subtreeIds.has(a.groupId) && a.enabled)
        .map((a) => a.id),
    );

    let filledCount = 0;
    let vacantCount = 0;

    for (const pos of Object.values(board.positions)) {
      if (enabledAssignmentIds.has(pos.assignmentId)) {
        if (Object.hasOwn(board.placements, pos.id)) {
          filledCount += 1;
        } else {
          vacantCount += 1;
        }
      }
    }

    groups.push({
      callingGroupId: group.id,
      name: group.name,
      filledCount,
      vacantCount,
      overseer: overseerOf(board, { kind: 'callingGroup', id: group.id }),
    });
  }

  return deepFreeze({
    boardGroupId,
    name: boardGroup.name,
    overseer,
    leadership,
    groups,
  });
}
