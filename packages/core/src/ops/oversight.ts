import { OVERSEERS, PRIESTS_QUORUM_KEY, type Board, type Overseer, type Oversight, type OversightTarget } from '../model/types.ts';
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
 * Counselor oversight (SPEC §4, §12). An entry assigns a bishopric member to an
 * area; it is not a calling, so editing it leaves the net diff empty. The
 * priests quorum stays with the fixed bishop entry and cannot be edited.
 */

/** Error codes specific to oversight edits, in addition to the shared codes. */
export const OVERSIGHT_ERROR_CODES = ['fixed_oversight'] as const;
export type OversightSpecificErrorCode = (typeof OVERSIGHT_ERROR_CODES)[number];
export type OversightErrorCode = SharedOperationErrorCode | OversightSpecificErrorCode;

export interface SetOversightRequest {
  readonly target: OversightTarget;
  readonly overseer: Overseer;
}

export interface ClearOversightRequest {
  readonly target: OversightTarget;
}

function sameTarget(left: OversightTarget, right: OversightTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function knownOverseer(value: unknown): Overseer | null {
  for (const overseer of OVERSEERS) {
    if (value === overseer) {
      return overseer;
    }
  }
  return null;
}

function targetExists(board: Board, target: OversightTarget): boolean {
  if (target.kind === 'boardGroup') {
    return Object.hasOwn(board.boardGroups, target.id);
  }
  return Object.hasOwn(board.callingGroups, target.id);
}

function isPriestsQuorum(board: Board, target: OversightTarget): boolean {
  if (target.kind !== 'callingGroup') {
    return false;
  }
  return board.callingGroups[target.id]?.key === PRIESTS_QUORUM_KEY;
}

function rejection(board: Board, target: OversightTarget): OperationError<OversightErrorCode> | null {
  const editable = checkEditable(board);
  if (editable !== null) {
    return editable;
  }
  if (!targetExists(board, target)) {
    const noun = target.kind === 'boardGroup' ? 'board group' : 'calling group';
    return { code: NOT_FOUND, message: `${noun} ${target.id} does not exist` };
  }
  if (isPriestsQuorum(board, target)) {
    return { code: 'fixed_oversight', message: 'the priests quorum is overseen only by the fixed bishop entry' };
  }
  return null;
}

function entryFor(target: OversightTarget, overseer: Overseer): Oversight {
  if (target.kind === 'boardGroup') {
    return { overseer, target: { kind: 'boardGroup', id: target.id }, fixed: false };
  }
  return { overseer, target: { kind: 'callingGroup', id: target.id }, fixed: false };
}

/** Replaces the target's entry in place, or appends one with `fixed: false`. */
function oversightWith(oversight: readonly Oversight[], target: OversightTarget, overseer: Overseer): readonly Oversight[] {
  const index = oversight.findIndex((entry) => sameTarget(entry.target, target));
  const next = entryFor(target, overseer);
  if (index === -1) {
    return [...oversight, next];
  }
  return oversight.map((entry, entryIndex) => (entryIndex === index ? next : entry));
}

function commit(board: Board, ctx: OperationContext, oversight: readonly Oversight[]): OperationResult<OversightErrorCode> {
  return operationOk(finalizeBoard(dropStaleApprovals({ ...board, oversight }), ctx.ward));
}

/**
 * Sets the single overseer of `target`. An existing entry is replaced in place;
 * otherwise a non-fixed entry is appended. Setting the current overseer again
 * is a no-op success.
 *
 * Errors: `board_not_editable`; `not_found` (the target group); `fixed_oversight`
 * (the priests quorum); `invalid_operation` (`overseer` is not a bishopric role).
 */
export function setOversight(board: Board, ctx: OperationContext, request: SetOversightRequest): OperationResult<OversightErrorCode> {
  const rejected = rejection(board, request.target);
  if (rejected !== null) {
    return operationError(rejected.code, rejected.message);
  }
  const overseer = knownOverseer(request.overseer);
  if (overseer === null) {
    return operationError(INVALID_OPERATION, `overseer must be one of ${OVERSEERS.join(', ')}`);
  }
  return commit(board, ctx, oversightWith(board.oversight, request.target, overseer));
}

/**
 * Removes `target`'s oversight entry. Resolution then falls back to ancestors,
 * and finally to the bishop. Removing an entry that is already absent is a
 * no-op success.
 *
 * Errors: `board_not_editable`; `not_found` (the target group); `fixed_oversight`
 * (the priests quorum).
 */
export function clearOversight(
  board: Board,
  ctx: OperationContext,
  request: ClearOversightRequest,
): OperationResult<OversightErrorCode> {
  const rejected = rejection(board, request.target);
  if (rejected !== null) {
    return operationError(rejected.code, rejected.message);
  }
  const oversight = board.oversight.filter((entry) => !sameTarget(entry.target, request.target));
  return commit(board, ctx, oversight);
}
