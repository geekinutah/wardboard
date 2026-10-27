import { diffBoards } from '../diff/diff.ts';
import { deepFreeze } from '../model/freeze.ts';
import type { AssignmentId, BoardGroupId, CallingGroupId, MemberId, PositionId, TagId } from '../model/ids.ts';
import type { Board, CallingAssignment, CallingGroup, Position, Ward } from '../model/types.ts';
import { preferenceMatches as matchingPreferredTags } from '../tags/tags.ts';

export interface DetailPosition {
  readonly positionId: PositionId;
  readonly memberId: MemberId | null;
  readonly proposed: boolean;
  readonly preferenceMatches: readonly TagId[];
}

export interface DetailAssignment {
  readonly assignmentId: AssignmentId;
  readonly title: string;
  readonly type: CallingAssignment['type'];
  readonly callingTagIds: readonly TagId[];
  readonly preferredMemberTagIds: readonly TagId[];
  readonly positions: readonly DetailPosition[];
  readonly filledCount: number;
}

export interface DetailSection {
  readonly callingGroupId: CallingGroupId;
  readonly name: string;
  readonly depth: number;
  readonly assignments: readonly DetailAssignment[];
}

export interface GroupDetail {
  readonly callingGroupId: CallingGroupId;
  readonly name: string;
  readonly boardGroupId: BoardGroupId;
  readonly sections: readonly DetailSection[];
  readonly disabledAssignmentCount: number;
}

function compareOrderThenId<T extends { readonly order: number; readonly id: string }>(left: T, right: T): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.id.localeCompare(right.id, 'en');
}

function occupantOf(board: Board, id: PositionId): MemberId | null {
  if (!Object.hasOwn(board.placements, id)) {
    return null;
  }
  return board.placements[id] ?? null;
}

function boardGroupIdOf(board: Board, start: CallingGroup): BoardGroupId {
  const seen = new Set<string>();
  let current = start;
  while (!seen.has(current.id)) {
    seen.add(current.id);
    if (current.parent.kind === 'boardGroup') {
      return current.parent.id;
    }
    const parent = board.callingGroups[current.parent.id];
    if (parent === undefined) {
      throw new TypeError(`calling group ${current.parent.id} does not exist`);
    }
    current = parent;
  }
  throw new TypeError(`calling group ${start.id} is its own ancestor`);
}

function childGroups(board: Board, parentId: CallingGroupId): CallingGroup[] {
  return Object.values(board.callingGroups)
    .filter((group) => group.parent.kind === 'callingGroup' && group.parent.id === parentId)
    .sort(compareOrderThenId);
}

function enabledAssignments(board: Board, groupId: CallingGroupId): CallingAssignment[] {
  return Object.values(board.assignments)
    .filter((assignment) => assignment.groupId === groupId && assignment.enabled)
    .sort(compareOrderThenId);
}

function orderedPositions(board: Board, assignmentId: AssignmentId): Position[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === assignmentId)
    .sort(compareOrderThenId);
}

function disabledInGroup(board: Board, groupId: CallingGroupId): number {
  let count = 0;
  for (const assignment of Object.values(board.assignments)) {
    if (assignment.groupId === groupId && !assignment.enabled) {
      count += 1;
    }
  }
  return count;
}

function detailAssignment(
  board: Board,
  ward: Ward,
  assignment: CallingAssignment,
  proposedIds: ReadonlySet<PositionId>,
): DetailAssignment {
  const positions = orderedPositions(board, assignment.id).map((position) => {
    const memberId = occupantOf(board, position.id);
    const preferenceMatches =
      memberId === null ? [] : matchingPreferredTags(board, ward, assignment.id, memberId).slice();
    return {
      positionId: position.id,
      memberId,
      proposed: proposedIds.has(position.id),
      preferenceMatches,
    };
  });
  let filledCount = 0;
  for (const position of positions) {
    if (position.memberId !== null) {
      filledCount += 1;
    }
  }
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    type: assignment.type,
    callingTagIds: assignment.callingTagIds.slice(),
    preferredMemberTagIds: assignment.preferredMemberTagIds.slice(),
    positions,
    filledCount,
  };
}

interface CollectedSections {
  readonly sections: DetailSection[];
  readonly disabled: number;
}

function collectSections(
  board: Board,
  ward: Ward,
  group: CallingGroup,
  depth: number,
  proposedIds: ReadonlySet<PositionId>,
): CollectedSections {
  const sections: DetailSection[] = [
    {
      callingGroupId: group.id,
      name: group.name,
      depth,
      assignments: enabledAssignments(board, group.id).map((assignment) =>
        detailAssignment(board, ward, assignment, proposedIds),
      ),
    },
  ];
  let disabled = disabledInGroup(board, group.id);
  for (const child of childGroups(board, group.id)) {
    const nested = collectSections(board, ward, child, depth + 1, proposedIds);
    sections.push(...nested.sections);
    disabled += nested.disabled;
  }
  return { sections, disabled };
}

/**
 * Describes one calling group: itself at depth 0, then nested groups in
 * depth-first order. Disabled assignments are counted and omitted.
 * `proposed` is a net calling against `baseline`, never when baseline is null.
 */
export function groupDetail(
  board: Board,
  ward: Ward,
  callingGroupId: CallingGroupId,
  baseline: Board | null,
): GroupDetail {
  if (!Object.hasOwn(board.callingGroups, callingGroupId)) {
    throw new TypeError(`calling group ${callingGroupId} does not exist`);
  }
  const group = board.callingGroups[callingGroupId];
  if (group === undefined) {
    throw new TypeError(`calling group ${callingGroupId} does not exist`);
  }

  const proposedIds: ReadonlySet<PositionId> =
    baseline === null ? new Set() : new Set(diffBoards(baseline, board).callings.map((calling) => calling.positionId));
  const collected = collectSections(board, ward, group, 0, proposedIds);

  return deepFreeze({
    callingGroupId: group.id,
    name: group.name,
    boardGroupId: boardGroupIdOf(board, group),
    sections: collected.sections,
    disabledAssignmentCount: collected.disabled,
  });
}
