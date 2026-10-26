import { createBoard } from '../model/board.ts';
import type { IdGenerator } from '../model/ids.ts';
import type { Board, BoardInput, Ward } from '../model/types.ts';

/*
 * Conventions shared by every board operation (move, swap, release, positions, ...).
 *
 * An operation is a pure function `(board, ctx, request) => OperationResult`:
 * - It edits only boards of kind `proposal`; Current and baselines are read-only
 *   (`board_not_editable`).
 * - It fails fast with exactly one `OperationError`; the input board is never mutated.
 * - It never changes `board.id`, `board.kind` or `board.version` (the server owns versioning).
 * - It drops approvals that no longer match a placement (`dropStaleApprovals`) and returns
 *   its board through `finalizeBoard`, so every model invariant is rechecked and the
 *   result is deeply frozen.
 */

/** What an operation needs besides the board: ward-wide data and a source of fresh ids. */
export interface OperationContext {
  readonly ward: Ward;
  /** Fresh ids for anything the operation creates (positions, lineages, ...). */
  readonly ids: IdGenerator;
}

/** A refused request. `code` is stable and meant for branching; `message` is for people. */
export interface OperationError<C extends string = string> {
  readonly code: C;
  readonly message: string;
}

/** The outcome of an operation: the new board, or exactly one error. */
export type OperationResult<C extends string = string> =
  | { readonly ok: true; readonly board: Board }
  | { readonly ok: false; readonly error: OperationError<C> };

/** The board's `kind` is not `proposal` (Current and baselines are read-only). */
export const BOARD_NOT_EDITABLE = 'board_not_editable';
/** A referenced member, position, assignment or other entity does not exist. */
export const NOT_FOUND = 'not_found';
/** The request is self-contradictory or asks the wrong operation (e.g. same source and destination). */
export const INVALID_OPERATION = 'invalid_operation';

/** Error codes any operation may return. Operation modules add their own codes. */
export const SHARED_OPERATION_ERROR_CODES = [BOARD_NOT_EDITABLE, NOT_FOUND, INVALID_OPERATION] as const;
export type SharedOperationErrorCode = (typeof SHARED_OPERATION_ERROR_CODES)[number];

/** Builds a successful result. */
export function operationOk(board: Board): { readonly ok: true; readonly board: Board } {
  return { ok: true, board };
}

/** Builds a failed result carrying one error. */
export function operationError<C extends string>(
  code: C,
  message: string,
): { readonly ok: false; readonly error: OperationError<C> } {
  return { ok: false, error: { code, message } };
}

/** Returns the `board_not_editable` error for non-proposal boards, or null when the board may be edited. */
export function checkEditable(board: Board): OperationError<typeof BOARD_NOT_EDITABLE> | null {
  if (board.kind === 'proposal') {
    return null;
  }
  return { code: BOARD_NOT_EDITABLE, message: `board ${board.id} is ${board.kind} and cannot be edited` };
}

/**
 * Removes approvals whose `(memberId, positionId)` pair is no longer a placement.
 * Approvals belong to one member in one position on one board (SPEC §6), so any
 * change that moves the member or empties the position invalidates them.
 */
export function dropStaleApprovals(board: BoardInput): BoardInput {
  const approvals = board.approvals.filter((approval) => board.placements[approval.positionId] === approval.memberId);
  return approvals.length === board.approvals.length ? board : { ...board, approvals };
}

/**
 * Validates and freezes an operation's resulting board via `createBoard`.
 * Throws if the board is invalid: an operation that produces an invalid board
 * is a programming error, not a user error.
 */
export function finalizeBoard(next: BoardInput, ward: Ward): Board {
  const result = createBoard(next, ward);
  if (!result.ok) {
    const details = result.errors.map((e) => `${e.code} at ${e.path}: ${e.message}`).join('; ');
    throw new Error(`operation produced an invalid board ${next.id}: ${details}`);
  }
  return result.value;
}
