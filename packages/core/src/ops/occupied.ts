import type { AssignmentId, MemberId, PositionId } from '../model/ids.ts';
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

/*
 * Occupied single-calling drops (SPEC §5). Swap exchanges the two placements.
 * Release occupant places the incoming member and releases the displaced
 * member from that calling only; they are not explicitly added to the dugout
 * (no-calling membership is derived). The presidency release rule is not
 * applied here (T-013).
 */

/** Error codes specific to swap and release occupant, in addition to the shared codes. */
export const OCCUPIED_ERROR_CODES = [
  /** `to` is a vacant single; use `placeInPosition`. */
  'position_vacant',
  /** `from` is not a position currently held by the member. */
  'not_placed',
  /** A destination assignment is disabled. In a swap, both sides are destinations. */
  'assignment_disabled',
  /** The displaced occupant already holds another position in the source list. */
  'already_in_list',
] as const;
export type OccupiedSpecificErrorCode = (typeof OCCUPIED_ERROR_CODES)[number];
export type OccupiedErrorCode = SharedOperationErrorCode | OccupiedSpecificErrorCode;

export interface SwapRequest {
  readonly memberId: MemberId;
  /** A position currently held by `memberId`. Never null: a dugout source has nothing to swap. */
  readonly from: PositionId;
  /** An occupied position of an enabled single assignment. */
  readonly to: PositionId;
}

export interface ReleaseOccupantRequest {
  readonly memberId: MemberId;
  /** The position the member is moving out of, or null when not from a calling (dugout or search). */
  readonly from: PositionId | null;
  /** An occupied position of an enabled single assignment. */
  readonly to: PositionId;
}

type Failure = OperationError<OccupiedErrorCode>;
type Checked = { readonly ok: false; readonly error: Failure } | { readonly ok: true; readonly displaced: MemberId };

function refuse(code: OccupiedErrorCode, message: string): Checked {
  return { ok: false, error: { code, message } };
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

/** createBoard guarantees every position's assignment exists; a miss is a programming error. */
function requireAssignment(board: Board, position: Position): CallingAssignment {
  const assignment = findAssignment(board, position.assignmentId);
  if (assignment === undefined) {
    throw new Error(`position ${position.id} references missing assignment ${position.assignmentId}`);
  }
  return assignment;
}

/** True when `member` holds a position of `assignment` other than `except`. */
function holdsOtherPositionIn(board: Board, member: MemberId, assignment: AssignmentId, except: PositionId): boolean {
  return Object.values(board.positions).some(
    (position) =>
      position.assignmentId === assignment && position.id !== except && occupantOf(board, position.id) === member,
  );
}

/**
 * Shared checks for an occupied single drop. `swapping` also requires `from`
 * to be enabled (it becomes the displaced occupant's calling) and rejects a
 * displaced member who already holds another position in a list source.
 */
function validateOccupied(
  board: Board,
  ctx: OperationContext,
  memberId: MemberId,
  from: PositionId | null,
  to: PositionId,
  swapping: boolean,
): Checked {
  const notEditable = checkEditable(board);
  if (notEditable !== null) {
    return { ok: false, error: notEditable };
  }
  if (!Object.hasOwn(ctx.ward.members, memberId)) {
    return refuse(NOT_FOUND, `member ${memberId} does not exist`);
  }

  let source: Position | null = null;
  if (from !== null) {
    const found = findPosition(board, from);
    if (found === undefined) {
      return refuse(NOT_FOUND, `source position ${from} does not exist`);
    }
    source = found;
    if (occupantOf(board, from) !== memberId) {
      return refuse('not_placed', `member ${memberId} does not hold position ${from}`);
    }
    if (from === to) {
      return refuse(INVALID_OPERATION, `source and destination are the same position ${to}`);
    }
  }

  const destination = findPosition(board, to);
  if (destination === undefined) {
    return refuse(NOT_FOUND, `destination position ${to} does not exist`);
  }
  const toAssignment = requireAssignment(board, destination);
  if (toAssignment.type !== 'single') {
    return refuse(
      INVALID_OPERATION,
      `position ${to} belongs to list ${toAssignment.id}; dropping onto a list never displaces anyone`,
    );
  }
  const displaced = occupantOf(board, to);
  if (displaced === undefined) {
    return refuse('position_vacant', `position ${to} is vacant`);
  }
  if (displaced === memberId) {
    return refuse(INVALID_OPERATION, `member ${memberId} already holds position ${to}`);
  }
  if (!toAssignment.enabled) {
    return refuse('assignment_disabled', `assignment ${toAssignment.id} is disabled`);
  }

  if (swapping) {
    if (source === null) {
      throw new Error('swap requires a source position');
    }
    const fromAssignment = requireAssignment(board, source);
    if (!fromAssignment.enabled) {
      return refuse('assignment_disabled', `assignment ${fromAssignment.id} is disabled`);
    }
    if (fromAssignment.type === 'list' && holdsOtherPositionIn(board, displaced, fromAssignment.id, source.id)) {
      return refuse('already_in_list', `member ${displaced} is already in list ${fromAssignment.id}`);
    }
  }

  return { ok: true, displaced };
}

function finish(
  board: Board,
  ctx: OperationContext,
  placements: Board['placements'],
  dugoutInclusions: readonly MemberId[],
): OperationResult<OccupiedErrorCode> {
  return operationOk(finalizeBoard(dropStaleApprovals({ ...board, placements, dugoutInclusions }), ctx.ward));
}

/**
 * Exchanges the placements of `memberId` at `from` and the occupant of `to`.
 * Both explicit dugout inclusions are cleared. Neither member's other callings change.
 *
 * Errors: `board_not_editable`; `not_found` (member, `from` or `to`); `not_placed`;
 * `invalid_operation` (list `to`, `from === to`, or `to` held by `memberId`);
 * `position_vacant`; `assignment_disabled` (either assignment); `already_in_list`.
 */
export function swap(board: Board, ctx: OperationContext, request: SwapRequest): OperationResult<OccupiedErrorCode> {
  const { memberId, from, to } = request;
  const checked = validateOccupied(board, ctx, memberId, from, to, true);
  if (!checked.ok) {
    return operationError(checked.error.code, checked.error.message);
  }
  const displaced = checked.displaced;
  const placements: Record<PositionId, MemberId> = { ...board.placements, [to]: memberId, [from]: displaced };
  const dugoutInclusions = board.dugoutInclusions.filter((id) => id !== memberId && id !== displaced);
  return finish(board, ctx, placements, dugoutInclusions);
}

/**
 * Places `memberId` in `to`, vacates `from`, and releases the displaced occupant
 * from `to` only. The displaced member gets no explicit dugout inclusion; an
 * existing one is left as it was. `memberId`'s explicit inclusion is cleared.
 * `from` may be a disabled assignment.
 *
 * Errors: `board_not_editable`; `not_found` (member, `from` or `to`); `not_placed`;
 * `invalid_operation` (list `to`, `from === to`, or `to` held by `memberId`);
 * `position_vacant`; `assignment_disabled` (`to` only).
 */
export function releaseOccupant(
  board: Board,
  ctx: OperationContext,
  request: ReleaseOccupantRequest,
): OperationResult<OccupiedErrorCode> {
  const { memberId, from, to } = request;
  const checked = validateOccupied(board, ctx, memberId, from, to, false);
  if (!checked.ok) {
    return operationError(checked.error.code, checked.error.message);
  }
  const placements: Record<PositionId, MemberId> = Object.fromEntries(
    Object.entries(board.placements).filter(([position]) => position !== from && position !== to),
  );
  placements[to] = memberId;
  // No-calling dugout membership is derived. Do not record an explicit inclusion for the displaced member.
  const dugoutInclusions = board.dugoutInclusions.filter((id) => id !== memberId);
  return finish(board, ctx, placements, dugoutInclusions);
}

/**
 * The operations that would succeed for this drop, in that order.
 * An empty array means only Cancel. Computed by running the operations.
 */
export function occupiedDropOptions(
  board: Board,
  ctx: OperationContext,
  request: ReleaseOccupantRequest,
): readonly ('swap' | 'release_occupant')[] {
  const options: ('swap' | 'release_occupant')[] = [];
  if (request.from !== null) {
    const swapped = swap(board, ctx, { memberId: request.memberId, from: request.from, to: request.to });
    if (swapped.ok) {
      options.push('swap');
    }
  }
  if (releaseOccupant(board, ctx, request).ok) {
    options.push('release_occupant');
  }
  return options;
}
