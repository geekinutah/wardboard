import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  lineageId,
  memberId,
  positionId,
  tagId,
  type Board,
  type BoardInput,
  type CallingAssignment,
  type CallingGroup,
  type Member,
  type Position,
  type Result,
  type ValidationError,
  type Ward,
  createWard,
} from '../../src/index.ts';

export const M1 = memberId('m-1');
export const M2 = memberId('m-2');
export const T1 = tagId('t-1');
export const BG1 = boardGroupId('bg-1');
export const CG1 = callingGroupId('cg-1');
export const A1 = assignmentId('a-1');
export const P1 = positionId('p-1');

export function member(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id: memberId(id),
    name: `Member ${id}`,
    category: 'adult',
    photoRef: null,
    note: null,
    tagIds: [],
    needsApproval: false,
    removedDate: null,
    externalCallings: [],
    ...overrides,
  };
}

export function callingGroup(id: string, overrides: Partial<CallingGroup> = {}): CallingGroup {
  return {
    id: callingGroupId(id),
    name: `Group ${id}`,
    order: 0,
    parent: { kind: 'boardGroup', id: BG1 },
    kind: 'presidency',
    key: null,
    ...overrides,
  };
}

export function assignment(id: string, overrides: Partial<CallingAssignment> = {}): CallingAssignment {
  return {
    id: assignmentId(id),
    groupId: CG1,
    title: `Assignment ${id}`,
    type: 'single',
    order: 0,
    enabled: true,
    prominent: false,
    origin: 'standard',
    leadershipRole: null,
    callingTagIds: [],
    preferredMemberTagIds: [],
    ...overrides,
  };
}

export function position(id: string, assignment: string, overrides: Partial<Position> = {}): Position {
  return {
    id: positionId(id),
    assignmentId: assignmentId(assignment),
    lineageId: lineageId(`l-${id}`),
    order: 0,
    ...overrides,
  };
}

/** A ward with two members and one tag. */
export function wardOf(...members: Member[]): Ward {
  const result = createWard({
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    tags: { [T1]: { id: T1, name: 'Musical' } },
  });
  if (!result.ok) {
    throw new Error(`test ward invalid: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function testWard(): Ward {
  return wardOf(member('m-1', { tagIds: [T1] }), member('m-2'));
}

/** One board group, one calling group, one single assignment, one filled position. */
export function minimalBoard(overrides: Partial<BoardInput> = {}): BoardInput {
  return {
    id: boardId('b-1'),
    kind: 'current',
    version: 0,
    boardGroups: { [BG1]: { id: BG1, name: 'Relief Society', order: 0, visible: true, key: 'relief_society' } },
    callingGroups: { [CG1]: callingGroup('cg-1') },
    assignments: { [A1]: assignment('a-1') },
    positions: { [P1]: position('p-1', 'a-1') },
    placements: { [P1]: M1 },
    oversight: [],
    dugoutInclusions: [],
    approvals: [],
    ...overrides,
  };
}

export function errorsOf<T>(result: Result<T>): readonly ValidationError[] {
  if (result.ok) {
    throw new Error('expected validation to fail, but it succeeded');
  }
  return result.errors;
}

export function valueOf<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected validation to succeed: ${JSON.stringify(result.errors)}`);
  }
  return result.value;
}

export function codes(errors: readonly ValidationError[]): string[] {
  return errors.map((e) => e.code);
}

export function withCode(errors: readonly ValidationError[], code: string): readonly ValidationError[] {
  return errors.filter((e) => e.code === code);
}

export type { Board };
