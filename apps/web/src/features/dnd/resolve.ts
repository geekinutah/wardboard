import {
  addToDugout,
  addToList,
  moveToDugout,
  occupiedDropOptions,
  placeInPosition,
  releaseOccupant,
  secondCallingNoticesWithOutside,
  sequentialIds,
  swap,
  unapprovedPlacements,
  type Board,
  type IdGenerator,
  type MemberId,
  type OperationContext,
  type OperationResult,
  type OutsideAwareNotice,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import type { DragSource, DropOp, DropTarget } from './types.ts';

export type DropPlan =
  | { kind: 'none' } // nothing to do (same slot, dugout→dugout)
  | { kind: 'blocked'; message: string } // core refused; message from the core error
  | { kind: 'apply'; op: DropOp } // ready for preflight
  | { kind: 'choose'; options: readonly { choice: 'swap' | 'release_occupant'; op: DropOp }[] };

export type Preflight = {
  /** The dragged member's second-calling notice (outside callings count), or null. */
  secondCalling: OutsideAwareNotice | null;
  /** Approval requirements the operation newly creates, in core's order. */
  approvals: readonly { memberId: MemberId; positionId: PositionId }[];
};

/** A placement operation core can run without host data (everything but `approvePlacement`). */
export type PlacementOp = Exclude<DropOp, { kind: 'approvePlacement' }>;

export const FILLED_NO_OPTIONS = "That calling is filled and can't be swapped or released here.";

/**
 * A deterministic id generator that skips ids already used on `board` (positions
 * and lineages), so trial operations never collide with ids an earlier drop
 * created. The same board always yields the same sequence, so a host that
 * applies an operation with `dropContext(board, ward)` gets the ids preflight saw.
 */
export function dropIds(board: Board): IdGenerator {
  const used = new Set<string>();
  for (const position of Object.values(board.positions)) {
    used.add(position.id);
    used.add(position.lineageId);
  }
  const next = sequentialIds('dnd-preview');
  return () => {
    let id = next();
    while (used.has(id)) {
      id = next();
    }
    used.add(id);
    return id;
  };
}

/** The operation context for trying (or locally applying) a drop on `board`. */
export function dropContext(board: Board, ward: Ward): OperationContext {
  return { ward, ids: dropIds(board) };
}

/**
 * Runs a placement operation with core. `approvePlacement` needs a baseline,
 * approver and time that only the host has, so it is not handled here.
 */
export function runDropOp(board: Board, ctx: OperationContext, op: PlacementOp): OperationResult {
  switch (op.kind) {
    case 'placeInPosition':
      return placeInPosition(board, ctx, op.request);
    case 'addToList':
      return addToList(board, ctx, op.request);
    case 'swap':
      return swap(board, ctx, op.request);
    case 'releaseOccupant':
      return releaseOccupant(board, ctx, op.request);
    case 'moveToDugout':
      return moveToDugout(board, ctx, op.request);
    case 'addToDugout':
      return addToDugout(board, ctx, op.request);
  }
}

function checked(board: Board, ward: Ward, op: PlacementOp): DropPlan {
  const result = runDropOp(board, dropContext(board, ward), op);
  if (!result.ok) {
    return { kind: 'blocked', message: result.error.message };
  }
  return { kind: 'apply', op };
}

/** Decides what a drop of `source` onto `target` means. Pure; runs core to validate. */
export function resolveDrop(board: Board, ward: Ward, source: DragSource, target: DropTarget): DropPlan {
  const memberId = source.memberId;
  const from = source.kind === 'position' ? source.positionId : null;

  if (target.kind === 'dugout') {
    switch (source.kind) {
      case 'position':
        return checked(board, ward, { kind: 'moveToDugout', request: { memberId, from: source.positionId } });
      case 'member':
        return checked(board, ward, { kind: 'addToDugout', request: { memberId } });
      case 'dugout':
        return { kind: 'none' };
    }
  }

  const to = target.positionId;
  if (from === to) {
    return { kind: 'none' };
  }

  const position = Object.hasOwn(board.positions, to) ? board.positions[to] : undefined;
  if (position === undefined) {
    return { kind: 'blocked', message: `destination position ${to} does not exist` };
  }
  const assignment = board.assignments[position.assignmentId];
  if (assignment === undefined) {
    return { kind: 'blocked', message: `position ${to} references missing assignment ${position.assignmentId}` };
  }

  if (assignment.type === 'list') {
    return checked(board, ward, { kind: 'addToList', request: { memberId, from, assignmentId: assignment.id } });
  }

  if (!Object.hasOwn(board.placements, to)) {
    return checked(board, ward, { kind: 'placeInPosition', request: { memberId, from, to } });
  }

  const choices = occupiedDropOptions(board, dropContext(board, ward), { memberId, from, to });
  if (choices.length === 0) {
    // A read-only board refuses every option; say so instead of the generic text.
    const refusal = releaseOccupant(board, dropContext(board, ward), { memberId, from, to });
    if (!refusal.ok && refusal.error.code === 'board_not_editable') {
      return { kind: 'blocked', message: refusal.error.message };
    }
    return { kind: 'blocked', message: FILLED_NO_OPTIONS };
  }
  const options = choices.map((choice): { choice: 'swap' | 'release_occupant'; op: DropOp } => {
    if (choice === 'swap') {
      if (from === null) {
        throw new Error('core offered swap without a source position');
      }
      return { choice, op: { kind: 'swap', request: { memberId, from, to } } };
    }
    return { choice, op: { kind: 'releaseOccupant', request: { memberId, from, to } } };
  });
  return { kind: 'choose', options };
}

function sameRequirement(
  left: { memberId: MemberId; positionId: PositionId },
  right: { memberId: MemberId; positionId: PositionId },
): boolean {
  return left.memberId === right.memberId && left.positionId === right.positionId;
}

/**
 * What must be confirmed before `op` is committed: the dragged member's
 * second calling (counting outside callings) and any newly created approval
 * requirements. Dugout operations never warn; Current never asks for approval.
 * Throws when core refuses `op` (resolveDrop only hands out operations core accepts).
 */
export function preflight(proposal: Proposal | null, board: Board, ward: Ward, op: DropOp): Preflight {
  if (op.kind === 'approvePlacement') {
    return { secondCalling: null, approvals: [] };
  }
  const result = runDropOp(board, dropContext(board, ward), op);
  if (!result.ok) {
    throw new Error(`preflight on a refused ${op.kind}: ${result.error.message}`);
  }
  const after = result.board;

  let secondCalling: OutsideAwareNotice | null = null;
  if (op.kind !== 'moveToDugout' && op.kind !== 'addToDugout') {
    const dragged = op.request.memberId;
    secondCalling = secondCallingNoticesWithOutside(board, after, ward).find((notice) => notice.memberId === dragged) ?? null;
  }

  let approvals: { memberId: MemberId; positionId: PositionId }[] = [];
  if (proposal !== null && board.kind === 'proposal') {
    const before = unapprovedPlacements({ ...proposal, board }, ward);
    approvals = unapprovedPlacements({ ...proposal, board: after }, ward)
      .filter((requirement) => !before.some((existing) => sameRequirement(existing, requirement)))
      .map((requirement) => ({ memberId: requirement.memberId, positionId: requirement.positionId }));
  }

  return { secondCalling, approvals };
}
