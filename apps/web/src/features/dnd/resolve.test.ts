import { describe, expect, it } from 'vitest';
import {
  addToDugout,
  addToList,
  createBoard,
  createWard,
  sequentialIds,
  type AssignmentId,
  type Board,
  type Member,
  type MemberId,
  type OperationResult,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { preflight, resolveDrop, type DropPlan } from './resolve.ts';
import type { DropOp } from './types.ts';

function expectOk(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function memberNamed(ward: Ward, name: string): Member {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`member ${name} not found`);
  }
  return found;
}

function assignmentIn(board: Board, groupName: string, title: string): AssignmentId {
  const group = Object.values(board.callingGroups).find((candidate) => candidate.name === groupName);
  if (group === undefined) {
    throw new Error(`group ${groupName} not found`);
  }
  const assignment = Object.values(board.assignments).find(
    (candidate) => candidate.groupId === group.id && candidate.title === title,
  );
  if (assignment === undefined) {
    throw new Error(`assignment ${title} in ${groupName} not found`);
  }
  return assignment.id;
}

/** Positions of an assignment in `order`. */
function positionsOf(board: Board, assignment: AssignmentId): PositionId[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === assignment)
    .sort((left, right) => left.order - right.order)
    .map((position) => position.id);
}

function heldBy(board: Board, assignment: AssignmentId, member: MemberId): PositionId {
  const found = positionsOf(board, assignment).find((id) => board.placements[id] === member);
  if (found === undefined) {
    throw new Error(`member ${member} does not hold ${assignment}`);
  }
  return found;
}

function vacancyOf(board: Board, assignment: AssignmentId): PositionId {
  const found = positionsOf(board, assignment).find((id) => board.placements[id] === undefined);
  if (found === undefined) {
    throw new Error(`no vacancy in ${assignment}`);
  }
  return found;
}

function opOf(plan: DropPlan): DropOp {
  if (plan.kind !== 'apply') {
    throw new Error(`expected apply, got ${JSON.stringify(plan)}`);
  }
  return plan.op;
}

function withAssignmentDisabled(board: Board, ward: Ward, id: AssignmentId): Board {
  const assignment = board.assignments[id];
  if (assignment === undefined) {
    throw new Error(`assignment ${id} missing`);
  }
  const result = createBoard({ ...board, assignments: { ...board.assignments, [id]: { ...assignment, enabled: false } } }, ward);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.value;
}

function wardNeedingApproval(ward: Ward, name: string): Ward {
  const member = memberNamed(ward, name);
  const result = createWard({ members: { ...ward.members, [member.id]: { ...member, needsApproval: true } }, tags: ward.tags });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.value;
}

function setup(wardOverride?: (ward: Ward) => Ward) {
  const built = buildFixtureWard();
  const ward = wardOverride === undefined ? built.ward : wardOverride(built.ward);
  const proposal = buildFixtureProposal(built.current, ward);
  const board = proposal.board;
  const id = (name: string): MemberId => memberNamed(ward, name).id;
  const rsPresidency = (title: string) => assignmentIn(board, 'Relief Society Presidency', title);
  const gwenPos = heldBy(board, rsPresidency('First Counselor'), id('Gwen Imaginary'));
  const hanaPos = heldBy(board, rsPresidency('Second Counselor'), id('Hana Madeup'));
  const rsTeacher = assignmentIn(board, 'Relief Society Teachers', 'Relief Society Teacher');
  const rsTeacherVacancy = vacancyOf(board, rsTeacher);
  const joTeacherPos = heldBy(board, rsTeacher, id('Jo Testwell'));
  const ssSecretary = assignmentIn(board, 'Sunday School Presidency', 'Secretary');
  const ssSecretaryVacancy = vacancyOf(board, ssSecretary);
  const tfh = assignmentIn(board, 'Temple and Family History', 'Temple and Family History Consultant');
  const halPos = heldBy(board, tfh, id('Hal Testwell'));
  const primaryTeacher = assignmentIn(board, 'Primary Teachers', 'Primary Teacher');
  const cyPos = heldBy(board, primaryTeacher, id('Cy Mockup'));
  return {
    ward,
    proposal,
    board,
    id,
    gwenPos,
    hanaPos,
    rsTeacher,
    rsTeacherVacancy,
    joTeacherPos,
    ssSecretary,
    ssSecretaryVacancy,
    halPos,
    cyPos,
  };
}

describe('resolveDrop', () => {
  it('vacant single from a calling → placeInPosition with from', () => {
    const f = setup();
    const gwen = f.id('Gwen Imaginary');
    const plan = resolveDrop(
      f.board,
      f.ward,
      { kind: 'position', memberId: gwen, positionId: f.gwenPos },
      { kind: 'position', positionId: f.ssSecretaryVacancy },
    );
    expect(plan).toEqual({
      kind: 'apply',
      op: { kind: 'placeInPosition', request: { memberId: gwen, from: f.gwenPos, to: f.ssSecretaryVacancy } },
    });
  });

  it('from the dugout → placeInPosition with from null', () => {
    const f = setup();
    const ivy = f.id('Ivy Notreal');
    const plan = resolveDrop(f.board, f.ward, { kind: 'dugout', memberId: ivy }, { kind: 'position', positionId: f.ssSecretaryVacancy });
    expect(plan).toEqual({
      kind: 'apply',
      op: { kind: 'placeInPosition', request: { memberId: ivy, from: null, to: f.ssSecretaryVacancy } },
    });
  });

  it('list target adds without displacing, even on an occupied list slot', () => {
    const f = setup();
    const gwen = f.id('Gwen Imaginary');
    const source = { kind: 'position', memberId: gwen, positionId: f.gwenPos } as const;
    const expected = {
      kind: 'apply',
      op: { kind: 'addToList', request: { memberId: gwen, from: f.gwenPos, assignmentId: f.rsTeacher } },
    };
    expect(resolveDrop(f.board, f.ward, source, { kind: 'position', positionId: f.joTeacherPos })).toEqual(expected);
    expect(resolveDrop(f.board, f.ward, source, { kind: 'position', positionId: f.rsTeacherVacancy })).toEqual(expected);
  });

  it('occupied single offers Swap then Release occupant from a calling', () => {
    const f = setup();
    const gwen = f.id('Gwen Imaginary');
    const plan = resolveDrop(
      f.board,
      f.ward,
      { kind: 'position', memberId: gwen, positionId: f.gwenPos },
      { kind: 'position', positionId: f.hanaPos },
    );
    expect(plan).toEqual({
      kind: 'choose',
      options: [
        { choice: 'swap', op: { kind: 'swap', request: { memberId: gwen, from: f.gwenPos, to: f.hanaPos } } },
        {
          choice: 'release_occupant',
          op: { kind: 'releaseOccupant', request: { memberId: gwen, from: f.gwenPos, to: f.hanaPos } },
        },
      ],
    });
  });

  it('occupied single from the dugout offers only Release occupant', () => {
    const f = setup();
    const ivy = f.id('Ivy Notreal');
    const plan = resolveDrop(f.board, f.ward, { kind: 'dugout', memberId: ivy }, { kind: 'position', positionId: f.hanaPos });
    expect(plan).toEqual({
      kind: 'choose',
      options: [
        { choice: 'release_occupant', op: { kind: 'releaseOccupant', request: { memberId: ivy, from: null, to: f.hanaPos } } },
      ],
    });
  });

  it('dugout target: position → moveToDugout, member → addToDugout, dugout → none', () => {
    const f = setup();
    const hal = f.id('Hal Testwell');
    const kai = f.id('Kai Fictional');
    const ivy = f.id('Ivy Notreal');
    expect(resolveDrop(f.board, f.ward, { kind: 'position', memberId: hal, positionId: f.halPos }, { kind: 'dugout' })).toEqual({
      kind: 'apply',
      op: { kind: 'moveToDugout', request: { memberId: hal, from: f.halPos } },
    });
    expect(resolveDrop(f.board, f.ward, { kind: 'member', memberId: kai }, { kind: 'dugout' })).toEqual({
      kind: 'apply',
      op: { kind: 'addToDugout', request: { memberId: kai } },
    });
    expect(resolveDrop(f.board, f.ward, { kind: 'dugout', memberId: ivy }, { kind: 'dugout' })).toEqual({ kind: 'none' });
  });

  it("same slot is none; a core refusal is blocked with its message", () => {
    const f = setup();
    const gwen = f.id('Gwen Imaginary');
    const source = { kind: 'position', memberId: gwen, positionId: f.gwenPos } as const;
    expect(resolveDrop(f.board, f.ward, source, { kind: 'position', positionId: f.gwenPos })).toEqual({ kind: 'none' });

    const disabled = withAssignmentDisabled(f.board, f.ward, f.ssSecretary);
    expect(resolveDrop(disabled, f.ward, source, { kind: 'position', positionId: f.ssSecretaryVacancy })).toEqual({
      kind: 'blocked',
      message: `assignment ${f.ssSecretary} is disabled`,
    });
  });

  it('an occupied single with no possible option is blocked with the filled message', () => {
    const f = setup();
    const gwen = f.id('Gwen Imaginary');
    const hanaAssignment = f.board.positions[f.hanaPos]?.assignmentId;
    if (hanaAssignment === undefined) {
      throw new Error('missing assignment');
    }
    const disabled = withAssignmentDisabled(f.board, f.ward, hanaAssignment);
    expect(
      resolveDrop(disabled, f.ward, { kind: 'position', memberId: gwen, positionId: f.gwenPos }, { kind: 'position', positionId: f.hanaPos }),
    ).toEqual({ kind: 'blocked', message: "That calling is filled and can't be swapped or released here." });
  });

  it('a read-only Current board is blocked by core', () => {
    const f = setup();
    const { current } = buildFixtureWard();
    const plan = resolveDrop(current, f.ward, { kind: 'dugout', memberId: f.id('Ivy Notreal') }, {
      kind: 'position',
      positionId: f.ssSecretaryVacancy,
    });
    expect(plan.kind).toBe('blocked');
    expect(plan).toEqual({ kind: 'blocked', message: `board ${current.id} is current and cannot be edited` });
  });
});

describe('preflight', () => {
  it('second calling counts outside callings', () => {
    const f = setup();
    const kai = f.id('Kai Fictional');
    const op = opOf(resolveDrop(f.board, f.ward, { kind: 'member', memberId: kai }, { kind: 'position', positionId: f.rsTeacherVacancy }));
    expect(op).toEqual({ kind: 'addToList', request: { memberId: kai, from: null, assignmentId: f.rsTeacher } });
    const result = preflight(f.proposal, f.board, f.ward, op);
    expect(result.secondCalling).toEqual({
      memberId: kai,
      countBefore: 1,
      countAfter: 2,
      existing: [],
      outside: [{ unit: 'Example Stake', title: 'Stake Young Single Adult Adviser' }],
    });
    expect(result.approvals).toEqual([]);
  });

  it('a move does not prompt; adding to a second calling does', () => {
    const f = setup();
    const gwen = f.id('Gwen Imaginary');
    const move = opOf(
      resolveDrop(f.board, f.ward, { kind: 'position', memberId: gwen, positionId: f.gwenPos }, {
        kind: 'position',
        positionId: f.ssSecretaryVacancy,
      }),
    );
    expect(preflight(f.proposal, f.board, f.ward, move)).toEqual({ secondCalling: null, approvals: [] });

    const jo = f.id('Jo Testwell');
    const included = expectOk(addToDugout(f.board, { ward: f.ward, ids: sequentialIds('t') }, { memberId: jo }));
    const add = opOf(resolveDrop(included, f.ward, { kind: 'dugout', memberId: jo }, { kind: 'position', positionId: f.ssSecretaryVacancy }));
    expect(add).toEqual({ kind: 'placeInPosition', request: { memberId: jo, from: null, to: f.ssSecretaryVacancy } });
    const notice = preflight(f.proposal, included, f.ward, add).secondCalling;
    expect(notice?.memberId).toBe(jo);
    expect(notice?.countBefore).toBe(2);
    expect(notice?.countAfter).toBe(3);
    expect(notice?.existing.map((calling) => calling.title)).toEqual(['Relief Society Teacher', 'Nursery Leader']);
    expect(notice?.outside).toEqual([]);
  });

  it('dugout drops never prompt', () => {
    const f = setup();
    const hal = f.id('Hal Testwell');
    const kai = f.id('Kai Fictional');
    const move = opOf(resolveDrop(f.board, f.ward, { kind: 'position', memberId: hal, positionId: f.halPos }, { kind: 'dugout' }));
    expect(move.kind).toBe('moveToDugout');
    expect(preflight(f.proposal, f.board, f.ward, move)).toEqual({ secondCalling: null, approvals: [] });
    const add = opOf(resolveDrop(f.board, f.ward, { kind: 'member', memberId: kai }, { kind: 'dugout' }));
    expect(add.kind).toBe('addToDugout');
    expect(preflight(f.proposal, f.board, f.ward, add)).toEqual({ secondCalling: null, approvals: [] });
  });

  it("needs approval: Cy's move creates one approval requirement", () => {
    const f = setup();
    const cy = f.id('Cy Mockup');
    const op = opOf(
      resolveDrop(f.board, f.ward, { kind: 'position', memberId: cy, positionId: f.cyPos }, {
        kind: 'position',
        positionId: f.rsTeacherVacancy,
      }),
    );
    expect(op).toEqual({ kind: 'addToList', request: { memberId: cy, from: f.cyPos, assignmentId: f.rsTeacher } });
    expect(preflight(f.proposal, f.board, f.ward, op)).toEqual({
      secondCalling: null,
      approvals: [{ memberId: cy, positionId: f.rsTeacherVacancy }],
    });
  });

  it('needs approval: an existing unapproved requirement is not repeated', () => {
    const f = setup();
    const cy = f.id('Cy Mockup');
    const gospelDoctrine = assignmentIn(f.board, 'Gospel Doctrine', 'Gospel Doctrine Teacher');
    const gdVacancy = vacancyOf(f.board, gospelDoctrine);
    const before = expectOk(
      addToList(f.board, { ward: f.ward, ids: sequentialIds('t') }, { memberId: cy, from: null, assignmentId: gospelDoctrine }),
    );
    const proposal: Proposal = { ...f.proposal, board: before };
    const op = opOf(
      resolveDrop(before, f.ward, { kind: 'position', memberId: cy, positionId: f.cyPos }, {
        kind: 'position',
        positionId: f.rsTeacherVacancy,
      }),
    );
    const result = preflight(proposal, before, f.ward, op);
    expect(result.approvals).toEqual([{ memberId: cy, positionId: f.rsTeacherVacancy }]);
    expect(result.approvals.some((entry) => entry.positionId === gdVacancy)).toBe(false);
  });

  it('needs approval: a swap can create one for the displaced member', () => {
    const f = setup((ward) => wardNeedingApproval(ward, 'Hana Madeup'));
    const gwen = f.id('Gwen Imaginary');
    const hana = f.id('Hana Madeup');
    const swap: DropOp = { kind: 'swap', request: { memberId: gwen, from: f.gwenPos, to: f.hanaPos } };
    expect(preflight(f.proposal, f.board, f.ward, swap)).toEqual({
      secondCalling: null,
      approvals: [{ memberId: hana, positionId: f.gwenPos }],
    });
  });

  it('no approvals on Current', () => {
    const f = setup();
    const cy = f.id('Cy Mockup');
    const op: DropOp = { kind: 'addToList', request: { memberId: cy, from: f.cyPos, assignmentId: f.rsTeacher } };
    expect(preflight(null, f.board, f.ward, op)).toEqual({ secondCalling: null, approvals: [] });
  });

  it('an approvePlacement op needs no preflight', () => {
    const f = setup();
    const cy = f.id('Cy Mockup');
    const op: DropOp = { kind: 'approvePlacement', request: { memberId: cy, positionId: f.cyPos } };
    expect(preflight(f.proposal, f.board, f.ward, op)).toEqual({ secondCalling: null, approvals: [] });
  });
});
