import { describe, expect, it } from 'vitest';
import { buildFixtureWard } from '../../src/fixtures/index.ts';
import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  lineageId,
  memberId,
  positionId,
  tagId,
  userId,
  type BoardInput,
  type CallingAssignment,
  type Oversight,
} from '../../src/index.ts';
import {
  A1,
  assignment,
  BG1,
  callingGroup,
  CG1,
  codes,
  errorsOf,
  M1,
  M2,
  member,
  minimalBoard,
  P1,
  position,
  T1,
  testWard,
  valueOf,
  wardOf,
} from './helpers.ts';

const ward = testWard();
const PQ = callingGroupId('cg-pq');

function withPriestsQuorum(oversight: readonly Oversight[]): BoardInput {
  return minimalBoard({
    callingGroups: {
      [CG1]: callingGroup('cg-1'),
      [PQ]: callingGroup('cg-pq', { name: 'Priests Quorum', kind: 'quorum', key: 'priests_quorum' }),
    },
    oversight,
  });
}

describe('createBoard', () => {
  it('createBoard accepts the minimal valid board', () => {
    const input = minimalBoard();

    const board = valueOf(createBoard(input, ward));

    expect(board).toEqual(input);
  });

  it('createBoard accepts an empty board', () => {
    const input: BoardInput = {
      id: boardId('b-empty'),
      kind: 'proposal',
      version: 0,
      boardGroups: {},
      callingGroups: {},
      assignments: {},
      positions: {},
      placements: {},
      oversight: [],
      dugoutInclusions: [],
      approvals: [],
    };

    expect(valueOf(createBoard(input, wardOf()))).toEqual(input);
  });

  it('createBoard reports every dangling reference', () => {
    const cg2 = callingGroupId('cg-2');
    const a2 = assignmentId('a-2');
    const p2 = positionId('p-2');
    const input = minimalBoard({
      callingGroups: {
        [CG1]: callingGroup('cg-1'),
        [cg2]: callingGroup('cg-2', { parent: { kind: 'callingGroup', id: callingGroupId('cg-missing') } }),
      },
      assignments: {
        [A1]: assignment('a-1'),
        [a2]: assignment('a-2', { type: 'list', groupId: callingGroupId('cg-missing') }),
      },
      positions: { [P1]: position('p-1', 'a-1'), [p2]: position('p-2', 'a-missing') },
      placements: { [P1]: memberId('m-missing') },
      oversight: [{ overseer: 'first_counselor', target: { kind: 'callingGroup', id: callingGroupId('cg-gone') }, fixed: false }],
      dugoutInclusions: [memberId('m-unknown')],
    });

    const errors = errorsOf(createBoard(input, ward));

    expect(codes(errors)).toEqual(Array(6).fill('dangling_reference'));
    expect(errors.map((e) => e.path).sort()).toEqual([
      'assignments.a-2.groupId',
      'callingGroups.cg-2.parent',
      'dugoutInclusions[0]',
      'oversight[0].target',
      'placements.p-1',
      'positions.p-2.assignmentId',
    ]);
  });

  it('createBoard reports dangling placement positions, tags and approval references', () => {
    const input = minimalBoard({
      assignments: { [A1]: assignment('a-1', { callingTagIds: [tagId('t-x')], preferredMemberTagIds: [T1, tagId('t-y')] }) },
      placements: { [P1]: M1, [positionId('p-missing')]: M2 },
      oversight: [{ overseer: 'bishop', target: { kind: 'boardGroup', id: boardGroupId('bg-missing') }, fixed: false }],
      approvals: [
        { memberId: memberId('m-gone'), positionId: P1, approvedBy: userId('u-1'), approvedAt: '2026-01-04T12:00:00Z' },
        { memberId: M1, positionId: positionId('p-gone'), approvedBy: userId('u-1'), approvedAt: '2026-01-04T12:00:00Z' },
      ],
    });

    const errors = errorsOf(createBoard(input, ward));

    expect(errors.map((e) => `${e.code} ${e.path}`).sort()).toEqual([
      'dangling_reference approvals[0].memberId',
      'dangling_reference approvals[1].positionId',
      'dangling_reference assignments.a-1.callingTagIds[0]',
      'dangling_reference assignments.a-1.preferredMemberTagIds[1]',
      'dangling_reference oversight[0].target',
      'dangling_reference placements.p-missing',
    ]);
  });

  it('createBoard rejects calling-group cycles', () => {
    const ga = callingGroupId('cg-a');
    const gb = callingGroupId('cg-b');
    const gc = callingGroupId('cg-c');
    const self = callingGroupId('cg-self');
    const input = minimalBoard({
      callingGroups: {
        [CG1]: callingGroup('cg-1'),
        [ga]: callingGroup('cg-a', { parent: { kind: 'callingGroup', id: gb } }),
        [gb]: callingGroup('cg-b', { parent: { kind: 'callingGroup', id: ga } }),
        [gc]: callingGroup('cg-c', { parent: { kind: 'callingGroup', id: ga } }),
        [self]: callingGroup('cg-self', { parent: { kind: 'callingGroup', id: self } }),
      },
    });

    const errors = errorsOf(createBoard(input, ward));

    expect(errors.map((e) => `${e.code} ${e.path}`)).toEqual([
      'group_cycle callingGroups.cg-a.parent',
      'group_cycle callingGroups.cg-b.parent',
      'group_cycle callingGroups.cg-self.parent',
    ]);
  });

  it('createBoard accepts nested calling groups', () => {
    const child = callingGroupId('cg-child');
    const input = minimalBoard({
      callingGroups: {
        [CG1]: callingGroup('cg-1'),
        [child]: callingGroup('cg-child', { kind: 'class', parent: { kind: 'callingGroup', id: CG1 } }),
      },
    });

    expect(createBoard(input, ward).ok).toBe(true);
  });

  it('createBoard enforces exactly one position per single assignment', () => {
    const none = minimalBoard({ positions: {}, placements: {} });
    const p2 = positionId('p-2');
    const two = minimalBoard({ positions: { [P1]: position('p-1', 'a-1'), [p2]: position('p-2', 'a-1') } });

    expect(errorsOf(createBoard(none, ward))).toEqual([
      expect.objectContaining({ code: 'single_position_count', path: 'assignments.a-1' }),
    ]);
    expect(errorsOf(createBoard(two, ward))).toEqual([
      expect.objectContaining({ code: 'single_position_count', path: 'assignments.a-1' }),
    ]);
  });

  it('createBoard allows a list with any number of positions, including none', () => {
    const list: CallingAssignment = assignment('a-1', { type: 'list' });

    expect(createBoard(minimalBoard({ assignments: { [A1]: list }, positions: {}, placements: {} }), ward).ok).toBe(true);
  });

  it('createBoard rejects the same member twice in one list', () => {
    const p2 = positionId('p-2');
    const p3 = positionId('p-3');
    const input = minimalBoard({
      assignments: { [A1]: assignment('a-1', { type: 'list' }) },
      positions: { [P1]: position('p-1', 'a-1'), [p2]: position('p-2', 'a-1'), [p3]: position('p-3', 'a-1') },
      placements: { [P1]: M1, [p2]: M2, [p3]: M1 },
    });

    expect(errorsOf(createBoard(input, ward))).toEqual([
      expect.objectContaining({ code: 'list_duplicate_member', path: 'placements.p-3' }),
    ]);
  });

  it('createBoard allows one member in several assignments', () => {
    const primary = callingGroupId('cg-primary');
    const teachers = assignmentId('a-teachers');
    const primaryTeacher = assignmentId('a-primary-teacher');
    const p2 = positionId('p-2');
    const p3 = positionId('p-3');
    const input = minimalBoard({
      callingGroups: { [CG1]: callingGroup('cg-1'), [primary]: callingGroup('cg-primary', { kind: 'class' }) },
      assignments: {
        [teachers]: assignment('a-teachers', { type: 'list', title: 'Relief Society Teacher' }),
        [primaryTeacher]: assignment('a-primary-teacher', { groupId: primary, title: 'Primary Teacher' }),
      },
      positions: {
        [P1]: position('p-1', 'a-teachers'),
        [p2]: position('p-2', 'a-teachers'),
        [p3]: position('p-3', 'a-primary-teacher'),
      },
      placements: { [P1]: M1, [p2]: M2, [p3]: M1 },
    });

    expect(createBoard(input, ward).ok).toBe(true);
  });

  it('createBoard accepts placements of removed members', () => {
    const removedWard = wardOf(member('m-1', { removedDate: '2026-05-01' }));

    expect(createBoard(minimalBoard(), removedWard).ok).toBe(true);
  });

  it('createBoard rejects duplicate lineage ids and duplicate keys', () => {
    const p2 = positionId('p-2');
    const bg2 = boardGroupId('bg-2');
    const cg2 = callingGroupId('cg-2');
    const input = minimalBoard({
      boardGroups: {
        [BG1]: { id: BG1, name: 'Relief Society', order: 0, visible: true, key: 'relief_society' },
        [bg2]: { id: bg2, name: 'Relief Society again', order: 1, visible: true, key: 'relief_society' },
      },
      callingGroups: {
        [CG1]: callingGroup('cg-1', { key: 'rs_presidency' }),
        [cg2]: callingGroup('cg-2', { key: 'rs_presidency' }),
      },
      assignments: { [A1]: assignment('a-1', { type: 'list' }) },
      positions: { [P1]: position('p-1', 'a-1'), [p2]: position('p-2', 'a-1', { lineageId: lineageId('l-p-1') }) },
    });

    const errors = errorsOf(createBoard(input, ward));

    expect(errors.map((e) => `${e.code} ${e.path}`).sort()).toEqual([
      'duplicate_key boardGroups.bg-2.key',
      'duplicate_key callingGroups.cg-2.key',
      'duplicate_lineage positions.p-2.lineageId',
    ]);
  });

  it('createBoard allows many groups with a null key', () => {
    const bg2 = boardGroupId('bg-2');
    const input = minimalBoard({
      boardGroups: {
        [BG1]: { id: BG1, name: 'A', order: 0, visible: true, key: null },
        [bg2]: { id: bg2, name: 'B', order: 1, visible: false, key: null },
      },
    });

    expect(createBoard(input, ward).ok).toBe(true);
  });

  it('createBoard accepts the fixed bishop oversight of the priests quorum', () => {
    const input = withPriestsQuorum([
      { overseer: 'bishop', target: { kind: 'callingGroup', id: PQ }, fixed: true },
      { overseer: 'second_counselor', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
    ]);

    expect(createBoard(input, ward).ok).toBe(true);
  });

  it('createBoard enforces the fixed bishop oversight', () => {
    const counselor = withPriestsQuorum([{ overseer: 'first_counselor', target: { kind: 'callingGroup', id: PQ }, fixed: true }]);
    const missing = withPriestsQuorum([{ overseer: 'bishop', target: { kind: 'callingGroup', id: PQ }, fixed: false }]);
    const twice = withPriestsQuorum([
      { overseer: 'bishop', target: { kind: 'callingGroup', id: PQ }, fixed: true },
      { overseer: 'bishop', target: { kind: 'callingGroup', id: PQ }, fixed: true },
    ]);
    const wrongTarget = minimalBoard({ oversight: [{ overseer: 'bishop', target: { kind: 'boardGroup', id: BG1 }, fixed: true }] });

    expect(errorsOf(createBoard(counselor, ward)).map((e) => `${e.code} ${e.path}`)).toEqual([
      'fixed_oversight oversight[0]',
      'fixed_oversight oversight',
    ]);
    expect(errorsOf(createBoard(missing, ward)).map((e) => `${e.code} ${e.path}`)).toEqual(['fixed_oversight oversight']);
    expect(errorsOf(createBoard(twice, ward)).map((e) => `${e.code} ${e.path}`)).toEqual(['fixed_oversight oversight[1]']);
    expect(errorsOf(createBoard(wrongTarget, ward)).map((e) => `${e.code} ${e.path}`)).toEqual(['fixed_oversight oversight[0]']);
  });

  it('createBoard rejects approvals for unplaced pairs', () => {
    const p2 = positionId('p-2');
    const input = minimalBoard({
      assignments: { [A1]: assignment('a-1', { type: 'list' }) },
      positions: { [P1]: position('p-1', 'a-1'), [p2]: position('p-2', 'a-1') },
      approvals: [
        { memberId: M1, positionId: P1, approvedBy: userId('u-1'), approvedAt: '2026-01-04T12:00:00Z' },
        { memberId: M2, positionId: P1, approvedBy: userId('u-1'), approvedAt: '2026-01-04T12:00:00Z' },
        { memberId: M1, positionId: p2, approvedBy: userId('u-1'), approvedAt: '2026-01-04T12:00:00.250+02:00' },
      ],
    });

    expect(errorsOf(createBoard(input, ward)).map((e) => `${e.code} ${e.path}`)).toEqual([
      'approval_not_placed approvals[1]',
      'approval_not_placed approvals[2]',
    ]);
  });

  it('createBoard validates fields and reports them together', () => {
    const input = minimalBoard({
      id: boardId(' '),
      kind: 'draft' as unknown as BoardInput['kind'],
      version: 1.5,
      boardGroups: { [BG1]: { id: BG1, name: '', order: -1, visible: true, key: 'youth' as unknown as null } },
      callingGroups: { [CG1]: callingGroup('cg-1', { kind: 'club' as unknown as 'class', key: ' ' }) },
      assignments: {
        [A1]: assignment('a-1', {
          title: '  ',
          origin: 'imported' as unknown as 'custom',
          leadershipRole: 'clerk' as unknown as null,
          callingTagIds: [T1, T1],
        }),
      },
      positions: { [P1]: position('p-1', 'a-1', { order: 0.5 }) },
      oversight: [{ overseer: 'clerk' as unknown as 'bishop', target: { kind: 'boardGroup', id: BG1 }, fixed: false }],
      dugoutInclusions: [M2, M2],
      approvals: [{ memberId: M1, positionId: P1, approvedBy: userId(''), approvedAt: '2026-02-30T12:00:00Z' }],
    });

    const errors = errorsOf(createBoard(input, ward));

    expect(new Set(codes(errors))).toEqual(new Set(['invalid_field']));
    expect(errors.map((e) => e.path).sort()).toEqual([
      'approvals[0].approvedAt',
      'approvals[0].approvedBy',
      'assignments.a-1.callingTagIds[1]',
      'assignments.a-1.leadershipRole',
      'assignments.a-1.origin',
      'assignments.a-1.title',
      'boardGroups.bg-1.key',
      'boardGroups.bg-1.name',
      'boardGroups.bg-1.order',
      'callingGroups.cg-1.key',
      'callingGroups.cg-1.kind',
      'dugoutInclusions[1]',
      'id',
      'kind',
      'oversight[0].overseer',
      'positions.p-1.order',
      'version',
    ]);
  });

  it('createBoard rejects a record entry whose id does not match its key', () => {
    const input = minimalBoard({ positions: { [P1]: position('p-other', 'a-1') } });

    expect(errorsOf(createBoard(input, ward))).toEqual([
      expect.objectContaining({ code: 'invalid_field', path: 'positions.p-1.id' }),
    ]);
  });

  it('constructed boards are deeply frozen', () => {
    const board = valueOf(createBoard(minimalBoard({ dugoutInclusions: [M2] }), ward));

    expect(Object.isFrozen(board)).toBe(true);
    expect(() => {
      (board.placements as Record<string, string>)[P1] = M2;
    }).toThrow(TypeError);
    expect(() => {
      (board.dugoutInclusions as unknown as string[]).push(M1);
    }).toThrow(TypeError);
    expect(() => {
      (board.positions[P1] as { order: number }).order = 9;
    }).toThrow(TypeError);
    expect(board.placements[P1]).toBe(M1);
  });

  it('createBoard does not keep references to its input', () => {
    const input = minimalBoard({ dugoutInclusions: [M2] });
    const board = valueOf(createBoard(input, ward));

    (input.dugoutInclusions as unknown as string[]).push(M1);
    (input.placements as Record<string, string>)[P1] = M2;

    expect(board.dugoutInclusions).toEqual([M2]);
    expect(board.placements[P1]).toBe(M1);
  });

  it('createBoard rejects a second overseer of the same target', () => {
    const primary = minimalBoard({
      boardGroups: { [BG1]: { id: BG1, name: 'Primary', order: 0, visible: true, key: 'primary' } },
      oversight: [
        { overseer: 'second_counselor', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
        { overseer: 'first_counselor', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
      ],
    });
    const triple = minimalBoard({
      oversight: [
        { overseer: 'bishop', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
        { overseer: 'first_counselor', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
        { overseer: 'second_counselor', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
      ],
    });

    expect(errorsOf(createBoard(primary, ward)).map((e) => `${e.code} ${e.path}`)).toEqual(['duplicate_oversight oversight[1]']);
    expect(errorsOf(createBoard(triple, ward)).map((e) => `${e.code} ${e.path}`)).toEqual([
      'duplicate_oversight oversight[1]',
      'duplicate_oversight oversight[2]',
    ]);
  });

  it('createBoard rejects an identical duplicate oversight entry', () => {
    const entry: Oversight = { overseer: 'second_counselor', target: { kind: 'callingGroup', id: CG1 }, fixed: false };
    const input = minimalBoard({ oversight: [entry, entry] });

    expect(errorsOf(createBoard(input, ward))).toEqual([
      expect.objectContaining({
        code: 'duplicate_oversight',
        path: 'oversight[1]',
        message: 'each oversight target may have only one overseer',
      }),
    ]);
  });

  it('createBoard rejects a counselor over the priests quorum in either order', () => {
    const counselorFirst = withPriestsQuorum([
      { overseer: 'first_counselor', target: { kind: 'callingGroup', id: PQ }, fixed: false },
      { overseer: 'bishop', target: { kind: 'callingGroup', id: PQ }, fixed: true },
    ]);
    const counselorAfter = withPriestsQuorum([
      { overseer: 'bishop', target: { kind: 'callingGroup', id: PQ }, fixed: true },
      { overseer: 'second_counselor', target: { kind: 'callingGroup', id: PQ }, fixed: false },
    ]);
    const priestsOnly = 'the priests quorum is overseen only by the fixed bishop entry';

    expect(errorsOf(createBoard(counselorFirst, ward))).toEqual([
      { code: 'fixed_oversight', path: 'oversight[0]', message: priestsOnly },
    ]);
    expect(errorsOf(createBoard(counselorAfter, ward))).toEqual([
      { code: 'fixed_oversight', path: 'oversight[1]', message: priestsOnly },
    ]);
  });

  it('createBoard accepts one overseer per target', () => {
    const { ward: fixtureWard, current } = buildFixtureWard();
    const distinct = minimalBoard({
      oversight: [
        { overseer: 'first_counselor', target: { kind: 'boardGroup', id: BG1 }, fixed: false },
        { overseer: 'bishop', target: { kind: 'callingGroup', id: CG1 }, fixed: false },
      ],
    });

    expect(createBoard(current, fixtureWard).ok).toBe(true);
    expect(createBoard(distinct, ward).ok).toBe(true);
  });
});
