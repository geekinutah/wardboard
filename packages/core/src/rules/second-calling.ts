import { positionId, type AssignmentId, type CallingGroupId, type MemberId, type PositionId } from '../model/ids.ts';
import type { Board, CallingGroup, ExternalCalling, Ward } from '../model/types.ts';

/** A calling the member already held and still holds after the operation. */
export interface ExistingCalling {
  readonly positionId: PositionId;
  readonly assignmentId: AssignmentId;
  readonly title: string;
}

/**
 * A member whose calling count would increase and end above one.
 * `existing` names the callings they keep, not the ones just added.
 */
export interface SecondCallingNotice {
  readonly memberId: MemberId;
  readonly countBefore: number;
  readonly countAfter: number;
  readonly existing: readonly ExistingCalling[];
}

/** General Handbook guidance shown with a second-calling confirmation. SPEC §3. */
export const ONE_CALLING_GUIDANCE = {
  source: 'General Handbook 30.1.1',
  text: 'A member generally serves in only one calling at a time.',
} as const;

interface SlotKey {
  readonly boardGroupOrder: number;
  /** Root-first calling-group orders. A shorter chain is an ancestor and sorts first. */
  readonly chainOrders: readonly number[];
  readonly assignmentOrder: number;
  readonly positionOrder: number;
  readonly id: PositionId;
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * An ancestor chain is a prefix of its descendant and sorts first, so a group's
 * own assignments precede nested groups. Equal orders continue along the chain.
 */
function compareChains(left: readonly number[], right: readonly number[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const leftOrder = left[index];
    const rightOrder = right[index];
    if (leftOrder === undefined || rightOrder === undefined) {
      throw new Error(`missing calling-group chain order ${String(index)}`);
    }
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
  }
  return left.length - right.length;
}

function compareSlots(left: SlotKey, right: SlotKey): number {
  if (left.boardGroupOrder !== right.boardGroupOrder) {
    return left.boardGroupOrder - right.boardGroupOrder;
  }
  const byChain = compareChains(left.chainOrders, right.chainOrders);
  if (byChain !== 0) {
    return byChain;
  }
  if (left.assignmentOrder !== right.assignmentOrder) {
    return left.assignmentOrder - right.assignmentOrder;
  }
  if (left.positionOrder !== right.positionOrder) {
    return left.positionOrder - right.positionOrder;
  }
  return compareIds(left.id, right.id);
}

function requireCallingGroup(board: Board, id: CallingGroupId): CallingGroup {
  const group = board.callingGroups[id];
  if (group === undefined) {
    throw new Error(`calling group ${id} does not exist`);
  }
  return group;
}

/**
 * Board-group order plus calling-group orders from that board group down to
 * `startId`. Valid boards are acyclic; the seen-set only guarantees termination.
 */
function locateGroup(board: Board, startId: CallingGroupId): { readonly boardGroupOrder: number; readonly chainOrders: readonly number[] } {
  const ascending: CallingGroup[] = [];
  const seen = new Set<CallingGroupId>();
  let cursor: CallingGroupId = startId;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const group = requireCallingGroup(board, cursor);
    ascending.push(group);
    if (group.parent.kind === 'boardGroup') {
      const boardGroup = board.boardGroups[group.parent.id];
      if (boardGroup === undefined) {
        throw new Error(`board group ${group.parent.id} does not exist`);
      }
      const chainOrders: number[] = [];
      for (let index = ascending.length - 1; index >= 0; index -= 1) {
        const link = ascending[index];
        if (link === undefined) {
          throw new Error(`missing calling group while locating ${startId}`);
        }
        chainOrders.push(link.order);
      }
      return { boardGroupOrder: boardGroup.order, chainOrders };
    }
    cursor = group.parent.id;
  }
  throw new Error(`calling group ${cursor} is its own ancestor`);
}

function slotKey(board: Board, id: PositionId): { readonly key: SlotKey; readonly calling: ExistingCalling } {
  const position = board.positions[id];
  if (position === undefined) {
    throw new Error(`position ${id} does not exist`);
  }
  const assignment = board.assignments[position.assignmentId];
  if (assignment === undefined) {
    throw new Error(`assignment ${position.assignmentId} does not exist`);
  }
  const location = locateGroup(board, assignment.groupId);
  return {
    key: {
      boardGroupOrder: location.boardGroupOrder,
      chainOrders: location.chainOrders,
      assignmentOrder: assignment.order,
      positionOrder: position.order,
      id,
    },
    calling: { positionId: id, assignmentId: assignment.id, title: assignment.title },
  };
}

/** Positions each member occupies. Disabled assignments count; oversight and dugout do not. */
function positionsHeld(board: Board): Map<MemberId, PositionId[]> {
  const held = new Map<MemberId, PositionId[]>();
  for (const [key, member] of Object.entries(board.placements)) {
    const id = positionId(key);
    const positions = held.get(member);
    if (positions === undefined) {
      held.set(member, [id]);
    } else {
      positions.push(id);
    }
  }
  return held;
}

/**
 * Reports every member who would end up with more callings than before and more
 * than one in total. Never blocks. `before` and `after` must be the same board id.
 */
export function secondCallingNotices(before: Board, after: Board): readonly SecondCallingNotice[] {
  if (before.id !== after.id) {
    throw new TypeError(`before and after are different boards (${before.id} and ${after.id})`);
  }
  const beforeHeld = positionsHeld(before);
  const afterHeld = positionsHeld(after);
  const memberIds = [...new Set<MemberId>([...beforeHeld.keys(), ...afterHeld.keys()])].sort(compareIds);
  const notices: SecondCallingNotice[] = [];
  for (const memberId of memberIds) {
    const beforePositions = beforeHeld.get(memberId) ?? [];
    const afterPositions = afterHeld.get(memberId) ?? [];
    const countBefore = beforePositions.length;
    const countAfter = afterPositions.length;
    if (countAfter <= countBefore || countAfter <= 1) {
      continue;
    }
    const kept = new Set<PositionId>(beforePositions);
    const existing = afterPositions
      .filter((id) => kept.has(id))
      .map((id) => slotKey(after, id))
      .sort((left, right) => compareSlots(left.key, right.key))
      .map((slot) => slot.calling);
    notices.push({ memberId, countBefore, countAfter, existing });
  }
  return notices;
}

export interface OutsideAwareNotice extends SecondCallingNotice {
  /** The member's outside callings, which count toward countBefore/countAfter. */
  readonly outside: readonly ExternalCalling[];
}

function outsideCallings(ward: Ward, id: MemberId): readonly ExternalCalling[] {
  const member = ward.members[id];
  if (member === undefined) {
    return [];
  }
  return member.externalCallings;
}

/**
 * Like `secondCallingNotices`, but each member's outside callings count toward
 * both totals and are listed on the notice. An unknown member id counts as
 * zero outside callings. `before` and `after` must be the same board id.
 */
export function secondCallingNoticesWithOutside(before: Board, after: Board, ward: Ward): readonly OutsideAwareNotice[] {
  if (before.id !== after.id) {
    throw new TypeError(`before and after are different boards (${before.id} and ${after.id})`);
  }
  const beforeHeld = positionsHeld(before);
  const afterHeld = positionsHeld(after);
  const memberIds = [...new Set<MemberId>([...beforeHeld.keys(), ...afterHeld.keys()])].sort(compareIds);
  const notices: OutsideAwareNotice[] = [];
  for (const memberId of memberIds) {
    const beforePositions = beforeHeld.get(memberId) ?? [];
    const afterPositions = afterHeld.get(memberId) ?? [];
    const outside = outsideCallings(ward, memberId);
    const countBefore = beforePositions.length + outside.length;
    const countAfter = afterPositions.length + outside.length;
    if (countAfter <= countBefore || countAfter <= 1) {
      continue;
    }
    const kept = new Set<PositionId>(beforePositions);
    const existing = afterPositions
      .filter((id) => kept.has(id))
      .map((id) => slotKey(after, id))
      .sort((left, right) => compareSlots(left.key, right.key))
      .map((slot) => slot.calling);
    notices.push({ memberId, countBefore, countAfter, existing, outside });
  }
  return notices;
}
