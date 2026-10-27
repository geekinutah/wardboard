import type { AssignmentId, BoardGroupId, CallingGroupId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, BoardGroup, CallingAssignment, CallingGroup, Member, Position, Ward } from '../model/types.ts';
import type { DugoutEntry, HeldCalling, Vacancy } from './types.ts';

/*
 * Read model for a board (SPEC §4, §5, §7, §8): vacancies, held callings,
 * dugout membership, and vacancy counts. Derived, never stored. Inputs are
 * assumed valid and are not mutated.
 */

interface ChainLink {
  readonly order: number;
  readonly id: CallingGroupId;
}

/** Board group plus the calling-group chain from that board group down to this group. */
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

function requireAssignment(board: Board, id: AssignmentId): CallingAssignment {
  const assignment = board.assignments[id];
  if (assignment === undefined) {
    throw new Error(`assignment ${id} does not exist`);
  }
  return assignment;
}

function occupantOf(board: Board, id: PositionId): MemberId | undefined {
  if (!Object.hasOwn(board.placements, id)) {
    return undefined;
  }
  return board.placements[id];
}

/**
 * Walks parent links to the board group. `chain` starts at the calling group
 * whose parent is that board group. Valid boards are acyclic; the seen-set
 * only guarantees this walk terminates.
 */
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

/**
 * An ancestor chain is a prefix of its descendant and sorts first. Equal orders
 * at the first difference break on that level's calling-group id.
 */
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

function orderedSlots(board: Board, include: (position: Position, assignment: CallingAssignment) => boolean): readonly OrderedSlot[] {
  const slots: OrderedSlot[] = [];
  for (const position of Object.values(board.positions)) {
    const assignment = requireAssignment(board, position.assignmentId);
    if (include(position, assignment)) {
      slots.push({ position, assignment, location: locateGroup(board, assignment.groupId) });
    }
  }
  return slots.slice().sort(compareSlots);
}

/** Every unfilled position of an enabled assignment, in board-structure order. */
export function vacancies(board: Board): readonly Vacancy[] {
  return orderedSlots(board, (position, assignment) => assignment.enabled && occupantOf(board, position.id) === undefined).map(
    (slot): Vacancy => ({
      positionId: slot.position.id,
      assignmentId: slot.assignment.id,
      callingGroupId: slot.assignment.groupId,
      boardGroupId: slot.location.boardGroupId,
    }),
  );
}

/** Every position `member` occupies, including disabled assignments, in board-structure order. */
export function callingsOf(board: Board, member: MemberId): readonly HeldCalling[] {
  return orderedSlots(board, (position) => occupantOf(board, position.id) === member).map(
    (slot): HeldCalling => ({
      positionId: slot.position.id,
      assignmentId: slot.assignment.id,
      title: slot.assignment.title,
      callingGroupId: slot.assignment.groupId,
      boardGroupId: slot.location.boardGroupId,
    }),
  );
}

/** Positions held per member. Members with zero callings are absent. */
export function callingCounts(board: Board): ReadonlyMap<MemberId, number> {
  const counts = new Map<MemberId, number>();
  for (const member of Object.values(board.placements)) {
    counts.set(member, (counts.get(member) ?? 0) + 1);
  }
  return counts;
}

function compareMembers(left: Member, right: Member): number {
  const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
  if (byName !== 0) {
    return byName;
  }
  return left.id.localeCompare(right.id, 'en');
}

/**
 * Automatic dugout membership is current ward members with no position on this
 * board. Removed members join only through `dugoutInclusions`. A member in both
 * sets appears once, with `explicit: true`, and keeps any remaining callings.
 */
export function dugout(board: Board, ward: Ward): readonly DugoutEntry[] {
  const holders = new Set<MemberId>(Object.values(board.placements));
  const explicit = new Set<MemberId>(board.dugoutInclusions);
  const selected: Member[] = [];
  for (const person of Object.values(ward.members)) {
    const included = explicit.has(person.id);
    const automatic = person.removedDate === null && !holders.has(person.id);
    if (included || automatic) {
      selected.push(person);
    }
  }
  return selected
    .slice()
    .sort(compareMembers)
    .map((person) => ({
      memberId: person.id,
      explicit: explicit.has(person.id),
      callings: callingsOf(board, person.id),
    }));
}

/** Vacancy count for every board group on `board`, including zeros and hidden groups. */
export function vacancyCountsByBoardGroup(board: Board): ReadonlyMap<BoardGroupId, number> {
  const counts = new Map<BoardGroupId, number>();
  for (const group of Object.values(board.boardGroups)) {
    counts.set(group.id, 0);
  }
  for (const vacancy of vacancies(board)) {
    counts.set(vacancy.boardGroupId, (counts.get(vacancy.boardGroupId) ?? 0) + 1);
  }
  return counts;
}

/** Board group at the root of `callingGroupId`'s parent chain. */
export function rootBoardGroupOf(board: Board, callingGroupId: CallingGroupId): BoardGroupId {
  return locateGroup(board, callingGroupId).boardGroupId;
}
