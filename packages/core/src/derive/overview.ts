import type { BoardGroupId, CallingGroupId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, BoardGroup, CallingAssignment, CallingGroup, Position } from '../model/types.ts';
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
    const leaders: OverviewLeader[] = [];

    for (const slot of slots) {
      const occupant = board.placements[slot.position.id] ?? null;
      if (occupant !== null) {
        filledCount += 1;
      }
      if (slot.assignment.prominent) {
        leaders.push({
          positionId: slot.position.id,
          title: slot.assignment.title,
          memberId: occupant,
          proposed: proposedPositions.has(slot.position.id),
        });
      }
    }

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
