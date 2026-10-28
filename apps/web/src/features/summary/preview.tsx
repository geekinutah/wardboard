import type { ReactElement } from 'react';
import {
  addAssignment,
  removePosition,
  sequentialIds,
  type Board,
  type OperationContext,
  type OperationResult,
  type Ward,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { Summary } from './Summary.tsx';

/*
 * Preview scenario for the summary page: a re-imported Current that diverged
 * from the proposal's baseline, and a ward with one removed member, so the
 * divergence section, all four cards, and the CSV have content.
 */

/** The fictional re-import / removal timestamp shown in the preview. */
export const PREVIEW_IMPORTED_AT = '2026-10-24T12:00:00Z';

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function applyStep(stepName: string, result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`summary preview step failed (${stepName}): ${result.error.message}`);
  }
  return result.board;
}

/**
 * Builds the preview's Current: core ops only edit boards of kind `proposal`,
 * so the ops run on a proposal-kind copy of Current — one occupied list
 * position removed, one new vacant single added — then the copy is returned
 * to kind `current`.
 */
function divergedCurrent(data: PreviewData): Board {
  const { current } = data;
  const ctx: OperationContext = { ward: data.ward, ids: sequentialIds('summary-preview') };

  const occupiedListPosition = Object.values(current.positions).find((position) => {
    if (!Object.hasOwn(current.placements, position.id)) {
      return false;
    }
    const assignment = current.assignments[position.assignmentId];
    return assignment !== undefined && assignment.type === 'list';
  });
  const positionId = requireDefined(
    occupiedListPosition?.id,
    'summary preview needs an occupied list position to remove',
  );

  let working: Board = { ...current, kind: 'proposal' };
  working = applyStep('removePosition', removePosition(working, ctx, { positionId }));

  const teacherAssignment = Object.values(working.assignments).find(
    (assignment) => assignment.title === 'Relief Society Teacher',
  );
  const groupId = requireDefined(teacherAssignment?.groupId, 'summary preview needs the Relief Society Teachers group');

  working = applyStep(
    'addAssignment',
    addAssignment(working, ctx, {
      groupId,
      title: 'Relief Society Visiting Teacher',
      type: 'single',
      positionCount: 1,
    }),
  );

  return { ...working, kind: 'current' };
}

/** A structural ward copy with one placed member given a fixed fictional `removedDate`. */
function removedMemberWard(data: PreviewData): Ward {
  const { ward, proposal } = data;
  const firstPlacement = Object.entries(proposal.board.placements)[0];
  const memberId = requireDefined(firstPlacement?.[1], 'summary preview needs a member placed on the proposal board');
  const member = requireDefined(ward.members[memberId], `summary preview ward is missing ${memberId}`);
  return {
    ...ward,
    members: {
      ...ward.members,
      [memberId]: { ...member, removedDate: PREVIEW_IMPORTED_AT },
    },
  };
}

function SummaryPreview(data: PreviewData): ReactElement {
  const ward = removedMemberWard(data);
  const current = divergedCurrent(data);
  return (
    <Summary
      proposal={data.proposal}
      current={current}
      ward={ward}
      importedAt={PREVIEW_IMPORTED_AT}
      onExit={() => undefined}
    />
  );
}

const preview: PreviewModule = {
  title: 'Proposal summary',
  render: SummaryPreview,
};

export default preview;
