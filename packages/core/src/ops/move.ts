import { lineageId, positionId, type AssignmentId, type MemberId, type PositionId } from '../model/ids.ts';
import type { Board, CallingAssignment, Position } from '../model/types.ts';
import {
  checkEditable,
  dropStaleApprovals,
  finalizeBoard,
  INVALID_OPERATION,
  NOT_FOUND,
  operationError,
  operationOk,
  type OperationContext,
  type OperationError,
  type OperationResult,
  type SharedOperationErrorCode,
} from './types.ts';
import { canPlaceMemberInAssignment } from '../rules/gender.ts';
import { applyPresidencyRelease } from './presidency.ts';

/*
 * Basic placement operations (SPEC §5): put a member into a vacant single
 * position, or add them to a list, optionally moving them out of exactly one
 * source position. The source position persists and becomes vacant; every
 * other calling the member holds is untouched.
 */

/** Error codes specific to the move operations, in addition to the shared codes. */
export const MOVE_ERROR_CODES = [
  /** The destination single position already has an occupant (swap / release occupant is a separate operation). */
  'position_occupied',
  /** The member already occupies a position in the destination list. */
  'already_in_list',
  /** `from` is not a position currently held by the member. */
  'not_placed',
  /** The destination assignment is disabled. */
  'assignment_disabled',
  /** `addToList` was given a single assignment. */
  'wrong_assignment_type',
  /** The member's gender does not satisfy the calling's gender rule. */
  'gender_mismatch',
] as const;
export type MoveSpecificErrorCode = (typeof MOVE_ERROR_CODES)[number];
export type MoveErrorCode = SharedOperationErrorCode | MoveSpecificErrorCode;

export interface PlaceInPositionRequest {
  readonly memberId: MemberId;
  /** The position the member is moving out of, or null when not from a calling (e.g. from the dugout). */
  readonly from: PositionId | null;
  /** A vacant position of an enabled single assignment. */
  readonly to: PositionId;
}

export interface AddToListRequest {
  readonly memberId: MemberId;
  /** The position the member is moving out of, or null when not from a calling (e.g. from the dugout). */
  readonly from: PositionId | null;
  /** An enabled list assignment the member is not already in. */
  readonly assignmentId: AssignmentId;
}

type Failure = OperationError<MoveErrorCode>;

function fail(error: Failure): OperationResult<MoveErrorCode> {
  return operationError(error.code, error.message);
}

function occupantOf(board: Board, position: PositionId): MemberId | undefined {
  return Object.hasOwn(board.placements, position) ? board.placements[position] : undefined;
}

function findPosition(board: Board, id: PositionId): Position | undefined {
  return Object.hasOwn(board.positions, id) ? board.positions[id] : undefined;
}

function findAssignment(board: Board, id: AssignmentId): CallingAssignment | undefined {
  return Object.hasOwn(board.assignments, id) ? board.assignments[id] : undefined;
}

/** Checks that the board is editable and that the member and `from` exist. */
function checkCommon(board: Board, ctx: OperationContext, memberId: MemberId, from: PositionId | null): Failure | null {
  const notEditable = checkEditable(board);
  if (notEditable !== null) {
    return notEditable;
  }
  if (!Object.hasOwn(ctx.ward.members, memberId)) {
    return { code: NOT_FOUND, message: `member ${memberId} does not exist` };
  }
  if (from !== null && findPosition(board, from) === undefined) {
    return { code: NOT_FOUND, message: `source position ${from} does not exist` };
  }
  return null;
}

/** Checks that `from` (if any) is held by the member. */
function checkSource(board: Board, memberId: MemberId, from: PositionId | null): Failure | null {
  if (from !== null && occupantOf(board, from) !== memberId) {
    return { code: 'not_placed', message: `member ${memberId} does not hold position ${from}` };
  }
  return null;
}

/**
 * Builds the resulting board: vacates `from`, places the member in `to`, clears the
 * member's explicit dugout inclusion (assigning a calling clears it, SPEC §5), applies
 * the presidency release rule, drops stale approvals, and revalidates.
 */
function commitPlacement(
  board: Board,
  ctx: OperationContext,
  memberId: MemberId,
  from: PositionId | null,
  to: PositionId,
  positions: Board['positions'] = board.positions,
): OperationResult<MoveErrorCode> {
  const placements: Record<PositionId, MemberId> = Object.fromEntries(
    Object.entries(board.placements).filter(([position]) => position !== from),
  );
  placements[to] = memberId;
  const drafted = {
    ...board,
    positions,
    placements,
    dugoutInclusions: board.dugoutInclusions.filter((id) => id !== memberId),
  };
  // Checked after presidency release so a new Sunday School president is not
  // compared with counselors and the secretary this same change vacates.
  const released = applyPresidencyRelease(board, drafted);
  const destination = positions[to];
  if (destination === undefined) {
    throw new Error(`position ${to} is missing`);
  }
  const gender = canPlaceMemberInAssignment(released, ctx.ward, memberId, destination.assignmentId);
  if (!gender.ok) {
    return operationError('gender_mismatch', gender.message);
  }
  return operationOk(finalizeBoard(dropStaleApprovals(released), ctx.ward));
}

/**
 * Places a member into a vacant position of an enabled single assignment,
 * optionally moving them out of `from` (which becomes vacant). Moving out of a
 * president position also vacates that presidency's counselors and secretary.
 *
 * Errors: `board_not_editable`; `not_found` (member, `to` or `from`);
 * `invalid_operation` (`from === to`, or `to` is a list position: use `addToList`);
 * `assignment_disabled`; `not_placed` (`from` not held by the member);
 * `position_occupied` (`to` has an occupant: swap / release occupant is separate).
 */
export function placeInPosition(
  board: Board,
  ctx: OperationContext,
  request: PlaceInPositionRequest,
): OperationResult<MoveErrorCode> {
  const { memberId, from, to } = request;
  const common = checkCommon(board, ctx, memberId, from);
  if (common !== null) {
    return fail(common);
  }
  const destination = findPosition(board, to);
  if (destination === undefined) {
    return operationError(NOT_FOUND, `destination position ${to} does not exist`);
  }
  if (from === to) {
    return operationError(INVALID_OPERATION, `source and destination are the same position ${to}`);
  }
  const assignment = findAssignment(board, destination.assignmentId);
  if (assignment === undefined) {
    // createBoard guarantees every position's assignment exists.
    throw new Error(`position ${to} references missing assignment ${destination.assignmentId}`);
  }
  if (assignment.type !== 'single') {
    return operationError(INVALID_OPERATION, `position ${to} belongs to list ${assignment.id}; use addToList`);
  }
  if (!assignment.enabled) {
    return operationError('assignment_disabled', `assignment ${assignment.id} is disabled`);
  }
  const source = checkSource(board, memberId, from);
  if (source !== null) {
    return fail(source);
  }
  const occupant = occupantOf(board, to);
  if (occupant !== undefined) {
    return operationError('position_occupied', `position ${to} is occupied by ${occupant}`);
  }
  return commitPlacement(board, ctx, memberId, from, to);
}

/**
 * Adds a member to an enabled list assignment without displacing anyone,
 * optionally moving them out of `from` (which becomes vacant). Moving out of a
 * president position also vacates that presidency's counselors and secretary. Fills
 * the vacant position with the lowest `order` (ties broken by id); when the list is full,
 * creates a new position (id, then lineage, from `ctx.ids`) after the last one.
 *
 * Errors: `board_not_editable`; `not_found` (member, assignment or `from`);
 * `wrong_assignment_type` (a single assignment); `assignment_disabled`;
 * `not_placed` (`from` not held by the member); `already_in_list` (the member
 * already holds a position in this list, including when `from` is in it).
 */
export function addToList(board: Board, ctx: OperationContext, request: AddToListRequest): OperationResult<MoveErrorCode> {
  const { memberId, from } = request;
  const common = checkCommon(board, ctx, memberId, from);
  if (common !== null) {
    return fail(common);
  }
  const assignment = findAssignment(board, request.assignmentId);
  if (assignment === undefined) {
    return operationError(NOT_FOUND, `assignment ${request.assignmentId} does not exist`);
  }
  if (assignment.type !== 'list') {
    return operationError('wrong_assignment_type', `assignment ${assignment.id} is a single; use placeInPosition`);
  }
  if (!assignment.enabled) {
    return operationError('assignment_disabled', `assignment ${assignment.id} is disabled`);
  }
  const source = checkSource(board, memberId, from);
  if (source !== null) {
    return fail(source);
  }
  const listPositions = Object.values(board.positions)
    .filter((p) => p.assignmentId === assignment.id)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (listPositions.some((p) => occupantOf(board, p.id) === memberId)) {
    return operationError('already_in_list', `member ${memberId} is already in list ${assignment.id}`);
  }

  const vacancy = listPositions.find((p) => occupantOf(board, p.id) === undefined);
  if (vacancy !== undefined) {
    return commitPlacement(board, ctx, memberId, from, vacancy.id);
  }

  const created: Position = {
    id: positionId(ctx.ids()),
    assignmentId: assignment.id,
    lineageId: lineageId(ctx.ids()),
    order: listPositions.reduce((max, p) => Math.max(max, p.order + 1), 0),
  };
  if (findPosition(board, created.id) !== undefined) {
    // Silently overwriting an existing position would corrupt the board.
    throw new Error(`id generator returned existing position id ${created.id}`);
  }
  return commitPlacement(board, ctx, memberId, from, created.id, { ...board.positions, [created.id]: created });
}
