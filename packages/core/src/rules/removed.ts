import { deepFreeze } from '../model/freeze.ts';
import type { MemberId, PositionId } from '../model/ids.ts';
import type { Board, CallingGroup, Proposal, Ward } from '../model/types.ts';

export interface RemovedState {
  readonly members: readonly { readonly memberId: MemberId; readonly positionIds: readonly PositionId[] }[];
  readonly positions: readonly PositionId[];
}

export type EligibilityReason =
  | { readonly kind: 'removed_member'; readonly memberId: MemberId; readonly positionIds: readonly PositionId[] }
  | { readonly kind: 'removed_position'; readonly positionId: PositionId };

interface StructuralOrder {
  readonly boardGroupOrder: number;
  readonly groupOrders: readonly number[];
  readonly assignmentOrder: number;
  readonly positionOrder: number;
  readonly positionId: PositionId;
}

/** Root-to-leaf calling-group order precedes assignment and position order. */
function structuralOrder(board: Board, id: PositionId): StructuralOrder {
  const slot = board.positions[id];
  if (slot === undefined) throw new Error(`position ${id} is missing`);
  const assignment = board.assignments[slot.assignmentId];
  if (assignment === undefined) throw new Error(`assignment ${slot.assignmentId} is missing`);
  const chain: CallingGroup[] = [];
  const seen = new Set<string>();
  let group = board.callingGroups[assignment.groupId];
  while (group !== undefined) {
    if (seen.has(group.id)) throw new Error(`calling group cycle at ${group.id}`);
    seen.add(group.id);
    chain.push(group);
    if (group.parent.kind === 'boardGroup') break;
    group = board.callingGroups[group.parent.id];
  }
  const root = chain[chain.length - 1];
  if (root === undefined || root.parent.kind !== 'boardGroup') {
    throw new Error(`position ${id} is not under a board group`);
  }
  const boardGroup = board.boardGroups[root.parent.id];
  if (boardGroup === undefined) throw new Error(`board group ${root.parent.id} is missing`);
  return {
    boardGroupOrder: boardGroup.order,
    groupOrders: chain.reverse().map((entry) => entry.order),
    assignmentOrder: assignment.order,
    positionOrder: slot.order,
    positionId: id,
  };
}

function compareStructural(left: StructuralOrder, right: StructuralOrder): number {
  if (left.boardGroupOrder !== right.boardGroupOrder) return left.boardGroupOrder - right.boardGroupOrder;
  const shared = Math.min(left.groupOrders.length, right.groupOrders.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left.groupOrders[index];
    const b = right.groupOrders[index];
    if (a === undefined || b === undefined) throw new Error('missing calling-group order');
    if (a !== b) return a - b;
  }
  return left.groupOrders.length - right.groupOrders.length
    || left.assignmentOrder - right.assignmentOrder
    || left.positionOrder - right.positionOrder
    || (left.positionId < right.positionId ? -1 : left.positionId > right.positionId ? 1 : 0);
}

/** Derive flags only: proposal-only lineages remain valid, and vacancies still count. */
export function removedState(proposal: Proposal, current: Board, ward: Ward): RemovedState {
  if (current.kind !== 'current') throw new TypeError('current must be a current board');
  const baselineLineages = new Set(Object.values(proposal.baseline.positions).map((slot) => slot.lineageId));
  const currentLineages = new Set(Object.values(current.positions).map((slot) => slot.lineageId));
  const slots = Object.values(proposal.board.positions)
    .map((slot) => ({ slot, order: structuralOrder(proposal.board, slot.id) }))
    .sort((a, b) => compareStructural(a.order, b.order));
  const members = new Map<MemberId, PositionId[]>();
  const positions: PositionId[] = [];
  for (const { slot } of slots) {
    if (baselineLineages.has(slot.lineageId) && !currentLineages.has(slot.lineageId)) positions.push(slot.id);
    const memberId = proposal.board.placements[slot.id];
    const member = memberId === undefined ? undefined : ward.members[memberId];
    if (member !== undefined && member.removedDate !== null) {
      const held = members.get(member.id) ?? [];
      held.push(slot.id);
      members.set(member.id, held);
    }
  }
  const entries = [...members].map(([memberId, positionIds]) => ({ memberId, positionIds }));
  entries.sort((a, b) => {
    const left = ward.members[a.memberId];
    const right = ward.members[b.memberId];
    if (left === undefined || right === undefined) throw new Error('removed member is missing');
    return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
      || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0);
  });
  return deepFreeze({ members: entries, positions });
}

/** Removal-only eligibility; other acceptance rules are handled separately. */
export function acceptanceEligibility(proposal: Proposal, current: Board, ward: Ward): {
  readonly eligible: boolean;
  readonly reasons: readonly EligibilityReason[];
} {
  const state = removedState(proposal, current, ward);
  const reasons: EligibilityReason[] = [
    ...state.members.map((member) => ({ kind: 'removed_member' as const, ...member })),
    ...state.positions.map((positionId) => ({ kind: 'removed_position' as const, positionId })),
  ];
  return deepFreeze({ eligible: reasons.length === 0, reasons });
}
