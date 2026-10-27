import { deepFreeze } from '../model/freeze.ts';
import { positionId, type MemberId, type PositionId, type UserId } from '../model/ids.ts';
import type { Approval, Board, CallingGroup, Position, Proposal, Ward } from '../model/types.ts';
import { isIsoTimestamp, isNonEmptyString } from '../model/validate.ts';
import {
  checkEditable,
  finalizeBoard,
  INVALID_OPERATION,
  NOT_FOUND,
  operationError,
  operationOk,
  type OperationContext,
  type OperationResult,
  type SharedOperationErrorCode,
} from '../ops/types.ts';

/*
 * Needs-approval placements (SPEC §6). A placement requires approval when the
 * member's needsApproval flag is set and the placement is a suggested calling:
 * no baseline position with the same lineageId is occupied by that member.
 * Accepted proposals report no requirements. The caller supplies the time.
 */

/** One placement that requires approval, plus the approval that satisfies it, if any. */
export interface ApprovalRequirement {
  readonly memberId: MemberId;
  readonly positionId: PositionId;
  readonly approval: Approval | null;
}

/** Operation-specific error codes. Shared codes (`board_not_editable`, `not_found`, `invalid_operation`) also apply. */
export const APPROVAL_ERROR_CODES = ['not_placed', 'approval_not_required', 'already_approved'] as const;
export type ApprovalSpecificErrorCode = (typeof APPROVAL_ERROR_CODES)[number];
export type ApprovalErrorCode = SharedOperationErrorCode | ApprovalSpecificErrorCode;

export interface ApprovePlacementRequest {
  readonly baseline: Board;
  readonly memberId: MemberId;
  readonly positionId: PositionId;
  readonly approvedBy: UserId;
  readonly approvedAt: string;
}

interface StructuralOrder {
  readonly boardGroupOrder: number;
  readonly groupOrders: readonly number[];
  readonly assignmentOrder: number;
  readonly positionOrder: number;
  readonly positionId: string;
}

/** Suggested calling: the baseline has no position of this lineage occupied by the member. */
function isSuggestedCalling(baseline: Board, slot: Position, member: MemberId): boolean {
  for (const candidate of Object.values(baseline.positions)) {
    if (candidate.lineageId === slot.lineageId) {
      return baseline.placements[candidate.id] !== member;
    }
  }
  return true;
}

function approvalFor(board: Board, member: MemberId, placedAt: PositionId): Approval | null {
  return board.approvals.find((entry) => entry.memberId === member && entry.positionId === placedAt) ?? null;
}

function requiresApproval(board: Board, baseline: Board, ward: Ward, id: PositionId): boolean {
  const member = board.placements[id];
  if (member === undefined) {
    return false;
  }
  const person = ward.members[member];
  if (person === undefined || !person.needsApproval) {
    return false;
  }
  const slot = board.positions[id];
  if (slot === undefined) {
    return false;
  }
  return isSuggestedCalling(baseline, slot, member);
}

/** Board-group order, then calling-group chain orders from the root, then assignment, position, and id. */
function structuralOrder(board: Board, id: PositionId): StructuralOrder {
  const slot = board.positions[id];
  if (slot === undefined) {
    throw new Error(`position ${id} is missing`);
  }
  const assigned = board.assignments[slot.assignmentId];
  if (assigned === undefined) {
    throw new Error(`assignment ${slot.assignmentId} is missing`);
  }

  const chain: CallingGroup[] = [];
  const seen = new Set<string>();
  let current = board.callingGroups[assigned.groupId];
  while (current !== undefined) {
    if (seen.has(current.id)) {
      throw new Error(`calling group cycle at ${current.id}`);
    }
    seen.add(current.id);
    chain.push(current);
    if (current.parent.kind === 'boardGroup') {
      break;
    }
    current = board.callingGroups[current.parent.id];
  }

  const root = chain[chain.length - 1];
  if (root === undefined || root.parent.kind !== 'boardGroup') {
    throw new Error(`position ${id} is not under a board group`);
  }
  const boardGroup = board.boardGroups[root.parent.id];
  if (boardGroup === undefined) {
    throw new Error(`board group ${root.parent.id} is missing`);
  }
  chain.reverse();
  return {
    boardGroupOrder: boardGroup.order,
    groupOrders: chain.map((group) => group.order),
    assignmentOrder: assigned.order,
    positionOrder: slot.order,
    positionId: slot.id,
  };
}

function compareStructural(left: StructuralOrder, right: StructuralOrder): number {
  if (left.boardGroupOrder !== right.boardGroupOrder) {
    return left.boardGroupOrder - right.boardGroupOrder;
  }
  const shared = Math.min(left.groupOrders.length, right.groupOrders.length);
  for (let index = 0; index < shared; index += 1) {
    const leftOrder = left.groupOrders[index];
    const rightOrder = right.groupOrders[index];
    if (leftOrder === undefined || rightOrder === undefined) {
      throw new Error('missing calling-group order');
    }
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
  }
  if (left.groupOrders.length !== right.groupOrders.length) {
    return left.groupOrders.length - right.groupOrders.length;
  }
  if (left.assignmentOrder !== right.assignmentOrder) {
    return left.assignmentOrder - right.assignmentOrder;
  }
  if (left.positionOrder !== right.positionOrder) {
    return left.positionOrder - right.positionOrder;
  }
  if (left.positionId < right.positionId) {
    return -1;
  }
  if (left.positionId > right.positionId) {
    return 1;
  }
  return 0;
}

/**
 * Placements on a Draft proposal that require approval, in board structural order.
 * An Accepted proposal reports none until it is Draft again.
 */
export function approvalRequirements(proposal: Proposal, ward: Ward): readonly ApprovalRequirement[] {
  if (proposal.status === 'accepted') {
    return deepFreeze([]);
  }
  const { board, baseline } = proposal;
  const ordered = Object.keys(board.placements)
    .map((key) => positionId(key))
    .filter((id) => requiresApproval(board, baseline, ward, id))
    .sort((left, right) => compareStructural(structuralOrder(board, left), structuralOrder(board, right)));
  return deepFreeze(
    ordered.map((id) => {
      const member = board.placements[id];
      if (member === undefined) {
        throw new Error(`position ${id} lost its placement`);
      }
      return { memberId: member, positionId: id, approval: approvalFor(board, member, id) };
    }),
  );
}

/** Requirements whose approval is null. A Draft proposal with any cannot be accepted (SPEC §3). */
export function unapprovedPlacements(proposal: Proposal, ward: Ward): readonly ApprovalRequirement[] {
  return deepFreeze(approvalRequirements(proposal, ward).filter((requirement) => requirement.approval === null));
}

/**
 * Records an approval of one placement. Does not check the caller's role or
 * the proposal's status; those are server checks. Refuses anything that does
 * not currently require approval, including a second approval of the same pair.
 */
export function approvePlacement(
  board: Board,
  ctx: OperationContext,
  request: ApprovePlacementRequest,
): OperationResult<ApprovalErrorCode> {
  const notEditable = checkEditable(board);
  if (notEditable !== null) {
    return operationError(notEditable.code, notEditable.message);
  }

  const { baseline, memberId, positionId: placedAt, approvedBy, approvedAt } = request;
  if (baseline.kind !== 'baseline') {
    return operationError(INVALID_OPERATION, `baseline board ${baseline.id} has kind ${baseline.kind}`);
  }
  if (!isNonEmptyString(approvedBy)) {
    return operationError(INVALID_OPERATION, 'approvedBy must be a non-empty string');
  }
  if (!isIsoTimestamp(approvedAt)) {
    return operationError(INVALID_OPERATION, 'approvedAt must be an ISO timestamp with Z or an offset');
  }
  if (!Object.hasOwn(ctx.ward.members, memberId)) {
    return operationError(NOT_FOUND, `member ${memberId} does not exist`);
  }
  if (!Object.hasOwn(board.positions, placedAt)) {
    return operationError(NOT_FOUND, `position ${placedAt} does not exist`);
  }
  if (board.placements[placedAt] !== memberId) {
    return operationError('not_placed', `member ${memberId} does not hold position ${placedAt}`);
  }

  const person = ctx.ward.members[memberId];
  const slot = board.positions[placedAt];
  if (person === undefined || slot === undefined || !person.needsApproval || !isSuggestedCalling(baseline, slot, memberId)) {
    return operationError(
      'approval_not_required',
      `placement of ${memberId} in ${placedAt} does not require approval`,
    );
  }
  if (approvalFor(board, memberId, placedAt) !== null) {
    return operationError('already_approved', `placement of ${memberId} in ${placedAt} is already approved`);
  }

  return operationOk(
    finalizeBoard(
      {
        ...board,
        approvals: [...board.approvals, { memberId, positionId: placedAt, approvedBy, approvedAt }],
      },
      ctx.ward,
    ),
  );
}

function dropApprovals(board: Board, ward: Ward, keep: (approval: Approval) => boolean): Board {
  const approvals = board.approvals.filter(keep);
  if (approvals.length === board.approvals.length) {
    return board;
  }
  return finalizeBoard({ ...board, approvals }, ward);
}

/** Removes every approval of `memberId` on any board kind. Returns the same board when none match. */
export function dropMemberApprovals(board: Board, ward: Ward, memberId: MemberId): Board {
  return dropApprovals(board, ward, (approval) => approval.memberId !== memberId);
}

/** Removes every approval on any board kind. Placements are left unchanged. */
export function dropAllApprovals(board: Board, ward: Ward): Board {
  return dropApprovals(board, ward, () => false);
}
