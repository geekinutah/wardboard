import { deepFreeze } from '../model/freeze.ts';
import type { AssignmentId, BoardGroupId, CallingGroupId, LineageId, MemberId, PositionId } from '../model/ids.ts';
import type { Board, CallingAssignment, CallingGroup, Position, Proposal } from '../model/types.ts';
import type { DiffPlacement, DiffPosition, NetDiff } from './types.ts';

/*
 * Net diff between two boards (SPEC §3, §5, §7, §8). Positions match across
 * boards by lineage. A "calling" is a single's lineage, or a whole list.
 * Pure: inputs are never mutated and the result is deeply frozen.
 */

interface ChainLink {
  readonly order: number;
  readonly id: CallingGroupId;
}

interface Slot {
  readonly position: Position;
  readonly assignment: CallingAssignment;
  readonly boardGroupId: BoardGroupId;
  readonly boardGroupOrder: number;
  readonly chain: readonly ChainLink[];
}

function locate(board: Board, startId: CallingGroupId): { boardGroupId: BoardGroupId; boardGroupOrder: number; chain: ChainLink[] } {
  const ascending: CallingGroup[] = [];
  const seen = new Set<CallingGroupId>();
  let cursor = startId;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const group = board.callingGroups[cursor];
    if (group === undefined) {
      throw new Error(`calling group ${cursor} does not exist`);
    }
    ascending.push(group);
    if (group.parent.kind === 'boardGroup') {
      const boardGroup = board.boardGroups[group.parent.id];
      if (boardGroup === undefined) {
        throw new Error(`board group ${group.parent.id} does not exist`);
      }
      const chain = ascending.reverse().map((link): ChainLink => ({ order: link.order, id: link.id }));
      return { boardGroupId: boardGroup.id, boardGroupOrder: boardGroup.order, chain };
    }
    cursor = group.parent.id;
  }
  throw new Error(`calling group ${cursor} is its own ancestor`);
}

function compareChains(left: readonly ChainLink[], right: readonly ChainLink[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) {
      throw new Error(`missing calling-group chain link ${String(index)}`);
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    const byId = a.id.localeCompare(b.id, 'en');
    if (byId !== 0) {
      return byId;
    }
  }
  return left.length - right.length;
}

/** Same structural order the derived views use: board group, group chain, assignment, position. */
function compareSlots(left: Slot, right: Slot): number {
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

function orderedSlots(board: Board): readonly Slot[] {
  const slots: Slot[] = [];
  for (const position of Object.values(board.positions)) {
    const assignment = board.assignments[position.assignmentId];
    if (assignment === undefined) {
      throw new Error(`assignment ${position.assignmentId} does not exist`);
    }
    slots.push({ position, assignment, ...locate(board, assignment.groupId) });
  }
  return slots.sort(compareSlots);
}

function occupantOf(board: Board, id: PositionId): MemberId | undefined {
  return Object.hasOwn(board.placements, id) ? board.placements[id] : undefined;
}

function minLineage(lineages: readonly LineageId[]): LineageId | undefined {
  return lineages.slice().sort((a, b) => a.localeCompare(b, 'en'))[0];
}

/** Lineages of every list assignment on a board, by assignment. */
function listLineages(board: Board): ReadonlyMap<AssignmentId, readonly LineageId[]> {
  const lists = new Map<AssignmentId, LineageId[]>();
  for (const position of Object.values(board.positions)) {
    if (board.assignments[position.assignmentId]?.type === 'list') {
      lists.set(position.assignmentId, [...(lists.get(position.assignmentId) ?? []), position.lineageId]);
    }
  }
  return lists;
}

/**
 * Calling identity per assignment. Singles are keyed by lineage. A `from` list
 * is keyed by its lowest lineage; a `to` list takes the key of the `from` list
 * sharing a lineage with it, or a key that matches nothing on `from`.
 */
function callingKeys(from: Board, to: Board): { readonly from: ReadonlyMap<AssignmentId, string>; readonly to: ReadonlyMap<AssignmentId, string> } {
  const fromKeys = new Map<AssignmentId, string>();
  const fromListOfLineage = new Map<LineageId, string>();
  for (const [id, lineages] of listLineages(from)) {
    const key = `list:${minLineage(lineages) ?? id}`;
    fromKeys.set(id, key);
    for (const lineage of lineages) {
      fromListOfLineage.set(lineage, key);
    }
  }
  const toKeys = new Map<AssignmentId, string>();
  for (const [id, lineages] of listLineages(to)) {
    const matches = lineages.flatMap((lineage) => fromListOfLineage.get(lineage) ?? []).sort((a, b) => a.localeCompare(b, 'en'));
    toKeys.set(id, matches[0] ?? `added-list:${minLineage(lineages) ?? id}`);
  }
  return { from: fromKeys, to: toKeys };
}

function keyOf(slot: Slot, listKeys: ReadonlyMap<AssignmentId, string>): string {
  if (slot.assignment.type === 'list') {
    return listKeys.get(slot.assignment.id) ?? `list:${slot.assignment.id}`;
  }
  return `single:${slot.position.lineageId}`;
}

/** Holdings by member and calling identity, in structural order. */
function holdings(board: Board, listKeys: ReadonlyMap<AssignmentId, string>): { slots: readonly Slot[]; held: Map<string, Slot[]> } {
  const slots = orderedSlots(board);
  const held = new Map<string, Slot[]>();
  for (const slot of slots) {
    const member = occupantOf(board, slot.position.id);
    if (member !== undefined) {
      const key = `${member}\u0000${keyOf(slot, listKeys)}`;
      held.set(key, [...(held.get(key) ?? []), slot]);
    }
  }
  return { slots, held };
}

/** Placements of `side` that the other side lacks: the last |k-j| of each member/calling group. */
function surplus(side: Map<string, Slot[]>, other: Map<string, Slot[]>): ReadonlySet<PositionId> {
  const chosen = new Set<PositionId>();
  for (const [key, mine] of side) {
    const extra = mine.length - (other.get(key)?.length ?? 0);
    if (extra > 0) {
      for (const slot of mine.slice(mine.length - extra)) {
        chosen.add(slot.position.id);
      }
    }
  }
  return chosen;
}

function placementsOf(board: Board, slots: readonly Slot[], chosen: ReadonlySet<PositionId>): DiffPlacement[] {
  const result: DiffPlacement[] = [];
  for (const slot of slots) {
    const memberId = occupantOf(board, slot.position.id);
    if (memberId !== undefined && chosen.has(slot.position.id)) {
      result.push({
        memberId,
        positionId: slot.position.id,
        lineageId: slot.position.lineageId,
        assignmentId: slot.assignment.id,
        title: slot.assignment.title,
      });
    }
  }
  return result;
}

function positionsMissingFrom(slots: readonly Slot[], other: Board): DiffPosition[] {
  const known = new Set<LineageId>(Object.values(other.positions).map((position) => position.lineageId));
  return slots
    .filter((slot) => !known.has(slot.position.lineageId))
    .map((slot) => ({
      positionId: slot.position.id,
      lineageId: slot.position.lineageId,
      assignmentId: slot.assignment.id,
      title: slot.assignment.title,
    }));
}

/**
 * Net change from `from` (earlier, e.g. a baseline) to `to` (later, e.g. a
 * proposal board). Board kinds are not checked.
 */
export function diffBoards(from: Board, to: Board): NetDiff {
  const keys = callingKeys(from, to);
  const before = holdings(from, keys.from);
  const after = holdings(to, keys.to);
  return deepFreeze({
    callings: placementsOf(to, after.slots, surplus(after.held, before.held)),
    releases: placementsOf(from, before.slots, surplus(before.held, after.held)),
    addedPositions: positionsMissingFrom(after.slots, from),
    removedPositions: positionsMissingFrom(before.slots, to),
  });
}

/** Net change from a proposal's saved baseline to its working board. */
export function proposalDiff(proposal: Proposal): NetDiff {
  return diffBoards(proposal.baseline, proposal.board);
}
