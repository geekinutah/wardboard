import {
  addListPosition,
  addToList,
  placeInPosition,
  releaseCalling,
  sequentialIds,
  type Board,
  type MemberId,
  type OperationContext,
  type OperationResult,
  type PositionId,
} from '@wardboard/core';
import type { PreviewData } from './types.ts';
import { buildFixtureProposal, buildFixtureWard } from './ward-fixture.ts';

export type PreviewOpStep = (board: Board, ctx: OperationContext) => OperationResult;

export interface BuildPreviewDataOptions {
  steps?: readonly PreviewOpStep[];
}

/**
 * Places a member into a position. For list assignments, core's `addToList` is used
 * because `placeInPosition` is restricted to single assignments.
 */
function placeMemberInPosition(
  board: Board,
  ctx: OperationContext,
  memberId: MemberId,
  positionId: PositionId,
): OperationResult {
  const position = board.positions[positionId];
  if (position === undefined) {
    return { ok: false, error: { code: 'not_found', message: `position ${positionId} does not exist` } };
  }
  const assignment = board.assignments[position.assignmentId];
  if (assignment?.type === 'list') {
    return addToList(board, ctx, { memberId, from: null, assignmentId: assignment.id });
  }
  return placeInPosition(board, ctx, { memberId, from: null, to: positionId });
}

function applyStep(
  board: Board,
  stepName: string,
  fn: () => OperationResult,
): Board {
  const result = fn();
  if (!result.ok) {
    throw new Error(`Preview fixture operation failed (${stepName}): ${result.error.message}`);
  }
  return result.board;
}

/**
 * Builds the deterministic PreviewData for standalone board views.
 *
 * Positions chosen for default proposal adjustments:
 * 1. releaseCalling on occupied Primary position 'p-0038' (member 'm-0027', Ari Sample, Second Counselor in Primary Presidency).
 * 2. placeInPosition of dugout member 'm-0035' (Ivy Notreal) into vacant Relief Society position 'p-0019'
 *    (Relief Society Teacher list assignment 'a-0015', via addToList because list positions reject placeInPosition).
 * 3. addListPosition on Sunday School list assignment 'Gospel Doctrine Teacher'.
 */
export function buildPreviewData(options?: BuildPreviewDataOptions): PreviewData {
  const { ward, current } = buildFixtureWard();
  const proposal = buildFixtureProposal(current, ward);
  const ctx: OperationContext = { ward, ids: sequentialIds('preview') };

  let workingBoard = proposal.board;

  if (options?.steps !== undefined) {
    for (const [index, step] of options.steps.entries()) {
      workingBoard = applyStep(workingBoard, `injected step ${String(index + 1)}`, () => step(workingBoard, ctx));
    }
  } else {
    // 1. releaseCalling on occupied Primary position:
    // Position 'p-0038' is Second Counselor in Primary Presidency held by Ari Sample ('m-0027')
    const primaryPositionId = 'p-0038' as PositionId;
    const primaryMemberId = workingBoard.placements[primaryPositionId] ?? ('m-0027' as MemberId);
    workingBoard = applyStep(workingBoard, 'release Primary calling', () =>
      releaseCalling(workingBoard, ctx, { memberId: primaryMemberId, positionId: primaryPositionId }),
    );

    // 2. placeInPosition of dugout member into vacant Relief Society position:
    // Member 'm-0035' (Ivy Notreal) into vacant Relief Society Teacher position 'p-0019'
    const rsPositionId = 'p-0019' as PositionId;
    const dugoutMemberId = 'm-0035' as MemberId;
    workingBoard = applyStep(workingBoard, 'place into Relief Society position', () =>
      placeMemberInPosition(workingBoard, ctx, dugoutMemberId, rsPositionId),
    );

    // 3. addListPosition on one list assignment in Sunday School:
    // Gospel Doctrine Teacher list assignment
    const ssAssignment = Object.values(workingBoard.assignments).find(
      (a) => a.title === 'Gospel Doctrine Teacher' && a.type === 'list',
    );
    if (ssAssignment === undefined) {
      throw new Error('Preview fixture setup failed: Sunday School list assignment not found');
    }
    workingBoard = applyStep(workingBoard, 'add Sunday School list position', () =>
      addListPosition(workingBoard, ctx, { assignmentId: ssAssignment.id }),
    );
  }

  const modifiedProposal = {
    ...proposal,
    board: workingBoard,
  };

  return {
    ward,
    current,
    proposal: modifiedProposal,
  };
}

let cachedPreviewData: PreviewData | null = null;

export function getPreviewData(): PreviewData {
  if (cachedPreviewData === null) {
    cachedPreviewData = buildPreviewData();
  }
  return cachedPreviewData;
}
