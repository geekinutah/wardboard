import type { BoardGroupId, CallingGroupId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, BoardGroup, BoardGroupKey, CallingAssignment, CallingGroup, Position } from '../model/types.ts';
import { diffBoards } from '../diff/index.ts';
import { rootBoardGroupOf } from './views.ts';

export interface OverviewLeader {
  readonly positionId: PositionId;
  readonly title: string;
  readonly memberId: MemberId | null;
  readonly proposed: boolean;
}

export interface OverviewTile {
  readonly boardGroupId: BoardGroupId;
  readonly name: string;
  readonly leaders: readonly OverviewLeader[];
  readonly positionCount: number;
  readonly filledCount: number;
  readonly vacantCount: number;
  readonly changeCount: number; // 0 when baseline is null
}

interface ChainLink {
  readonly order: number;
  readonly id: CallingGroupId;
}

interface GroupLocation {
  readonly boardGroupId: BoardGroupId;
  readonly boardGroupOrder: number;
  readonly chain: readonly ChainLink[];
}

interface OrderedSlot {
  readonly position: Position;
  readonly assignment: CallingAssignment;
  readonly location: GroupLocation;
}

function requireCallingGroup(board: Board, id: CallingGroupId): CallingGroup {
  const group = board.callingGroups[id];
  if (group === undefined) {
    throw new Error(`calling group ${id} does not exist`);
  }
  return group;
}

function requireBoardGroup(board: Board, id: BoardGroupId): BoardGroup {
  const group = board.boardGroups[id];
  if (group === undefined) {
    throw new Error(`board group ${id} does not exist`);
  }
  return group;
}

function locateGroup(board: Board, startId: CallingGroupId): GroupLocation {
  const ascending: CallingGroup[] = [];
  const seen = new Set<CallingGroupId>();
  let cursor: CallingGroupId = startId;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const group = requireCallingGroup(board, cursor);
    ascending.push(group);
    if (group.parent.kind === 'boardGroup') {
      const boardGroup = requireBoardGroup(board, group.parent.id);
      const chain: ChainLink[] = [];
      for (let index = ascending.length - 1; index >= 0; index -= 1) {
        const link = ascending[index];
        if (link === undefined) {
          throw new Error(`missing calling group while locating ${startId}`);
        }
        chain.push({ order: link.order, id: link.id });
      }
      return { boardGroupId: boardGroup.id, boardGroupOrder: boardGroup.order, chain };
    }
    cursor = group.parent.id;
  }
  throw new Error(`calling group ${cursor} is its own ancestor`);
}

function compareChains(left: readonly ChainLink[], right: readonly ChainLink[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftLink = left[index];
    const rightLink = right[index];
    if (leftLink === undefined || rightLink === undefined) {
      throw new Error(`missing calling-group chain link ${String(index)}`);
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

/** Board groups whose overview tile shows the presidency's three leaders. */
const LEADER_TILE_KEYS: ReadonlySet<BoardGroupKey> = new Set([
  'bishopric',
  'elders_quorum',
  'relief_society',
  'young_women',
  'primary',
  'sunday_school',
]);

function showsLeaders(key: BoardGroupKey | null): boolean {
  return key !== null && LEADER_TILE_KEYS.has(key);
}

function byOrderThenId(
  left: { readonly order: number; readonly id: string },
  right: { readonly order: number; readonly id: string },
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.id.localeCompare(right.id, 'en');
}

function childCallingGroups(board: Board, boardGroupId: BoardGroupId): CallingGroup[] {
  return Object.values(board.callingGroups).filter(
    (group) => group.parent.kind === 'boardGroup' && group.parent.id === boardGroupId,
  );
}

function isNamedPresidency(group: CallingGroup, boardGroup: BoardGroup): boolean {
  return group.name.trim().toLowerCase() === `${boardGroup.name} Presidency`.trim().toLowerCase();
}

/** The bishopric group, or the organization's own presidency. Null when neither qualifies. */
function leadershipGroup(board: Board, boardGroup: BoardGroup): CallingGroup | null {
  const children = childCallingGroups(board, boardGroup.id);
  if (boardGroup.key === 'bishopric') {
    const bishopric = children.filter((group) => group.kind === 'bishopric').sort(byOrderThenId);
    return bishopric[0] ?? null;
  }
  const presidencies = children.filter((group) => group.kind === 'presidency').sort(byOrderThenId);
  const named = presidencies.find((group) => isNamedPresidency(group, boardGroup));
  return named ?? presidencies[0] ?? null;
}

function singlePosition(board: Board, assignment: CallingAssignment): Position {
  const matches = Object.values(board.positions).filter((position) => position.assignmentId === assignment.id);
  const position = matches[0];
  if (matches.length !== 1 || position === undefined) {
    throw new Error(`single assignment ${assignment.id} does not have one position`);
  }
  return position;
}

function leaderFromAssignment(
  board: Board,
  assignment: CallingAssignment,
  proposedPositions: ReadonlySet<PositionId>,
): OverviewLeader {
  const position = singlePosition(board, assignment);
  return {
    positionId: position.id,
    title: assignment.title,
    memberId: board.placements[position.id] ?? null,
    proposed: proposedPositions.has(position.id),
  };
}

/**
 * President, then counselors in assignment order, at most three.
 * Vacancies stay. `prominent` is not read.
 */
function leadersInGroup(
  board: Board,
  leadership: CallingGroup,
  proposedPositions: ReadonlySet<PositionId>,
): OverviewLeader[] {
  const singles = Object.values(board.assignments).filter(
    (assignment) =>
      assignment.groupId === leadership.id &&
      assignment.enabled &&
      assignment.type === 'single' &&
      (assignment.leadershipRole === 'president' || assignment.leadershipRole === 'counselor'),
  );
  const presidents = singles.filter((assignment) => assignment.leadershipRole === 'president').sort(byOrderThenId);
  const counselors = singles.filter((assignment) => assignment.leadershipRole === 'counselor').sort(byOrderThenId);
  const chosen: CallingAssignment[] = [];
  const president = presidents[0];
  if (president !== undefined) {
    chosen.push(president);
  }
  for (const counselor of counselors) {
    if (chosen.length >= 3) {
      break;
    }
    chosen.push(counselor);
  }
  return chosen.map((assignment) => leaderFromAssignment(board, assignment, proposedPositions));
}

function tileLeaders(
  board: Board,
  boardGroup: BoardGroup,
  proposedPositions: ReadonlySet<PositionId>,
): OverviewLeader[] {
  if (!showsLeaders(boardGroup.key)) {
    return [];
  }
  const leadership = leadershipGroup(board, boardGroup);
  if (leadership === null) {
    return [];
  }
  return leadersInGroup(board, leadership, proposedPositions);
}

function compareSlots(left: OrderedSlot, right: OrderedSlot): number {
  if (left.location.boardGroupOrder !== right.location.boardGroupOrder) {
    return left.location.boardGroupOrder - right.location.boardGroupOrder;
  }
  const byBoardGroup = left.location.boardGroupId.localeCompare(right.location.boardGroupId, 'en');
  if (byBoardGroup !== 0) {
    return byBoardGroup;
  }
  const byChain = compareChains(left.location.chain, right.location.chain);
  if (byChain !== 0) {
    return byChain;
  }
  if (left.assignment.order !== right.assignment.order) {
    return left.assignment.order - right.assignment.order;
  }
  const byAssignment = left.assignment.id.localeCompare(right.assignment.id, 'en');
  if (byAssignment !== 0) {
    return byAssignment;
  }
  if (left.position.order !== right.position.order) {
    return left.position.order - right.position.order;
  }
  return left.position.id.localeCompare(right.position.id, 'en');
}

export function wardOverview(board: Board, baseline: Board | null): readonly OverviewTile[] {
  // Visible board groups ordered by order, then id
  const visibleBoardGroups = Object.values(board.boardGroups)
    .filter((g) => g.visible)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));

  if (visibleBoardGroups.length === 0) {
    return [];
  }

  // Pre-calculate diff if baseline is provided
  const changeCounts = new Map<BoardGroupId, number>();
  const proposedPositions = new Set<PositionId>();

  if (baseline !== null) {
    const diff = diffBoards(baseline, board);

    for (const calling of diff.callings) {
      proposedPositions.add(calling.positionId);
      const assignment = board.assignments[calling.assignmentId];
      if (assignment !== undefined) {
        const bgId = rootBoardGroupOf(board, assignment.groupId);
        changeCounts.set(bgId, (changeCounts.get(bgId) ?? 0) + 1);
      }
    }

    for (const added of diff.addedPositions) {
      const assignment = board.assignments[added.assignmentId];
      if (assignment !== undefined) {
        const bgId = rootBoardGroupOf(board, assignment.groupId);
        changeCounts.set(bgId, (changeCounts.get(bgId) ?? 0) + 1);
      }
    }

    for (const release of diff.releases) {
      const assignment = baseline.assignments[release.assignmentId];
      if (assignment !== undefined) {
        const bgId = rootBoardGroupOf(baseline, assignment.groupId);
        changeCounts.set(bgId, (changeCounts.get(bgId) ?? 0) + 1);
      }
    }

    for (const removed of diff.removedPositions) {
      const assignment = baseline.assignments[removed.assignmentId];
      if (assignment !== undefined) {
        const bgId = rootBoardGroupOf(baseline, assignment.groupId);
        changeCounts.set(bgId, (changeCounts.get(bgId) ?? 0) + 1);
      }
    }
  }

  // Map each position of an enabled assignment to its location
  const slotsByBoardGroup = new Map<BoardGroupId, OrderedSlot[]>();
  for (const group of visibleBoardGroups) {
    slotsByBoardGroup.set(group.id, []);
  }

  for (const position of Object.values(board.positions)) {
    const assignment = board.assignments[position.assignmentId];
    if (assignment === undefined || !assignment.enabled) {
      continue;
    }
    const location = locateGroup(board, assignment.groupId);
    const slots = slotsByBoardGroup.get(location.boardGroupId);
    if (slots !== undefined) {
      slots.push({ position, assignment, location });
    }
  }

  return visibleBoardGroups.map((group): OverviewTile => {
    const slots = slotsByBoardGroup.get(group.id) ?? [];
    slots.sort(compareSlots);

    const positionCount = slots.length;
    let filledCount = 0;

    for (const slot of slots) {
      const occupant = board.placements[slot.position.id] ?? null;
      if (occupant !== null) {
        filledCount += 1;
      }
    }

    const leaders = tileLeaders(board, group, proposedPositions);

    const vacantCount = positionCount - filledCount;
    const changeCount = changeCounts.get(group.id) ?? 0;

    return {
      boardGroupId: group.id,
      name: group.name,
      leaders,
      positionCount,
      filledCount,
      vacantCount,
      changeCount,
    };
  });
}
