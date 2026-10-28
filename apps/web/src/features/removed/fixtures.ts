import {
  boardId,
  createBoard,
  removeAssignment,
  removePosition,
  removedState,
  sequentialIds,
  type Board,
  type CallingGroup,
  type Member,
  type OperationContext,
  type Position,
  type RemovedState,
  type Result,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import type { PreviewData } from '../../preview/types.ts';

/**
 * Scenario builders for the removed-markers tests. The fixture is the fictional
 * preview ward; every name is invented. The scenario is the one the preview
 * shows: one placed member given a `removed_date` (Jo Testwell, the fixture's
 * two-calling member) and one occupied position's lineage removed from a
 * `current` derived from the proposal's baseline (Kit Notreal's teacher slot).
 */

export const REMOVED_DATE = '2026-01-10';

export interface RemovedScenario {
  readonly data: PreviewData;
  readonly ward: Ward;
  readonly current: Board;
  readonly removed: RemovedState;
}

function unwrap<T>(result: Result<T>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} is invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function findMember(ward: Ward, name: string): Member {
  const member = Object.values(ward.members).find((candidate) => candidate.name === name);
  if (member === undefined) {
    throw new Error(`fixture member ${name} not found`);
  }
  return member;
}

export function findGroup(board: Board, name: string): CallingGroup {
  const group = Object.values(board.callingGroups).find((candidate) => candidate.name === name);
  if (group === undefined) {
    throw new Error(`fixture calling group ${name} not found`);
  }
  return group;
}

export function slotOfOccupant(board: Board, group: CallingGroup, member: Member): Position {
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
  return slot;
}

export function slotByTitle(board: Board, group: CallingGroup, title: string): Position {
  const assignment = Object.values(board.assignments).find(
    (candidate) => candidate.groupId === group.id && candidate.title === title,
  );
  if (assignment === undefined) {
    throw new Error(`assignment ${title} not found in ${group.name}`);
  }
  const slot = Object.values(board.positions).find((position) => position.assignmentId === assignment.id);
  if (slot === undefined) {
    throw new Error(`assignment ${title} in ${group.name} has no position`);
  }
  return slot;
}

/** A ward copy in which one member has a non-null `removed_date`. */
export function withRemovedDate(ward: Ward, memberName: string): Ward {
  const member = findMember(ward, memberName);
  return {
    ...ward,
    members: { ...ward.members, [member.id]: { ...member, removedDate: REMOVED_DATE } },
  };
}

/**
 * Derives a `current` board from `source` with one occupied position's lineage
 * removed, the way an import re-import would drop it. `removePosition` trims a
 * list slot; `removeAssignment` is needed for a single.
 */
export function currentWithoutOccupant(
  ward: Ward,
  source: Board,
  groupName: string,
  occupantName: string,
): Board {
  const member = findMember(ward, occupantName);
  const group = findGroup(source, groupName);
  const slot = slotOfOccupant(source, group, member);
  const working = unwrap(
    createBoard({ ...source, id: boardId('removed-test-work'), kind: 'proposal' }, ward),
    'working board',
  );
  const assignment = working.assignments[slot.assignmentId];
  if (assignment === undefined) {
    throw new Error('missing assignment');
  }
  const ctx: OperationContext = { ward, ids: sequentialIds('removed-test') };
  const trimmed =
    assignment.type === 'list'
      ? removePosition(working, ctx, { positionId: slot.id })
      : removeAssignment(working, ctx, { assignmentId: slot.assignmentId });
  if (!trimmed.ok) {
    throw new Error(`trimming ${occupantName} failed: ${trimmed.error.message}`);
  }
  return unwrap(
    createBoard({ ...trimmed.board, id: boardId('removed-test-current'), kind: 'current' }, ward),
    'derived current',
  );
}

/** Jo Testwell removed from Current; Kit Notreal's teacher slot lost from a derived Current. */
export function buildRemovedScenario(): RemovedScenario {
  const data = buildPreviewData();
  const ward = withRemovedDate(data.ward, 'Jo Testwell');
  const current = currentWithoutOccupant(data.ward, data.current, 'Relief Society Teachers', 'Kit Notreal');
  const removed = removedState(data.proposal, current, ward);
  return { data, ward, current, removed };
}

/** Faye Pretend removed from Current; the Relief Society secretary slot lost from a derived Current. */
export function buildOrgRemovedScenario(): {
  readonly data: PreviewData;
  readonly ward: Ward;
  readonly current: Board;
  readonly removed: RemovedState;
} {
  const data = buildPreviewData();
  const ward = withRemovedDate(data.ward, 'Faye Pretend');
  const current = currentWithoutOccupant(data.ward, data.current, 'Relief Society Presidency', 'Iris Demo');
  const removed = removedState(data.proposal, current, ward);
  return { data, ward, current, removed };
}
