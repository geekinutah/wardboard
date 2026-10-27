import type { CallingGroupId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, BoardInput, CallingAssignment, CallingGroup } from '../model/types.ts';

/*
 * Presidency release (SPEC §5). A president is released when member M occupied
 * a president position beforehand and does not occupy it afterwards, including
 * when that position was deleted. Counselors and the secretary of that same
 * calling group are vacated with them. A seat this operation filled with
 * someone else is kept. Other callings and explicit dugout inclusions stay.
 * Nested groups are a different presidency. The rule does not fail an operation.
 */

export interface PresidencyRelease {
  readonly memberId: MemberId;
  readonly positionId: PositionId;
}

interface ChainLink {
  readonly order: number;
  readonly id: string;
}

interface LocatedGroup {
  readonly boardGroupOrder: number;
  readonly boardGroupId: string;
  readonly chain: readonly ChainLink[];
}

interface StructuralKey {
  readonly boardGroupOrder: number;
  readonly boardGroupId: string;
  readonly chain: readonly ChainLink[];
  readonly assignmentOrder: number;
  readonly assignmentId: string;
  readonly positionOrder: number;
  readonly positionId: string;
}

function occupantOf(placements: Board['placements'], id: PositionId): MemberId | undefined {
  if (!Object.hasOwn(placements, id)) {
    return undefined;
  }
  return placements[id];
}

function isPresident(assignment: CallingAssignment): boolean {
  return assignment.type === 'single' && assignment.leadershipRole === 'president';
}

function isReleasedWithPresident(assignment: CallingAssignment): boolean {
  return assignment.type === 'single' && (assignment.leadershipRole === 'counselor' || assignment.leadershipRole === 'secretary');
}

/** Calling groups whose president no longer holds that position. */
function releasedGroups(before: Board, after: BoardInput): ReadonlySet<CallingGroupId> {
  const groups = new Set<CallingGroupId>();
  for (const position of Object.values(before.positions)) {
    const assignment = before.assignments[position.assignmentId];
    if (assignment === undefined || !isPresident(assignment)) {
      continue;
    }
    const member = occupantOf(before.placements, position.id);
    if (member === undefined) {
      continue;
    }
    if (occupantOf(after.placements, position.id) !== member) {
      groups.add(assignment.groupId);
    }
  }
  return groups;
}

/**
 * Counselor and secretary seats of a released presidency that the rule clears.
 * A seat still held is cleared now. A seat already empty, and still on the
 * board, was cleared by an earlier pass — so reporting stays stable after the
 * rule runs. A seat filled with a different member was placed by this operation.
 */
function cascadeReleases(before: Board, after: BoardInput): PresidencyRelease[] {
  const groups = releasedGroups(before, after);
  const releases: PresidencyRelease[] = [];
  if (groups.size === 0) {
    return releases;
  }
  for (const position of Object.values(before.positions)) {
    const assignment = before.assignments[position.assignmentId];
    if (assignment === undefined || !isReleasedWithPresident(assignment) || !groups.has(assignment.groupId)) {
      continue;
    }
    const member = occupantOf(before.placements, position.id);
    if (member === undefined) {
      continue;
    }
    const current = occupantOf(after.placements, position.id);
    const stillHeld = current === member;
    const alreadyCleared = current === undefined && Object.hasOwn(after.positions, position.id);
    if (stillHeld || alreadyCleared) {
      releases.push({ memberId: member, positionId: position.id });
    }
  }
  releases.sort((left, right) => compareKeys(structuralKey(before, left.positionId), structuralKey(before, right.positionId)));
  return releases;
}

function locateGroup(board: Board, startId: CallingGroupId): LocatedGroup | null {
  const ascending: CallingGroup[] = [];
  const seen = new Set<string>();
  let cursor: CallingGroupId = startId;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const group = board.callingGroups[cursor];
    if (group === undefined) {
      return null;
    }
    ascending.push(group);
    if (group.parent.kind === 'boardGroup') {
      const boardGroup = board.boardGroups[group.parent.id];
      if (boardGroup === undefined) {
        return null;
      }
      const chain: ChainLink[] = [];
      for (let index = ascending.length - 1; index >= 0; index -= 1) {
        const link = ascending[index];
        if (link === undefined) {
          return null;
        }
        chain.push({ order: link.order, id: link.id });
      }
      return { boardGroupOrder: boardGroup.order, boardGroupId: boardGroup.id, chain };
    }
    cursor = group.parent.id;
  }
  return null;
}

function fallbackKey(id: string): StructuralKey {
  return {
    boardGroupOrder: Number.MAX_SAFE_INTEGER,
    boardGroupId: '',
    chain: [],
    assignmentOrder: Number.MAX_SAFE_INTEGER,
    assignmentId: '',
    positionOrder: Number.MAX_SAFE_INTEGER,
    positionId: id,
  };
}

/** Board group, calling-group chain, assignment, then position. Matches derived board order. */
function structuralKey(board: Board, id: PositionId): StructuralKey {
  const position = board.positions[id];
  if (position === undefined) {
    return fallbackKey(id);
  }
  const assignment = board.assignments[position.assignmentId];
  if (assignment === undefined) {
    return fallbackKey(position.id);
  }
  const located = locateGroup(board, assignment.groupId);
  if (located === null) {
    return {
      ...fallbackKey(position.id),
      assignmentOrder: assignment.order,
      assignmentId: assignment.id,
      positionOrder: position.order,
    };
  }
  return {
    boardGroupOrder: located.boardGroupOrder,
    boardGroupId: located.boardGroupId,
    chain: located.chain,
    assignmentOrder: assignment.order,
    assignmentId: assignment.id,
    positionOrder: position.order,
    positionId: position.id,
  };
}

function compareChains(left: readonly ChainLink[], right: readonly ChainLink[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftLink = left[index];
    const rightLink = right[index];
    if (leftLink === undefined || rightLink === undefined) {
      return 0;
    }
    if (leftLink.order !== rightLink.order) {
      return leftLink.order - rightLink.order;
    }
    const byId = leftLink.id.localeCompare(rightLink.id, 'en');
    if (byId !== 0) {
      return byId;
    }
  }
  return left.length - right.length;
}

function compareKeys(left: StructuralKey, right: StructuralKey): number {
  if (left.boardGroupOrder !== right.boardGroupOrder) {
    return left.boardGroupOrder - right.boardGroupOrder;
  }
  const byBoardGroup = left.boardGroupId.localeCompare(right.boardGroupId, 'en');
  if (byBoardGroup !== 0) {
    return byBoardGroup;
  }
  const byChain = compareChains(left.chain, right.chain);
  if (byChain !== 0) {
    return byChain;
  }
  if (left.assignmentOrder !== right.assignmentOrder) {
    return left.assignmentOrder - right.assignmentOrder;
  }
  const byAssignment = left.assignmentId.localeCompare(right.assignmentId, 'en');
  if (byAssignment !== 0) {
    return byAssignment;
  }
  if (left.positionOrder !== right.positionOrder) {
    return left.positionOrder - right.positionOrder;
  }
  return left.positionId.localeCompare(right.positionId, 'en');
}

/**
 * Vacates counselor and secretary seats released with a president.
 * Returns `after` unchanged when there is nothing left to clear, so a second
 * pass is the same value.
 */
export function applyPresidencyRelease(before: Board, after: BoardInput): BoardInput {
  const removing = cascadeReleases(before, after).filter((release) => occupantOf(after.placements, release.positionId) !== undefined);
  if (removing.length === 0) {
    return after;
  }
  const removed = new Set<string>(removing.map((release) => release.positionId));
  const placements: Record<PositionId, MemberId> = Object.fromEntries(
    Object.entries(after.placements).filter(([id]) => !removed.has(id)),
  );
  return { ...after, placements };
}

/** Counselor and secretary placements the rule removed, in board structural order. */
export function presidencyReleases(before: Board, after: Board): readonly PresidencyRelease[] {
  return cascadeReleases(before, after);
}
