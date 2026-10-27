import { describe, expect, it } from 'vitest';
import {
  addAssignment,
  addCallingGroup,
  addListPosition,
  callingGroupId,
  placeInPosition,
  type AssignmentId,
  type Board,
  type CallingAssignment,
  type CallingGroup,
  type CallingGroupId,
  type Position,
  type PositionId,
} from '../../src/index.ts';
import type { DetailPosition, GroupDetail } from '../../src/derive/group-detail.ts';
import { groupDetail } from '../../src/index.ts';
import {
  assignmentNamed,
  contextFor,
  expectOk,
  fixtureSetup,
  memberNamed,
  positionNamed,
  positionsOf,
} from '../ops/helpers.ts';

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

function callingGroupNamed(board: Board, name: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`no calling group named ${name}`);
  }
  return found;
}

function withAssignment(board: Board, id: AssignmentId, patch: Partial<CallingAssignment>): Board {
  const current = required(board.assignments[id], `assignment ${id} missing`);
  return {
    ...board,
    assignments: {
      ...board.assignments,
      [id]: { ...current, ...patch },
    },
  };
}

function withPosition(board: Board, id: PositionId, patch: Partial<Position>): Board {
  const current = required(board.positions[id], `position ${id} missing`);
  return {
    ...board,
    positions: {
      ...board.positions,
      [id]: { ...current, ...patch },
    },
  };
}

function withGroupOrder(board: Board, id: CallingGroupId, order: number): Board {
  const current = required(board.callingGroups[id], `calling group ${id} missing`);
  return {
    ...board,
    callingGroups: {
      ...board.callingGroups,
      [id]: { ...current, order },
    },
  };
}

function positionIn(detail: GroupDetail, id: PositionId): DetailPosition {
  for (const section of detail.sections) {
    for (const assignment of section.assignments) {
      for (const position of assignment.positions) {
        if (position.positionId === id) {
          return position;
        }
      }
    }
  }
  throw new Error(`position ${id} is not in the group detail`);
}

describe('groupDetail', () => {
  it('sections are the group then nested groups depth-first with depth', () => {
    const { board, ward, baseline } = fixtureSetup();
    const ctx = contextFor(ward);
    const root = callingGroupNamed(board, 'Gospel Doctrine');
    expect(root.parent.kind).toBe('boardGroup');

    let next = expectOk(
      addCallingGroup(board, ctx, { parent: { kind: 'callingGroup', id: root.id }, name: 'Zed', kind: 'class' }),
    );
    next = expectOk(
      addCallingGroup(next, ctx, { parent: { kind: 'callingGroup', id: root.id }, name: 'Amy', kind: 'class' }),
    );
    next = expectOk(
      addCallingGroup(next, ctx, { parent: { kind: 'callingGroup', id: root.id }, name: 'Later', kind: 'class' }),
    );
    const zed = callingGroupNamed(next, 'Zed');
    const amy = callingGroupNamed(next, 'Amy');
    const later = callingGroupNamed(next, 'Later');
    expect(zed.id.localeCompare(amy.id, 'en')).toBeLessThan(0);

    next = expectOk(
      addCallingGroup(next, ctx, { parent: { kind: 'callingGroup', id: zed.id }, name: 'Nested', kind: 'committee' }),
    );
    const nested = callingGroupNamed(next, 'Nested');

    // Same order must break on id, not name: "Amy" sorts before "Zed" alphabetically.
    next = withGroupOrder(next, zed.id, 0);
    next = withGroupOrder(next, amy.id, 0);
    next = withGroupOrder(next, later.id, 1);

    const detail = groupDetail(next, ward, root.id, baseline);
    if (root.parent.kind !== 'boardGroup') {
      throw new Error('Gospel Doctrine is not a top-level group');
    }
    expect(detail.callingGroupId).toBe(root.id);
    expect(detail.name).toBe('Gospel Doctrine');
    expect(detail.boardGroupId).toBe(root.parent.id);
    expect(detail.sections.map((section) => ({ name: section.name, depth: section.depth, id: section.callingGroupId }))).toEqual([
      { name: 'Gospel Doctrine', depth: 0, id: root.id },
      { name: 'Zed', depth: 1, id: zed.id },
      { name: 'Nested', depth: 2, id: nested.id },
      { name: 'Amy', depth: 1, id: amy.id },
      { name: 'Later', depth: 1, id: later.id },
    ]);
  });

  it('only enabled assignments, ordered', () => {
    const { board, ward, baseline } = fixtureSetup();
    const group = callingGroupNamed(board, 'Sunday School Presidency');
    const president = assignmentNamed(board, 'Sunday School Presidency', 'President');
    const first = assignmentNamed(board, 'Sunday School Presidency', 'First Counselor');
    const secretary = assignmentNamed(board, 'Sunday School Presidency', 'Secretary');
    expect(president.id.localeCompare(first.id, 'en')).toBeLessThan(0);

    let next = withAssignment(board, secretary.id, { enabled: false });
    next = withAssignment(next, president.id, { order: 5 });
    next = withAssignment(next, first.id, { order: 1 });

    const reversed = groupDetail(next, ward, group.id, baseline);
    expect(reversed.sections[0]?.assignments.map((assignment) => assignment.title)).toEqual([
      'First Counselor',
      'President',
    ]);
    expect(reversed.sections.flatMap((section) => section.assignments.map((assignment) => assignment.title))).not.toContain(
      'Secretary',
    );

    const tied = withAssignment(withAssignment(next, president.id, { order: 4 }), first.id, { order: 4 });
    const sameOrder = groupDetail(tied, ward, group.id, baseline);
    expect(sameOrder.sections[0]?.assignments.map((assignment) => assignment.title)).toEqual([
      'President',
      'First Counselor',
    ]);
  });

  it('disabled count includes nested groups', () => {
    const { board, ward, baseline } = fixtureSetup();
    const ctx = contextFor(ward, 'disabled');
    const root = callingGroupNamed(board, 'Elders Quorum Instructors');
    const instructor = assignmentNamed(board, 'Elders Quorum Instructors', 'Elders Quorum Instructor');

    let next = withAssignment(board, instructor.id, { enabled: false });
    next = expectOk(
      addCallingGroup(next, ctx, { parent: { kind: 'callingGroup', id: root.id }, name: 'Specialists', kind: 'class' }),
    );
    const specialists = callingGroupNamed(next, 'Specialists');
    next = expectOk(
      addAssignment(next, ctx, { groupId: specialists.id, title: 'Active', type: 'single', positionCount: 1 }),
    );
    next = expectOk(
      addAssignment(next, ctx, { groupId: specialists.id, title: 'Paused', type: 'single', positionCount: 1 }),
    );
    next = withAssignment(next, assignmentNamed(next, 'Specialists', 'Paused').id, { enabled: false });

    next = expectOk(
      addCallingGroup(next, ctx, {
        parent: { kind: 'callingGroup', id: specialists.id },
        name: 'Deep',
        kind: 'committee',
      }),
    );
    const deep = callingGroupNamed(next, 'Deep');
    next = expectOk(addAssignment(next, ctx, { groupId: deep.id, title: 'Shelved', type: 'list', positionCount: 2 }));
    next = withAssignment(next, assignmentNamed(next, 'Deep', 'Shelved').id, { enabled: false });

    const organist = assignmentNamed(next, 'Music', 'Organist');
    next = withAssignment(next, organist.id, { enabled: false });

    const detail = groupDetail(next, ward, root.id, baseline);
    expect(detail.disabledAssignmentCount).toBe(3);
    expect(detail.sections.flatMap((section) => section.assignments.map((assignment) => assignment.title))).toEqual([
      'Active',
    ]);
  });

  it('list positions ordered with filled count', () => {
    const { board, ward } = fixtureSetup();
    const group = callingGroupNamed(board, 'Relief Society Teachers');
    const assignment = assignmentNamed(board, 'Relief Society Teachers', 'Relief Society Teacher');
    const original = positionsOf(board, assignment.id);
    expect(original).toHaveLength(4);

    let reordered = board;
    for (let index = 0; index < original.length; index += 1) {
      const position = required(original[index], `position ${String(index)} missing`);
      reordered = withPosition(reordered, position.id, { order: original.length - 1 - index });
    }

    const detail = groupDetail(reordered, ward, group.id, null);
    const row = required(detail.sections[0]?.assignments[0], 'list assignment missing');
    const expectedIds = [...original].reverse().map((position) => position.id);
    expect(row.type).toBe('list');
    expect(row.assignmentId).toBe(assignment.id);
    expect(row.filledCount).toBe(3);
    expect(row.positions.map((position) => position.positionId)).toEqual(expectedIds);
    expect(row.positions[0]?.memberId).toBeNull();
    expect(row.positions.filter((position) => position.memberId !== null)).toHaveLength(3);
  });

  it('preference matches only for occupants with matching tags', () => {
    const { board, ward, baseline } = fixtureSetup();
    const teaches = required(
      Object.values(ward.tags).find((tag) => tag.name === 'Teaches well'),
      'Teaches well tag missing',
    );
    const quinn = memberNamed(ward, 'Quinn Mockup');
    const instructors = callingGroupNamed(board, 'Elders Quorum Instructors');
    const detail = groupDetail(board, ward, instructors.id, baseline);
    const assignment = required(detail.sections[0]?.assignments[0], 'instructor assignment missing');
    expect(assignment.title).toBe('Elders Quorum Instructor');
    expect(assignment.preferredMemberTagIds).toEqual([teaches.id]);

    const occupied = required(
      assignment.positions.find((position) => position.memberId === quinn),
      'Quinn is not in the instructor list',
    );
    const vacant = required(
      assignment.positions.find((position) => position.memberId === null),
      'instructor vacancy missing',
    );
    expect(occupied.preferenceMatches).toEqual([teaches.id]);
    expect(vacant.preferenceMatches).toEqual([]);

    const primary = callingGroupNamed(board, 'Primary Teachers');
    const primaryDetail = groupDetail(board, ward, primary.id, baseline);
    const teachers = required(
      primaryDetail.sections[0]?.assignments.find((item) => item.title === 'Primary Teacher'),
      'Primary Teacher missing',
    );
    const bea = memberNamed(ward, 'Bea Placeholder');
    const cy = memberNamed(ward, 'Cy Mockup');
    expect(teachers.positions.find((position) => position.memberId === bea)?.preferenceMatches).toEqual([teaches.id]);
    expect(teachers.positions.find((position) => position.memberId === cy)?.preferenceMatches).toEqual([]);
  });

  it('proposed flag from net diff, none without baseline', () => {
    const { board, ward, baseline } = fixtureSetup();
    const ctx = contextFor(ward, 'proposed');
    const group = callingGroupNamed(board, 'Sunday School Presidency');
    const vacantId = positionNamed(board, 'Sunday School Presidency', 'First Counselor');
    const presidentId = positionNamed(board, 'Sunday School Presidency', 'President');
    const ivy = memberNamed(ward, 'Ivy Notreal');

    const placed = expectOk(placeInPosition(board, ctx, { memberId: ivy, from: null, to: vacantId }));
    const withBaseline = groupDetail(placed, ward, group.id, baseline);
    expect(positionIn(withBaseline, vacantId)).toMatchObject({ memberId: ivy, proposed: true });
    expect(positionIn(withBaseline, presidentId).proposed).toBe(false);

    const withoutBaseline = groupDetail(placed, ward, group.id, null);
    expect(positionIn(withoutBaseline, vacantId).proposed).toBe(false);
    expect(positionIn(withoutBaseline, presidentId).proposed).toBe(false);
  });

  it('added list position appears as vacant', () => {
    const { board, ward, baseline } = fixtureSetup();
    const ctx = contextFor(ward, 'added');
    const group = callingGroupNamed(board, 'Gospel Doctrine');
    const assignment = assignmentNamed(board, 'Gospel Doctrine', 'Gospel Doctrine Teacher');
    const before = groupDetail(board, ward, group.id, baseline);
    const beforeRow = required(before.sections[0]?.assignments[0], 'gospel doctrine list missing');
    const beforeIds = beforeRow.positions.map((position) => position.positionId);

    const added = expectOk(addListPosition(board, ctx, { assignmentId: assignment.id }));
    const after = groupDetail(added, ward, group.id, baseline);
    const afterRow = required(after.sections[0]?.assignments[0], 'gospel doctrine list missing after add');
    const addedPosition = required(afterRow.positions.at(-1), 'added position missing');

    expect(afterRow.filledCount).toBe(beforeRow.filledCount);
    expect(afterRow.positions).toHaveLength(beforeRow.positions.length + 1);
    expect(beforeIds).not.toContain(addedPosition.positionId);
    expect(addedPosition.memberId).toBeNull();
    expect(addedPosition.preferenceMatches).toEqual([]);
    expect(addedPosition.proposed).toBe(false);
  });

  it('unknown group throws TypeError', () => {
    const { board, ward, baseline } = fixtureSetup();
    expect(() => groupDetail(board, ward, callingGroupId('cg-missing'), baseline)).toThrow(TypeError);
    expect(() => groupDetail(board, ward, callingGroupId('cg-missing'), null)).toThrow(TypeError);
  });
});
