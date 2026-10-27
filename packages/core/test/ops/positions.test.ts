import { describe, expect, it } from 'vitest';
import { buildFixtureProposal } from '../../src/fixtures/index.ts';
import {
  addAssignment,
  addCallingGroup,
  addListPosition,
  assignmentId,
  boardGroupId,
  callingGroupId,
  lineageId,
  memberId,
  moveGroup,
  positionId,
  POSITION_ERROR_CODES,
  proposalId,
  removeAssignment,
  removePosition,
  renameGroup,
  setBoardGroupVisible,
  userId,
  type Approval,
  type Board,
  type BoardGroup,
  type CallingGroup,
  type CallingGroupParent,
  type MemberId,
  type OperationContext,
  type OperationResult,
  type Position,
  type PositionId,
} from '../../src/index.ts';
import {
  assignmentNamed,
  contextFor,
  expectError,
  expectOk,
  fixtureSetup,
  holdingsOf,
  isDeeplyFrozen,
  memberNamed,
  positionNamed,
  positionsOf,
  rebuild,
  SMALL,
  smallBoard,
  smallWard,
} from './helpers.ts';

const RS_TEACHERS = ['Relief Society Teachers', 'Relief Society Teacher'] as const;
const NURSERY = ['Nursery', 'Nursery Leader'] as const;
const APPROVED_AT = '2026-01-05T09:00:00Z';

function approval(member: MemberId, position: PositionId): Approval {
  return { memberId: member, positionId: position, approvedBy: userId('u-admin'), approvedAt: APPROVED_AT };
}

function generatedContext(ward: OperationContext['ward'], generated: string[], prefix = 'gen'): OperationContext {
  const ids = contextFor(ward, prefix).ids;
  return {
    ward,
    ids: () => {
      const id = ids();
      generated.push(id);
      return id;
    },
  };
}

function positionAt(board: Board, id: PositionId): Position {
  const position = board.positions[id];
  if (position === undefined) {
    throw new Error(`missing position ${id}`);
  }
  return position;
}

function soleCallingGroup(board: Board): CallingGroup {
  const groups = Object.values(board.callingGroups);
  const only = groups[0];
  if (groups.length !== 1 || only === undefined) {
    throw new Error(`expected one calling group, found ${String(groups.length)}`);
  }
  return only;
}

function boardGroupKeyed(board: Board, key: string): BoardGroup {
  const found = Object.values(board.boardGroups).find((group) => group.key === key);
  if (found === undefined) {
    throw new Error(`no board group ${key}`);
  }
  return found;
}

function callingGroupNamed(board: Board, name: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`no calling group ${name}`);
  }
  return found;
}

function siblingsOf(board: Board, parent: CallingGroupParent): CallingGroup[] {
  return Object.values(board.callingGroups)
    .filter((group) => group.parent.kind === parent.kind && group.parent.id === parent.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function sortedByOrder<T extends { readonly order: number; readonly id: string }>(items: readonly T[]): T[] {
  return items.slice().sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

/** One call of every structural operation, using ids that exist on a fixture board. */
function allOperations(board: Board, ward: OperationContext['ward']): OperationResult[] {
  const relief = boardGroupKeyed(board, 'relief_society');
  const teachers = callingGroupNamed(board, 'Relief Society Teachers');
  const list = assignmentNamed(board, ...RS_TEACHERS);
  const vacant = positionNamed(board, ...RS_TEACHERS, 3);
  const ctx = contextFor(ward);
  return [
    addCallingGroup(board, ctx, { parent: { kind: 'boardGroup', id: relief.id }, name: 'Activities', kind: 'committee' }),
    renameGroup(board, ctx, { target: { kind: 'boardGroup', id: relief.id }, name: 'Renamed Relief Society' }),
    setBoardGroupVisible(board, ctx, { boardGroupId: relief.id, visible: false }),
    moveGroup(board, ctx, { target: { kind: 'callingGroup', id: teachers.id }, toIndex: 0 }),
    addAssignment(board, ctx, { groupId: teachers.id, title: 'Pianist', type: 'single', positionCount: 1 }),
    addListPosition(board, ctx, { assignmentId: list.id }),
    removePosition(board, ctx, { positionId: vacant }),
    removeAssignment(board, ctx, { assignmentId: list.id }),
  ];
}

describe('addCallingGroup', () => {
  it('addCallingGroup appends a group under its parent', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const existing = soleCallingGroup(base);
    const board = rebuild(base, ward, {
      callingGroups: { [existing.id]: { ...existing, order: 5 } },
    });
    const current = soleCallingGroup(board);
    expect(current.order).toBe(5);
    if (current.parent.kind !== 'boardGroup') {
      throw new Error('expected the calling group to sit under a board group');
    }
    const generated: string[] = [];
    const ctx = generatedContext(ward, generated);

    const underBoard = expectOk(
      addCallingGroup(board, ctx, { parent: { kind: 'boardGroup', id: current.parent.id }, name: '  Activities ', kind: 'committee' }),
    );
    const created = underBoard.callingGroups[callingGroupId('gen-0001')];
    expect(generated).toEqual(['gen-0001']);
    expect(created).toEqual({
      id: callingGroupId('gen-0001'),
      name: 'Activities',
      order: 6,
      parent: { kind: 'boardGroup', id: current.parent.id },
      kind: 'committee',
      key: null,
    });
    expect(underBoard.callingGroups[current.id]).toEqual(current);
    expect(underBoard.boardGroups).toEqual(board.boardGroups);
    expect(underBoard.assignments).toEqual(board.assignments);
    expect(underBoard.positions).toEqual(board.positions);
    expect(underBoard.placements).toEqual(board.placements);

    const underCalling = expectOk(
      addCallingGroup(underBoard, ctx, { parent: { kind: 'callingGroup', id: current.id }, name: 'Class Helpers', kind: 'class' }),
    );
    expect(generated).toEqual(['gen-0001', 'gen-0002']);
    expect(underCalling.callingGroups[callingGroupId('gen-0002')]).toEqual({
      id: callingGroupId('gen-0002'),
      name: 'Class Helpers',
      order: 0,
      parent: { kind: 'callingGroup', id: current.id },
      kind: 'class',
      key: null,
    });
    expect(underCalling.callingGroups[callingGroupId('gen-0001')]).toEqual(created);
    expect(underCalling.callingGroups[current.id]).toEqual(current);

    const snapshot = structuredClone(board);
    const blank = expectError(
      addCallingGroup(board, contextFor(ward), { parent: current.parent, name: '   ', kind: 'other' }),
    );
    const badKind = expectError(
      addCallingGroup(board, contextFor(ward), { parent: current.parent, name: 'Extra', kind: 'not-a-kind' }),
    );
    expect(blank.code).toBe('invalid_name');
    expect(badKind.code).toBe('invalid_operation');
    expect(board).toEqual(snapshot);
  });
});

describe('addAssignment', () => {
  it('addAssignment creates a custom list with vacant positions', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const group = soleCallingGroup(base);
    const l0 = base.assignments[SMALL.L0];
    if (l0 === undefined) {
      throw new Error('missing empty list');
    }
    const board = rebuild(base, ward, {
      assignments: { ...base.assignments, [SMALL.L0]: { ...l0, order: 20 } },
    });
    const generated: string[] = [];
    const next = expectOk(
      addAssignment(board, generatedContext(ward, generated), {
        groupId: group.id,
        title: '  Custom Teachers ',
        type: 'list',
        positionCount: 3,
      }),
    );

    expect(generated).toEqual(['gen-0001', 'gen-0002', 'gen-0003', 'gen-0004', 'gen-0005', 'gen-0006', 'gen-0007']);
    const id = assignmentId('gen-0001');
    expect(next.assignments[id]).toEqual({
      id,
      groupId: group.id,
      title: 'Custom Teachers',
      type: 'list',
      order: 21,
      enabled: true,
      prominent: false,
      origin: 'custom',
      leadershipRole: null,
      callingTagIds: [],
      preferredMemberTagIds: [],
    });
    const created = positionsOf(next, id);
    expect(created).toEqual([
      { id: positionId('gen-0002'), assignmentId: id, lineageId: lineageId('gen-0003'), order: 0 },
      { id: positionId('gen-0004'), assignmentId: id, lineageId: lineageId('gen-0005'), order: 1 },
      { id: positionId('gen-0006'), assignmentId: id, lineageId: lineageId('gen-0007'), order: 2 },
    ]);
    expect(new Set(created.map((position) => position.lineageId)).size).toBe(3);
    for (const position of created) {
      expect(next.placements[position.id]).toBeUndefined();
    }
    expect(next.assignments[SMALL.L0]).toEqual({ ...l0, order: 20 });

    const duplicate = expectOk(
      addAssignment(next, contextFor(ward, 'dup'), {
        groupId: group.id,
        title: 'Custom Teachers',
        type: 'list',
        positionCount: 1,
      }),
    );
    expect(duplicate.assignments[assignmentId('dup-0001')]?.title).toBe('Custom Teachers');
    expect(duplicate.assignments[id]?.title).toBe('Custom Teachers');
  });

  it('addAssignment creates a single with one position', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const group = soleCallingGroup(board);
    const generated: string[] = [];
    const next = expectOk(
      addAssignment(board, generatedContext(ward, generated), {
        groupId: group.id,
        title: 'Clerk Assistant',
        type: 'single',
        positionCount: 1,
      }),
    );

    expect(generated).toEqual(['gen-0001', 'gen-0002', 'gen-0003']);
    const id = assignmentId('gen-0001');
    expect(next.assignments[id]).toMatchObject({
      id,
      groupId: group.id,
      title: 'Clerk Assistant',
      type: 'single',
      order: 7,
      enabled: true,
      prominent: false,
      origin: 'custom',
      leadershipRole: null,
    });
    expect(positionsOf(next, id)).toEqual([
      { id: positionId('gen-0002'), assignmentId: id, lineageId: lineageId('gen-0003'), order: 0 },
    ]);
    expect(next.placements[positionId('gen-0002')]).toBeUndefined();
    expect(Object.keys(next.positions)).toHaveLength(Object.keys(board.positions).length + 1);
  });

  it('addAssignment rejects bad counts and titles', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const groupId = soleCallingGroup(board).id;
    const snapshot = structuredClone(board);
    const requests = [
      { title: 'Helper', type: 'single' as const, positionCount: 2 },
      { title: 'Helper', type: 'list' as const, positionCount: -1 },
      { title: 'Helper', type: 'list' as const, positionCount: 51 },
      { title: 'Helper', type: 'list' as const, positionCount: 1.5 },
    ];

    const codes = requests.map(
      (request) => expectError(addAssignment(board, contextFor(ward), { groupId, ...request })).code,
    );
    const blank = expectError(
      addAssignment(board, contextFor(ward), { groupId, title: '  ', type: 'list', positionCount: 1 }),
    );

    expect(codes).toEqual(['invalid_operation', 'invalid_operation', 'invalid_operation', 'invalid_operation']);
    expect(blank.code).toBe('invalid_name');
    expect(board).toEqual(snapshot);
  });

  it('addAssignment allows a list with zero positions', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const group = soleCallingGroup(board);
    const generated: string[] = [];
    const next = expectOk(
      addAssignment(board, generatedContext(ward, generated), {
        groupId: group.id,
        title: '  Optional Committee ',
        type: 'list',
        positionCount: 0,
      }),
    );

    expect(generated).toEqual(['gen-0001']);
    const id = assignmentId('gen-0001');
    expect(next.assignments[id]).toEqual({
      id,
      groupId: group.id,
      title: 'Optional Committee',
      type: 'list',
      order: 7,
      enabled: true,
      prominent: false,
      origin: 'custom',
      leadershipRole: null,
      callingTagIds: [],
      preferredMemberTagIds: [],
    });
    expect(positionsOf(next, id)).toEqual([]);
    expect(Object.keys(next.positions)).toHaveLength(Object.keys(board.positions).length);
    expect(next.placements).toEqual(board.placements);
  });
});

describe('addListPosition', () => {
  it('addListPosition adds one vacant position at the end', () => {
    const { ward, board } = fixtureSetup();
    const list = assignmentNamed(board, ...RS_TEACHERS);
    const before = positionsOf(board, list.id);
    expect(before).toHaveLength(4);
    const generated: string[] = [];
    const next = expectOk(addListPosition(board, generatedContext(ward, generated), { assignmentId: list.id }));

    expect(generated).toEqual(['gen-0001', 'gen-0002']);
    const after = positionsOf(next, list.id);
    expect(after).toHaveLength(5);
    expect(after.slice(0, 4)).toEqual(before);
    expect(after[4]).toEqual({ id: positionId('gen-0001'), assignmentId: list.id, lineageId: lineageId('gen-0002'), order: 4 });
    expect(next.placements[positionId('gen-0001')]).toBeUndefined();
    expect(next.placements).toEqual(board.placements);
    expect(next.dugoutInclusions).toEqual(board.dugoutInclusions);

    const small = smallWard();
    const gappedBase = smallBoard(small);
    const first = positionAt(gappedBase, SMALL.L1c);
    const gapped = rebuild(gappedBase, small, {
      positions: { ...gappedBase.positions, [SMALL.L1c]: { ...first, order: 10 } },
    });
    const added = expectOk(addListPosition(gapped, contextFor(small, 'gap'), { assignmentId: SMALL.L1 }));
    expect(positionsOf(added, SMALL.L1).map((position) => ({ id: position.id, order: position.order }))).toEqual([
      { id: SMALL.L1b, order: 1 },
      { id: SMALL.L1d, order: 2 },
      { id: SMALL.L1a, order: 3 },
      { id: SMALL.L1c, order: 10 },
      { id: positionId('gap-0001'), order: 11 },
    ]);
    expect(added.positions[positionId('gap-0001')]).toEqual({
      id: positionId('gap-0001'),
      assignmentId: SMALL.L1,
      lineageId: lineageId('gap-0002'),
      order: 11,
    });
    expect(added.placements[positionId('gap-0001')]).toBeUndefined();
  });

  it('addListPosition refuses singles and disabled lists', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const snapshot = structuredClone(board);

    const single = expectError(addListPosition(board, contextFor(ward), { assignmentId: SMALL.AS3 }));
    const disabledSingle = expectError(
      addListPosition(board, contextFor(ward), { assignmentId: positionAt(board, SMALL.SD).assignmentId }),
    );
    const disabledList = expectError(addListPosition(board, contextFor(ward), { assignmentId: SMALL.LD }));

    expect(single.code).toBe('wrong_assignment_type');
    expect(disabledSingle.code).toBe('wrong_assignment_type');
    expect(disabledList.code).toBe('assignment_disabled');
    expect(board).toEqual(snapshot);
  });
});

describe('removePosition', () => {
  it('removing a vacant list position reduces staffing need', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    expect(positionsOf(board, SMALL.L1)).toHaveLength(4);
    expect(board.placements[SMALL.L1b]).toBeUndefined();

    const next = expectOk(removePosition(board, contextFor(ward), { positionId: SMALL.L1b }));

    expect(positionsOf(next, SMALL.L1).map((position) => ({ id: position.id, order: position.order }))).toEqual([
      { id: SMALL.L1c, order: 0 },
      { id: SMALL.L1d, order: 2 },
      { id: SMALL.L1a, order: 3 },
    ]);
    expect(next.positions[SMALL.L1b]).toBeUndefined();
    expect(next.placements).toEqual(board.placements);
    expect(next.dugoutInclusions).toEqual(board.dugoutInclusions);
    expect(next.assignments[SMALL.L1]).toEqual(board.assignments[SMALL.L1]);
    expect(holdingsOf(next, memberId('m-1'))).toEqual(holdingsOf(board, memberId('m-1')));
    expect(holdingsOf(next, memberId('m-2'))).toEqual(holdingsOf(board, memberId('m-2')));
  });

  it('removing an occupied list position releases and includes the occupant', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const m1 = memberId('m-1');
    const m2 = memberId('m-2');
    const m3 = memberId('m-3');
    const board = rebuild(base, ward, { dugoutInclusions: [m3] });
    expect(holdingsOf(board, m1)).toEqual([SMALL.L1d, SMALL.S1, SMALL.S2].sort());

    const next = expectOk(removePosition(board, contextFor(ward), { positionId: SMALL.L1d }));

    expect(next.positions[SMALL.L1d]).toBeUndefined();
    expect(next.placements[SMALL.L1d]).toBeUndefined();
    expect(holdingsOf(next, m1)).toEqual([SMALL.S1, SMALL.S2].sort());
    expect(next.placements[SMALL.S1]).toBe(m1);
    expect(next.placements[SMALL.S2]).toBe(m1);
    expect(next.placements[SMALL.L1c]).toBe(m2);
    expect(next.dugoutInclusions).toEqual([m3, m1]);
    expect(positionsOf(next, SMALL.L1).map((position) => ({ id: position.id, order: position.order }))).toEqual([
      { id: SMALL.L1c, order: 0 },
      { id: SMALL.L1b, order: 1 },
      { id: SMALL.L1a, order: 3 },
    ]);
  });

  it('removing an occupied position includes the member even with other callings', () => {
    const { ward, board } = fixtureSetup();
    const jo = memberNamed(ward, 'Jo Testwell');
    const kit = memberNamed(ward, 'Kit Notreal');
    const list = assignmentNamed(board, ...RS_TEACHERS);
    const before = positionsOf(board, list.id);
    const josPosition = before[0];
    const kitsPosition = before[1];
    if (josPosition === undefined || kitsPosition === undefined) {
      throw new Error('expected Relief Society teacher positions');
    }
    const nursery = positionNamed(board, ...NURSERY, 0);
    expect(board.placements[josPosition.id]).toBe(jo);
    expect(holdingsOf(board, jo)).toEqual([josPosition.id, nursery].sort());

    const next = expectOk(removePosition(board, contextFor(ward), { positionId: josPosition.id }));

    expect(next.positions[josPosition.id]).toBeUndefined();
    expect(next.placements[josPosition.id]).toBeUndefined();
    expect(holdingsOf(next, jo)).toEqual([nursery]);
    expect(next.placements[nursery]).toBe(jo);
    expect(next.dugoutInclusions).toEqual([jo]);
    expect(next.placements[kitsPosition.id]).toBe(kit);
    expect(holdingsOf(next, kit)).toEqual([kitsPosition.id]);
    const after = positionsOf(next, list.id);
    expect(after.map((position) => position.id)).toEqual(before.slice(1).map((position) => position.id));
    expect(after.map((position) => position.order)).toEqual(before.slice(1).map((position) => position.order));
  });

  it("removing a single's position is refused", () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    const snapshot = structuredClone(board);

    const occupied = expectError(removePosition(board, contextFor(ward), { positionId: SMALL.S1 }));
    const vacant = expectError(removePosition(board, contextFor(ward), { positionId: SMALL.S3 }));

    expect(occupied.code).toBe('wrong_assignment_type');
    expect(vacant.code).toBe('wrong_assignment_type');
    expect(board).toEqual(snapshot);
    expect(positionsOf(board, positionAt(board, SMALL.S1).assignmentId)).toHaveLength(1);
    expect(positionsOf(board, SMALL.AS3)).toHaveLength(1);
  });

  it('removing the last position of a list leaves zero positions', () => {
    const ward = smallWard();
    const board = smallBoard(ward);
    expect(board.assignments[SMALL.LD]?.enabled).toBe(false);
    expect(board.placements[SMALL.LDp]).toBeUndefined();
    expect(positionsOf(board, SMALL.LD)).toHaveLength(1);

    const next = expectOk(removePosition(board, contextFor(ward), { positionId: SMALL.LDp }));

    expect(next.assignments[SMALL.LD]).toEqual(board.assignments[SMALL.LD]);
    expect(positionsOf(next, SMALL.LD)).toEqual([]);
    expect(next.positions[SMALL.LDp]).toBeUndefined();
    expect(next.placements).toEqual(board.placements);
    expect(next.dugoutInclusions).toEqual(board.dugoutInclusions);
    expect(Object.keys(next.positions)).toHaveLength(Object.keys(board.positions).length - 1);
  });

  it('removing an already included occupant does not duplicate dugout inclusion', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const m1 = memberId('m-1');
    const m3 = memberId('m-3');
    const board = rebuild(base, ward, { dugoutInclusions: [m3, m1] });

    const next = expectOk(removePosition(board, contextFor(ward), { positionId: SMALL.L1d }));

    expect(next.dugoutInclusions).toEqual([m3, m1]);
    expect(next.placements[SMALL.L1d]).toBeUndefined();
    expect(holdingsOf(next, m1)).toEqual([SMALL.S1, SMALL.S2].sort());
  });
});

describe('removeAssignment', () => {
  it('removeAssignment deletes positions and includes every occupant once', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const m1 = memberId('m-1');
    const m2 = memberId('m-2');
    // Position order of occupants is m-1 then m-2. Id order would be m-2 then m-1.
    const board = rebuild(base, ward, {
      positions: {
        ...base.positions,
        [SMALL.L1c]: { ...positionAt(base, SMALL.L1c), order: 2 },
        [SMALL.L1d]: { ...positionAt(base, SMALL.L1d), order: 0 },
      },
    });

    const next = expectOk(removeAssignment(board, contextFor(ward), { assignmentId: SMALL.L1 }));

    expect(next.assignments[SMALL.L1]).toBeUndefined();
    for (const id of [SMALL.L1a, SMALL.L1b, SMALL.L1c, SMALL.L1d]) {
      expect(next.positions[id]).toBeUndefined();
      expect(next.placements[id]).toBeUndefined();
    }
    expect(next.dugoutInclusions).toEqual([m1, m2]);
    expect(holdingsOf(next, m1)).toEqual([SMALL.S1, SMALL.S2].sort());
    expect(holdingsOf(next, m2)).toEqual([]);
    expect(next.positions[SMALL.S1]).toEqual(board.positions[SMALL.S1]);
    expect(next.placements[SMALL.L1c]).toBeUndefined();
    expect(next.assignments[SMALL.L0]).toEqual(board.assignments[SMALL.L0]);
    expect(Object.keys(next.positions)).toHaveLength(Object.keys(board.positions).length - 4);
    expect(Object.keys(next.assignments)).toHaveLength(Object.keys(board.assignments).length - 1);

    const s2 = positionAt(base, SMALL.S2);
    const single = expectOk(removeAssignment(base, contextFor(ward), { assignmentId: s2.assignmentId }));
    expect(single.assignments[s2.assignmentId]).toBeUndefined();
    expect(single.positions[SMALL.S2]).toBeUndefined();
    expect(single.placements[SMALL.S2]).toBeUndefined();
    expect(single.dugoutInclusions).toEqual([m1]);
    expect(holdingsOf(single, m1)).toEqual([SMALL.L1d, SMALL.S1].sort());
    expect(single.positions[SMALL.S1]).toEqual(base.positions[SMALL.S1]);
    expect(single.placements[SMALL.L1c]).toBe(m2);
  });
});

describe('group edits', () => {
  it('renameGroup trims and keeps keys', () => {
    const { ward, board } = fixtureSetup();
    const relief = boardGroupKeyed(board, 'relief_society');
    const teachers = callingGroupNamed(board, 'Relief Society Teachers');
    const classGroup = callingGroupNamed(board, 'Young Women Class');
    expect(relief.key).toBe('relief_society');
    expect(teachers.key).not.toBeNull();
    expect(classGroup.key).toBeNull();

    const renamedBoard = expectOk(
      renameGroup(board, contextFor(ward), { target: { kind: 'boardGroup', id: relief.id }, name: '  Relief Society Org  ' }),
    );
    expect(renamedBoard.boardGroups[relief.id]).toEqual({ ...relief, name: 'Relief Society Org' });
    expect(renamedBoard.callingGroups).toEqual(board.callingGroups);

    const renamedTeachers = expectOk(
      renameGroup(renamedBoard, contextFor(ward), { target: { kind: 'callingGroup', id: teachers.id }, name: '\tTeachers\n' }),
    );
    expect(renamedTeachers.callingGroups[teachers.id]).toEqual({ ...teachers, name: 'Teachers' });
    expect(renamedTeachers.callingGroups[teachers.id]?.key).toBe(teachers.key);
    expect(renamedTeachers.boardGroups[relief.id]?.name).toBe('Relief Society Org');

    const renamedClass = expectOk(
      renameGroup(board, contextFor(ward), { target: { kind: 'callingGroup', id: classGroup.id }, name: '  Youth Class  ' }),
    );
    expect(renamedClass.callingGroups[classGroup.id]).toEqual({ ...classGroup, name: 'Youth Class' });
    expect(renamedClass.callingGroups[classGroup.id]?.key).toBeNull();

    const snapshot = structuredClone(board);
    const blank = expectError(renameGroup(board, contextFor(ward), { target: { kind: 'boardGroup', id: relief.id }, name: '   ' }));
    expect(blank.code).toBe('invalid_name');
    expect(board).toEqual(snapshot);
  });

  it('setBoardGroupVisible hides without releasing', () => {
    const { ward, board } = fixtureSetup();
    const primary = boardGroupKeyed(board, 'primary');
    const beaPosition = positionNamed(board, 'Primary Teachers', 'Primary Teacher', 0);
    const bea = board.placements[beaPosition];
    expect(bea).toBeDefined();
    expect(primary.visible).toBe(true);

    const hidden = expectOk(setBoardGroupVisible(board, contextFor(ward), { boardGroupId: primary.id, visible: false }));

    expect(hidden.boardGroups[primary.id]).toEqual({ ...primary, visible: false });
    for (const group of Object.values(hidden.boardGroups)) {
      if (group.id !== primary.id) {
        expect(group).toEqual(board.boardGroups[group.id]);
      }
    }
    expect(hidden.placements[beaPosition]).toBe(bea);
    expect(hidden.placements).toEqual(board.placements);
    expect(hidden.positions).toEqual(board.positions);
    expect(hidden.assignments).toEqual(board.assignments);
    expect(hidden.callingGroups).toEqual(board.callingGroups);
    expect(hidden.dugoutInclusions).toEqual(board.dugoutInclusions);
    expect(hidden.oversight).toEqual(board.oversight);

    const concealed = rebuild(board, ward, {
      boardGroups: { ...board.boardGroups, [primary.id]: { ...primary, visible: false } },
    });
    const shown = expectOk(setBoardGroupVisible(concealed, contextFor(ward), { boardGroupId: primary.id, visible: true }));
    expect(shown.boardGroups[primary.id]).toEqual(primary);
    expect(shown.placements).toEqual(concealed.placements);
  });

  it('moveGroup renumbers only siblings', () => {
    const { ward, board } = fixtureSetup();
    const relief = boardGroupKeyed(board, 'relief_society');
    const siblings = siblingsOf(board, { kind: 'boardGroup', id: relief.id });
    expect(siblings.map((group) => group.name)).toEqual(['Relief Society Presidency', 'Relief Society Teachers']);
    const presidency = siblings[0];
    const teachers = siblings[1];
    if (presidency === undefined || teachers === undefined) {
      throw new Error('expected two Relief Society calling groups');
    }
    const snapshot = structuredClone(board);

    const next = expectOk(moveGroup(board, contextFor(ward), { target: { kind: 'callingGroup', id: teachers.id }, toIndex: 0 }));

    expect(next.callingGroups[teachers.id]).toEqual({ ...teachers, order: 0 });
    expect(next.callingGroups[presidency.id]).toEqual({ ...presidency, order: 1 });
    for (const group of Object.values(next.callingGroups)) {
      if (group.id !== teachers.id && group.id !== presidency.id) {
        expect(group).toEqual(board.callingGroups[group.id]);
      }
    }
    expect(next.boardGroups).toEqual(board.boardGroups);
    expect(next.assignments).toEqual(board.assignments);
    expect(next.positions).toEqual(board.positions);
    expect(next.placements).toEqual(board.placements);
    expect(next.oversight).toEqual(board.oversight);

    const ordered = sortedByOrder(Object.values(board.boardGroups));
    const last = ordered[ordered.length - 1];
    if (last === undefined) {
      throw new Error('expected a board group');
    }
    const movedBoard = expectOk(moveGroup(board, contextFor(ward), { target: { kind: 'boardGroup', id: last.id }, toIndex: 0 }));
    expect(movedBoard.callingGroups).toEqual(board.callingGroups);
    expect(movedBoard.assignments).toEqual(board.assignments);
    expect(movedBoard.positions).toEqual(board.positions);
    expect(movedBoard.placements).toEqual(board.placements);
    for (const group of Object.values(movedBoard.boardGroups)) {
      const before = board.boardGroups[group.id];
      if (before === undefined) {
        throw new Error(`missing board group ${group.id}`);
      }
      const order = group.id === last.id ? 0 : before.order + 1;
      expect(group).toEqual({ ...before, order });
    }
    expect(sortedByOrder(Object.values(movedBoard.boardGroups)).map((group) => group.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const errors = [
      moveGroup(board, contextFor(ward), { target: { kind: 'callingGroup', id: teachers.id }, toIndex: -1 }),
      moveGroup(board, contextFor(ward), { target: { kind: 'callingGroup', id: teachers.id }, toIndex: siblings.length }),
      moveGroup(board, contextFor(ward), { target: { kind: 'callingGroup', id: teachers.id }, toIndex: 0.5 }),
    ].map((result) => expectError(result).code);
    expect(errors).toEqual(['invalid_operation', 'invalid_operation', 'invalid_operation']);
    expect(board).toEqual(snapshot);
  });

  it('moveGroup to its current index normalizes sibling orders', () => {
    const { ward, board: fixture } = fixtureSetup();
    const relief = boardGroupKeyed(fixture, 'relief_society');
    const siblings = siblingsOf(fixture, { kind: 'boardGroup', id: relief.id });
    const first = siblings[0];
    const second = siblings[1];
    if (first === undefined || second === undefined) {
      throw new Error('expected two Relief Society calling groups');
    }
    const board = rebuild(fixture, ward, {
      callingGroups: {
        ...fixture.callingGroups,
        [first.id]: { ...first, order: 4 },
        [second.id]: { ...second, order: 9 },
      },
    });

    const next = expectOk(moveGroup(board, contextFor(ward), { target: { kind: 'callingGroup', id: first.id }, toIndex: 0 }));

    expect(next.callingGroups[first.id]).toEqual(first);
    expect(next.callingGroups[second.id]).toEqual(second);
    for (const group of Object.values(next.callingGroups)) {
      if (group.id !== first.id && group.id !== second.id) {
        expect(group).toEqual(board.callingGroups[group.id]);
      }
    }
    expect(next.boardGroups).toEqual(board.boardGroups);
    expect(next.assignments).toEqual(board.assignments);
    expect(next.positions).toEqual(board.positions);
    expect(next.placements).toEqual(board.placements);
    expect(next.oversight).toEqual(board.oversight);
    expect(next.dugoutInclusions).toEqual(board.dugoutInclusions);
    expect(next.approvals).toEqual(board.approvals);
  });
});

describe('position operation invariants', () => {
  it('exports position-specific error codes', () => {
    expect(POSITION_ERROR_CODES).toEqual(['invalid_name', 'wrong_assignment_type', 'assignment_disabled']);
  });

  it('structural edits do not touch other boards', () => {
    const { ward, current, baseline, board } = fixtureSetup();
    const other = buildFixtureProposal(current, ward, { id: proposalId('pr-0002'), name: 'Other draft', tabOrder: 1 });
    const currentBefore = structuredClone(current);
    const baselineBefore = structuredClone(baseline);
    const otherBefore = structuredClone(other);
    const boardBefore = structuredClone(board);
    const relief = boardGroupKeyed(board, 'relief_society');
    const vacant = positionNamed(board, ...RS_TEACHERS, 3);

    const added = expectOk(
      addCallingGroup(board, contextFor(ward), { parent: { kind: 'boardGroup', id: relief.id }, name: 'Activities', kind: 'committee' }),
    );
    const removed = expectOk(removePosition(board, contextFor(ward), { positionId: vacant }));

    expect(added).not.toEqual(board);
    expect(removed.positions[vacant]).toBeUndefined();
    expect(board).toEqual(boardBefore);
    expect(current).toEqual(currentBefore);
    expect(baseline).toEqual(baselineBefore);
    expect(other).toEqual(otherBefore);
  });

  it('stale approvals are dropped and others kept', () => {
    const ward = smallWard();
    const base = smallBoard(ward);
    const m1 = memberId('m-1');
    const m2 = memberId('m-2');
    const kept = approval(m1, SMALL.S1);
    const dropped = approval(m1, SMALL.L1d);
    const alsoDropped = approval(m2, SMALL.L1c);
    const board = rebuild(base, ward, { approvals: [kept, dropped, alsoDropped] });

    const byPosition = expectOk(removePosition(board, contextFor(ward), { positionId: SMALL.L1d }));
    const byAssignment = expectOk(removeAssignment(board, contextFor(ward), { assignmentId: SMALL.L1 }));

    expect(byPosition.approvals).toEqual([kept, alsoDropped]);
    expect(byAssignment.approvals).toEqual([kept]);
    expect(byAssignment.positions[SMALL.L1c]).toBeUndefined();
    expect(byAssignment.positions[SMALL.L1d]).toBeUndefined();
  });

  it('operations refuse non-proposal boards', () => {
    const { ward, current, baseline } = fixtureSetup();
    const codes = [current, baseline].flatMap((board) => allOperations(board, ward).map((result) => expectError(result).code));

    expect(allOperations(current, ward)).toHaveLength(8);
    expect(codes).toEqual(Array<string>(16).fill('board_not_editable'));
  });

  it('unknown ids are refused', () => {
    const { ward, board } = fixtureSetup();
    const relief = boardGroupKeyed(board, 'relief_society');
    const missingGroup = boardGroupId('bg-missing');
    const missingCalling = callingGroupId('cg-missing');
    const missingAssignment = assignmentId('a-missing');
    const missingPosition = positionId('p-missing');
    const ctx = contextFor(ward);
    const snapshot = structuredClone(board);

    const codes = [
      addCallingGroup(board, ctx, { parent: { kind: 'boardGroup', id: missingGroup }, name: 'Extra', kind: 'other' }),
      addCallingGroup(board, ctx, { parent: { kind: 'callingGroup', id: missingCalling }, name: 'Extra', kind: 'other' }),
      addCallingGroup(board, ctx, { parent: { kind: 'callingGroup', id: callingGroupId(relief.id) }, name: 'Extra', kind: 'other' }),
      renameGroup(board, ctx, { target: { kind: 'boardGroup', id: missingGroup }, name: 'Extra' }),
      renameGroup(board, ctx, { target: { kind: 'callingGroup', id: missingCalling }, name: 'Extra' }),
      setBoardGroupVisible(board, ctx, { boardGroupId: missingGroup, visible: false }),
      moveGroup(board, ctx, { target: { kind: 'boardGroup', id: missingGroup }, toIndex: 0 }),
      moveGroup(board, ctx, { target: { kind: 'callingGroup', id: missingCalling }, toIndex: 0 }),
      addAssignment(board, ctx, { groupId: missingCalling, title: 'Extra', type: 'list', positionCount: 1 }),
      addListPosition(board, ctx, { assignmentId: missingAssignment }),
      removePosition(board, ctx, { positionId: missingPosition }),
      removeAssignment(board, ctx, { assignmentId: missingAssignment }),
    ].map((result) => expectError(result).code);

    expect(codes).toEqual(Array<string>(12).fill('not_found'));
    expect(board).toEqual(snapshot);
  });

  it('version, id, kind and oversight are unchanged', () => {
    const { ward, board } = fixtureSetup();
    expect(board.oversight.length).toBeGreaterThan(0);

    for (const next of allOperations(board, ward).map((result) => expectOk(result))) {
      expect({ id: next.id, kind: next.kind, version: next.version }).toEqual({
        id: board.id,
        kind: board.kind,
        version: board.version,
      });
      expect(next.oversight).toEqual(board.oversight);
    }
  });

  it('results are frozen and inputs untouched', () => {
    const { ward, board } = fixtureSetup();
    const snapshot = structuredClone(board);
    const results = allOperations(board, ward).map((result) => expectOk(result));

    expect(board).toEqual(snapshot);
    expect(results.every((result) => result !== board && isDeeplyFrozen(result))).toBe(true);
  });
});
