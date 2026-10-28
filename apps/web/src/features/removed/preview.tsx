import type { ReactElement } from 'react';
import {
  boardId,
  createBoard,
  removePosition,
  removedState,
  sequentialIds,
  type Board,
  type CallingGroup,
  type Member,
  type OperationContext,
  type PositionId,
  type Result,
  type Ward,
} from '@wardboard/core';
import type { PreviewData, PreviewModule } from '../../preview/types.ts';
import { GroupDetail } from '../group-view/GroupDetail.tsx';
import { RemovedSummary } from './RemovedSummary.tsx';
import { removedRows } from './rows.ts';
import './removed.css';

const noOp = () => undefined;

function unwrap<T>(result: Result<T>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

function findMember(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((candidate) => candidate.name === name);
  if (member === undefined) {
    throw new Error(`preview member ${name} not found`);
  }
  return member;
}

function findGroupNamed(board: Board, name: string): CallingGroup {
  const group = Object.values(board.callingGroups).find((candidate) => candidate.name === name);
  if (group === undefined) {
    throw new Error(`preview calling group ${name} not found`);
  }
  return group;
}

function occupiedSlotInGroup(board: Board, group: CallingGroup, member: Member): PositionId {
  const assignments = new Set(
    Object.values(board.assignments)
      .filter((assignment) => assignment.groupId === group.id)
      .map((assignment) => assignment.id),
  );
  const slot = Object.values(board.positions).find(
    (position) => assignments.has(position.assignmentId) && board.placements[position.id] === member.id,
  );
  if (slot === undefined) {
    throw new Error(`${member.name} does not occupy a slot in ${group.name}`);
  }
  return slot.id;
}

interface RemovedPreviewScenario {
  readonly ward: Ward;
  readonly current: Board;
  readonly removed: ReturnType<typeof removedState>;
}

/**
 * The preview scenario (SPEC §8):
 * - Jo Testwell (the fixture's two-calling member: Relief Society Teacher +
 *   Nursery Leader) is given a `removed_date`;
 * - a `current` board is derived from the proposal's baseline with one
 *   occupied position's lineage removed (Kit Notreal's teacher slot).
 * The scenario is rebuilt from the harness's fixture on every render; nothing
 * in the shared preview data is mutated.
 */
function buildScenario(data: PreviewData): RemovedPreviewScenario {
  const { ward, proposal } = data;
  const board = proposal.board;

  const jo = findMember(ward, 'Jo Testwell');
  if (!Object.values(board.positions).some((slot) => board.placements[slot.id] === jo.id)) {
    throw new Error('preview: Jo Testwell is not placed in the proposal board');
  }
  const removedWard: Ward = {
    ...ward,
    members: { ...ward.members, [jo.id]: { ...jo, removedDate: '2026-01-10' } },
  };

  const kit = findMember(ward, 'Kit Notreal');
  const kitSlot = occupiedSlotInGroup(proposal.baseline, findGroupNamed(proposal.baseline, 'Relief Society Teachers'), kit);
  const working = unwrap(
    createBoard({ ...proposal.baseline, id: boardId('pr-removed-preview-work'), kind: 'proposal' }, ward),
    'preview working board',
  );
  const ctx: OperationContext = { ward, ids: sequentialIds('removed-preview') };
  const trimmed = removePosition(working, ctx, { positionId: kitSlot });
  if (!trimmed.ok) {
    throw new Error(`preview: removePosition failed: ${trimmed.error.message}`);
  }
  const derivedCurrent = unwrap(
    createBoard({ ...trimmed.board, id: boardId('pr-removed-preview-current'), kind: 'current' }, ward),
    'preview derived current',
  );

  return {
    ward: removedWard,
    current: derivedCurrent,
    removed: removedState(proposal, derivedCurrent, removedWard),
  };
}

function RemovedPreview({ data }: { data: PreviewData }): ReactElement {
  const scenario = buildScenario(data);
  const board = data.proposal.board;
  const teachers = findGroupNamed(board, 'Relief Society Teachers');
  const rows = removedRows(data.proposal, scenario.current, scenario.ward);

  return (
    <div className="wb-removed-preview">
      <RemovedSummary rows={rows} />
      <GroupDetail
        board={board}
        ward={scenario.ward}
        baseline={data.proposal.baseline}
        callingGroupId={teachers.id}
        readOnly
        onAddPosition={noOp}
        onAddGroup={noOp}
        removed={scenario.removed}
      />
    </div>
  );
}

const preview: PreviewModule = {
  title: 'Removed markers',
  render: (data) => <RemovedPreview data={data} />,
};

export default preview;
