import { type MemberId, type PositionId } from '../model/ids.ts';
import type { Board, Position } from '../model/types.ts';
import {
  checkEditable,
  dropStaleApprovals,
  finalizeBoard,
  NOT_FOUND,
  operationError,
  operationOk,
  type OperationContext,
  type OperationError,
  type OperationResult,
  type SharedOperationErrorCode,
} from './types.ts';

/*
 * Dugout operations (SPEC §3, §5): release one specific calling, drag a card
 * from a calling to the dugout (release plus explicit inclusion), and Add to
 * dugout (explicit inclusion that keeps every calling).
 *
 * Releasing vacates the slot; the position itself persists and every other
 * calling the member holds is untouched. `dugoutInclusions` is only ever
 * appended, never removed or rewritten here: a member left with no callings
 * appears in the dugout through derived membership (T-008), not through an
 * explicit inclusion, and assigning a calling (the move operations) is what
 * clears an explicit inclusion (SPEC §5). The presidency release rule is not
 * applied here; T-013 adds it.
 */

/** Error codes specific to the dugout operations, in addition to the shared codes. */
export const DUGOUT_ERROR_CODES = [
  /** The member does not hold the position to release or move from. */
  'not_placed',
  /** The member is already explicitly included in the dugout (adding again would be a no-op). */
  'already_in_dugout',
] as const;
export type DugoutSpecificErrorCode = (typeof DUGOUT_ERROR_CODES)[number];
export type DugoutErrorCode = SharedOperationErrorCode | DugoutSpecificErrorCode;

export interface ReleaseCallingRequest {
  readonly memberId: MemberId;
  /** The specific calling to release; its position becomes vacant and persists. */
  readonly positionId: PositionId;
}

export interface MoveToDugoutRequest {
  readonly memberId: MemberId;
  /** The position the card is dragged from; it becomes vacant. */
  readonly from: PositionId;
}

export interface AddToDugoutRequest {
  readonly memberId: MemberId;
}

type Failure = OperationError<DugoutErrorCode>;

function fail(error: Failure): OperationResult<DugoutErrorCode> {
  return operationError(error.code, error.message);
}

function occupantOf(board: Board, position: PositionId): MemberId | undefined {
  return Object.hasOwn(board.placements, position) ? board.placements[position] : undefined;
}

function findPosition(board: Board, id: PositionId): Position | undefined {
  return Object.hasOwn(board.positions, id) ? board.positions[id] : undefined;
}

/** Checks that the board is editable and that the member and (optional) position exist. */
function checkCommon(board: Board, ctx: OperationContext, memberId: MemberId, position: PositionId | null): Failure | null {
  const notEditable = checkEditable(board);
  if (notEditable !== null) {
    return notEditable;
  }
  if (!Object.hasOwn(ctx.ward.members, memberId)) {
    return { code: NOT_FOUND, message: `member ${memberId} does not exist` };
  }
  if (position !== null && findPosition(board, position) === undefined) {
    return { code: NOT_FOUND, message: `position ${position} does not exist` };
  }
  return null;
}

/** Checks that `position` (if any) is currently held by the member. */
function checkHolds(board: Board, memberId: MemberId, position: PositionId | null): Failure | null {
  if (position !== null && occupantOf(board, position) !== memberId) {
    return { code: 'not_placed', message: `member ${memberId} does not hold position ${position}` };
  }
  return null;
}

/**
 * Builds the resulting board: vacates `release` (the position persists),
 * appends the member to `dugoutInclusions` at most once when
 * `recordInclusion`, drops stale approvals, and revalidates. Everything else
 * is carried over unchanged.
 */
function commit(
  board: Board,
  ctx: OperationContext,
  memberId: MemberId,
  release: PositionId | null,
  recordInclusion: boolean,
): OperationResult<DugoutErrorCode> {
  const placements: Record<PositionId, MemberId> = Object.fromEntries(
    Object.entries(board.placements).filter(([position]) => position !== release),
  );
  const dugoutInclusions: readonly MemberId[] =
    recordInclusion && !board.dugoutInclusions.includes(memberId) ? [...board.dugoutInclusions, memberId] : board.dugoutInclusions;
  const next = dropStaleApprovals({ ...board, placements, dugoutInclusions });
  return operationOk(finalizeBoard(next, ctx.ward));
}

/**
 * Releases exactly one of the member's callings (SPEC §3, §5): the position
 * becomes vacant but is not deleted (a list keeps its size), every other
 * calling is kept, and `dugoutInclusions` is not changed. Releasing from a
 * disabled assignment is allowed: moving out is always allowed. Stale
 * approvals for the released position are dropped.
 *
 * Errors: `board_not_editable`; `not_found` (member or position);
 * `not_placed` (the member does not hold the position).
 */
export function releaseCalling(
  board: Board,
  ctx: OperationContext,
  request: ReleaseCallingRequest,
): OperationResult<DugoutErrorCode> {
  const { memberId, positionId } = request;
  const common = checkCommon(board, ctx, memberId, positionId);
  if (common !== null) {
    return fail(common);
  }
  const holds = checkHolds(board, memberId, positionId);
  if (holds !== null) {
    return fail(holds);
  }
  return commit(board, ctx, memberId, positionId, false);
}

/**
 * Drags a card from a calling to the dugout (SPEC §5): releases `from` (which
 * becomes vacant) and records an explicit dugout inclusion for the member in
 * this proposal, even if the member keeps other callings. The inclusion is
 * appended at most once; every other calling is kept. Stale approvals for
 * `from` are dropped.
 *
 * Errors: `board_not_editable`; `not_found` (member or `from`);
 * `not_placed` (the member does not hold `from`).
 */
export function moveToDugout(
  board: Board,
  ctx: OperationContext,
  request: MoveToDugoutRequest,
): OperationResult<DugoutErrorCode> {
  const { memberId, from } = request;
  const common = checkCommon(board, ctx, memberId, from);
  if (common !== null) {
    return fail(common);
  }
  const holds = checkHolds(board, memberId, from);
  if (holds !== null) {
    return fail(holds);
  }
  return commit(board, ctx, memberId, from, true);
}

/**
 * Add to dugout from search or a person card (SPEC §3): records an explicit
 * dugout inclusion without releasing anything. A member with no callings who
 * is not already explicitly included may be added (harmless and consistent),
 * and removed members may be added (their only way into the dugout, T-008).
 * Assigning a calling later clears the inclusion (the move operations).
 *
 * Errors: `board_not_editable`; `not_found` (member); `already_in_dugout`
 * (the member is already explicitly included: adding again would be a no-op
 * that must not be broadcast).
 */
export function addToDugout(board: Board, ctx: OperationContext, request: AddToDugoutRequest): OperationResult<DugoutErrorCode> {
  const { memberId } = request;
  const common = checkCommon(board, ctx, memberId, null);
  if (common !== null) {
    return fail(common);
  }
  if (board.dugoutInclusions.includes(memberId)) {
    return operationError('already_in_dugout', `member ${memberId} is already in the dugout`);
  }
  return commit(board, ctx, memberId, null, true);
}
