import { describe, expect, it } from 'vitest';
import {
  addAssignment,
  addCallingGroup,
  boardGroupId,
  placeInPosition,
  type Board,
  type BoardGroupId,
  type CallingGroup,
} from '../../src/index.ts';
import { organizationView } from '../../src/derive/organization.ts';
import { contextFor, fixtureSetup } from '../ops/helpers.ts';

function required<T>(value: T | undefined | null, message = 'value is undefined or null'): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function findBoardGroupByKey(board: Board, key: string): BoardGroupId {
  const found = Object.values(board.boardGroups).find((bg) => bg.key === key);
  if (found === undefined) {
    throw new Error(`fixture board group with key ${key} not found`);
  }
  return found.id;
}

function findCallingGroupByKey(board: Board, key: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((cg) => cg.key === key);
  if (found === undefined) {
    throw new Error(`fixture calling group with key ${key} not found`);
  }
  return found;
}

describe('organizationView', () => {
  it('presidency positions become leadership, including the secretary', () => {
    const { board, baseline } = fixtureSetup();
    const rsId = findBoardGroupByKey(board, 'relief_society');
    const view = organizationView(board, rsId, baseline);

    expect(view.leadership.map((c) => c.title)).toEqual([
      'President',
      'First Counselor',
      'Second Counselor',
      'Secretary',
    ]);
    expect(view.groups.every((g) => !g.name.includes('Presidency'))).toBe(true);
  });

  it('bishopric group is leadership; support group is a row', () => {
    const { board, baseline } = fixtureSetup();
    const bId = findBoardGroupByKey(board, 'bishopric');
    const view = organizationView(board, bId, baseline);

    expect(view.leadership.map((c) => c.title)).toEqual([
      'Bishop',
      'First Counselor',
      'Second Counselor',
    ]);

    const supportRow = view.groups.find((g) => g.name.includes('Clerks') || g.name.includes('support'));
    expect(supportRow).toBeDefined();
    expect(supportRow?.callingGroupId).toBe(findCallingGroupByKey(board, 'bishopric_support').id);
  });

  it('rows roll up nested groups', () => {
    const { board, ward, baseline } = fixtureSetup();
    const ctx = contextFor(ward);
    const ssId = findBoardGroupByKey(board, 'sunday_school');

    const viewBefore = organizationView(board, ssId, baseline);
    const gdRowBefore = required(
      viewBefore.groups.find((g) => g.name === 'Gospel Doctrine'),
      'Gospel Doctrine row not found',
    );
    const vacBefore = gdRowBefore.vacantCount;

    // Add a nested calling group under Gospel Doctrine
    const addGroupResult = addCallingGroup(board, ctx, {
      parent: { kind: 'callingGroup', id: gdRowBefore.callingGroupId },
      name: 'Class Committee',
      kind: 'class',
    });
    expect(addGroupResult.ok).toBe(true);
    if (!addGroupResult.ok) return;

    // Add an assignment with 1 vacant position to the nested group
    const newGroupId = required(
      Object.values(addGroupResult.board.callingGroups).find((g) => g.name === 'Class Committee'),
      'Class Committee group not found',
    ).id;
    const addAssignmentResult = addAssignment(addGroupResult.board, ctx, {
      groupId: newGroupId,
      title: 'Committee Member',
      type: 'single',
      positionCount: 1,
    });
    expect(addAssignmentResult.ok).toBe(true);
    if (!addAssignmentResult.ok) return;

    const viewAfter = organizationView(addAssignmentResult.board, ssId, baseline);
    const gdRowAfter = viewAfter.groups.find((g) => g.callingGroupId === gdRowBefore.callingGroupId);

    // Parent row's vacant count rolled up the nested vacancy
    expect(gdRowAfter?.vacantCount).toBe(vacBefore + 1);
    // Nested group does not appear as its own top-level row
    expect(viewAfter.groups.some((g) => g.name === 'Class Committee')).toBe(false);
  });

  it('disabled assignments are not counted', () => {
    const { board, baseline } = fixtureSetup();
    const eqId = findBoardGroupByKey(board, 'elders_quorum');

    const viewBefore = organizationView(board, eqId, baseline);
    const instructorsRowBefore = required(
      viewBefore.groups.find((g) => g.name === 'Elders Quorum Instructors'),
      'Instructors row not found',
    );

    // Disable the assignment
    const assignmentToDisable = required(
      Object.values(board.assignments).find((a) => a.groupId === instructorsRowBefore.callingGroupId),
      'Assignment not found',
    );
    const boardWithDisabled = {
      ...board,
      assignments: {
        ...board.assignments,
        [assignmentToDisable.id]: {
          ...assignmentToDisable,
          enabled: false,
        },
      },
    };

    const viewAfter = organizationView(boardWithDisabled, eqId, baseline);
    const instructorsRowAfter = viewAfter.groups.find((g) => g.callingGroupId === instructorsRowBefore.callingGroupId);
    expect(instructorsRowAfter?.filledCount).toBe(0);
    expect(instructorsRowAfter?.vacantCount).toBe(0);
  });

  it('row overseer follows oversight with inheritance', () => {
    const { board, baseline } = fixtureSetup();
    const apId = findBoardGroupByKey(board, 'aaronic_priesthood');
    const view = organizationView(board, apId, baseline);

    const priestsRow = view.groups.find((g) => g.name === 'Priests Quorum');
    const teachersRow = view.groups.find((g) => g.name === 'Teachers Quorum');
    const deaconsRow = view.groups.find((g) => g.name === 'Deacons Quorum');

    expect(priestsRow?.overseer).toBe('bishop');
    expect(teachersRow?.overseer).toBe('first_counselor');
    expect(deaconsRow?.overseer).toBe('second_counselor');
  });

  it('org overseer defaults to bishop', () => {
    const { board, baseline } = fixtureSetup();
    // Relief Society has no explicit oversight entry in fixture, defaults to bishop
    const rsId = findBoardGroupByKey(board, 'relief_society');
    const view = organizationView(board, rsId, baseline);
    expect(view.overseer).toBe('bishop');
  });

  it('proposed flag only for diff callings, none without baseline', () => {
    const { board, baseline, ward } = fixtureSetup();
    const ctx = contextFor(ward);
    const ssId = findBoardGroupByKey(board, 'sunday_school');

    // Sunday School Presidency has a vacant First Counselor position
    const ssViewBefore = organizationView(board, ssId, baseline);
    const vacantLeader = required(
      ssViewBefore.leadership.find((c) => c.memberId === null),
      'Vacant leader not found',
    );
    const targetPos = vacantLeader.positionId;

    // Pick an unassigned ward member
    const placedMembers = new Set(Object.values(board.placements));
    const unassigned = required(
      Object.values(ward.members).find((m) => !placedMembers.has(m.id)),
      'Unassigned member not found',
    );

    const placedResult = placeInPosition(board, ctx, {
      memberId: unassigned.id,
      from: null,
      to: targetPos,
    });
    expect(placedResult.ok).toBe(true);
    if (!placedResult.ok) return;

    const viewWithBaseline = organizationView(placedResult.board, ssId, baseline);
    const cardWithBaseline = viewWithBaseline.leadership.find((c) => c.positionId === targetPos);
    expect(cardWithBaseline?.proposed).toBe(true);

    const viewWithoutBaseline = organizationView(placedResult.board, ssId, null);
    const cardWithoutBaseline = viewWithoutBaseline.leadership.find((c) => c.positionId === targetPos);
    expect(cardWithoutBaseline?.proposed).toBe(false);
  });

  it('unknown board group throws TypeError', () => {
    const { board } = fixtureSetup();
    expect(() => organizationView(board, boardGroupId('bogus-bg'), null)).toThrow(TypeError);
  });

  it('handles organizations with no leadership groups and no rows', () => {
    const { board } = fixtureSetup();
    // Ward-wide has no presidency/bishopric group
    const wwId = findBoardGroupByKey(board, 'ward_wide');
    const view = organizationView(board, wwId, null);
    expect(view.leadership).toEqual([]);
    expect(view.groups.length).toBeGreaterThan(0);

    // Board group with neither leadership nor rows
    const emptyBgId = boardGroupId('bg-empty');
    const boardWithEmpty = {
      ...board,
      boardGroups: {
        ...board.boardGroups,
        [emptyBgId]: {
          id: emptyBgId,
          name: 'Empty Org',
          order: 99,
          visible: true,
          key: null,
        },
      },
    };
    const emptyView = organizationView(boardWithEmpty, emptyBgId, null);
    expect(emptyView.leadership).toEqual([]);
    expect(emptyView.groups).toEqual([]);
  });
});
