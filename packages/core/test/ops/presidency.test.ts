import { describe, expect, it } from 'vitest';
import {
  addToList,
  applyPresidencyRelease,
  memberId,
  moveToDugout,
  placeInPosition,
  positionId,
  presidencyReleases,
  releaseCalling,
  releaseOccupant,
  removeAssignment,
  swap,
  userId,
  type Approval,
  type Board,
  type BoardInput,
  type CallingAssignment,
  type CallingGroupId,
  type LeadershipRole,
  type MemberId,
  type Position,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import { assignment, callingGroup, position } from '../model/helpers.ts';
import {
  assignmentNamed,
  contextFor,
  expectError,
  expectOk,
  fixtureSetup,
  holdingsOf,
  memberNamed,
  positionNamed,
  rebuild,
  smallBoard,
  smallWard,
} from './helpers.ts';

const APPROVED_AT = '2026-01-05T09:00:00Z';

const RS = 'Relief Society Presidency';
const RS_PRESIDENT = [RS, 'President'] as const;
const RS_FIRST = [RS, 'First Counselor'] as const;
const RS_SECOND = [RS, 'Second Counselor'] as const;
const RS_SECRETARY = [RS, 'Secretary'] as const;
const RS_TEACHERS = ['Relief Society Teachers', 'Relief Society Teacher'] as const;
const CHORISTER = ['Music', 'Chorister'] as const;
const ORGANIST = ['Music', 'Organist'] as const;
const BISHOPRIC = 'Bishopric';
const BISHOP = [BISHOPRIC, 'Bishop'] as const;
const BISHOP_FIRST = [BISHOPRIC, 'First Counselor'] as const;
const BISHOP_SECOND = [BISHOPRIC, 'Second Counselor'] as const;
const CLERK = ['Clerks and Secretaries (support roles)', 'Ward Clerk'] as const;
const EXECUTIVE_SECRETARY = ['Clerks and Secretaries (support roles)', 'Executive Secretary'] as const;
const TEACHERS = 'Teachers Quorum';
const TEACHERS_PRESIDENT = [TEACHERS, 'Teachers Quorum President'] as const;
const TEACHERS_COUNSELOR = [TEACHERS, 'Teachers Quorum First Counselor'] as const;
const TEACHERS_ADVISER = [TEACHERS, 'Teachers Quorum Adviser'] as const;
const DEACONS = 'Deacons Quorum';
const DEACONS_PRESIDENT = [DEACONS, 'Deacons Quorum President'] as const;
const DEACONS_COUNSELOR = [DEACONS, 'Deacons Quorum First Counselor'] as const;
const EQ_FIRST = ['Elders Quorum Presidency', 'First Counselor'] as const;
const PRIMARY = 'Primary Presidency';
const PRIMARY_PRESIDENT = [PRIMARY, 'President'] as const;
const PRIMARY_FIRST = [PRIMARY, 'First Counselor'] as const;
const PRIMARY_SECOND = [PRIMARY, 'Second Counselor'] as const;

interface ReliefSociety {
  readonly ward: Ward;
  readonly board: Board;
  readonly faye: MemberId;
  readonly gwen: MemberId;
  readonly hana: MemberId;
  readonly iris: MemberId;
  readonly president: PositionId;
  readonly first: PositionId;
  readonly second: PositionId;
  readonly secretary: PositionId;
}

function reliefSociety(): ReliefSociety {
  const { ward, board } = fixtureSetup();
  return {
    ward,
    board,
    faye: memberNamed(ward, 'Faye Pretend'),
    gwen: memberNamed(ward, 'Gwen Imaginary'),
    hana: memberNamed(ward, 'Hana Madeup'),
    iris: memberNamed(ward, 'Iris Demo'),
    president: positionNamed(board, ...RS_PRESIDENT),
    first: positionNamed(board, ...RS_FIRST),
    second: positionNamed(board, ...RS_SECOND),
    secretary: positionNamed(board, ...RS_SECRETARY),
  };
}

function approval(member: MemberId, placedAt: PositionId): Approval {
  return { memberId: member, positionId: placedAt, approvedBy: userId('u-admin'), approvedAt: APPROVED_AT };
}

function withoutPlacement(board: Board, placedAt: PositionId): Board['placements'] {
  const placements: Record<PositionId, MemberId> = {};
  for (const [id, member] of Object.entries(board.placements)) {
    if (id !== placedAt) {
      placements[positionId(id)] = member;
    }
  }
  return placements;
}

interface Seat {
  readonly assignment: CallingAssignment;
  readonly position: Position;
  readonly occupant: string | null;
}

function makeSeat(
  assignmentKey: string,
  positionKey: string,
  role: LeadershipRole | null,
  order: number,
  occupant: string | null,
  group?: CallingGroupId,
): Seat {
  return {
    assignment: assignment(assignmentKey, {
      order,
      title: role ?? 'Adviser',
      leadershipRole: role,
      ...(group === undefined ? {} : { groupId: group }),
    }),
    position: position(positionKey, assignmentKey),
    occupant,
  };
}

function boardFrom(seats: readonly Seat[], callingGroups?: Board['callingGroups']): { ward: Ward; board: Board } {
  const ward = smallWard();
  const placements: Record<PositionId, MemberId> = {};
  for (const seat of seats) {
    if (seat.occupant !== null) {
      placements[seat.position.id] = memberId(seat.occupant);
    }
  }
  const changes: Partial<BoardInput> = {
    assignments: Object.fromEntries(seats.map((seat) => [seat.assignment.id, seat.assignment])),
    positions: Object.fromEntries(seats.map((seat) => [seat.position.id, seat.position])),
    placements,
    ...(callingGroups === undefined ? {} : { callingGroups }),
  };
  return { ward, board: smallBoard(ward, changes) };
}

describe('presidency release', () => {
  it('releasing a president releases the counselors', () => {
    const { ward, board, faye, president, first, second } = reliefSociety();
    expect(board.placements[first]).toBeDefined();
    expect(board.placements[second]).toBeDefined();

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: faye, positionId: president }));

    expect(next.placements[president]).toBeUndefined();
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.positions[first]).toEqual(board.positions[first]);
    expect(next.positions[second]).toEqual(board.positions[second]);
  });

  it('releasing a president releases the secretary', () => {
    const { ward, board, faye, iris, president, secretary } = reliefSociety();
    const chorister = positionNamed(board, ...CHORISTER);
    expect(assignmentNamed(board, ...RS_SECRETARY).leadershipRole).toBe('secretary');
    expect(assignmentNamed(board, ...CLERK).leadershipRole).toBeNull();
    expect(assignmentNamed(board, ...EXECUTIVE_SECRETARY).leadershipRole).toBeNull();
    expect(holdingsOf(board, iris)).toEqual([secretary]);

    const withCalling = expectOk(placeInPosition(board, contextFor(ward), { memberId: iris, from: null, to: chorister }));
    const next = expectOk(releaseCalling(withCalling, contextFor(ward), { memberId: faye, positionId: president }));

    expect(next.placements[secretary]).toBeUndefined();
    expect(next.positions[secretary]).toEqual(board.positions[secretary]);
    expect(next.placements[chorister]).toBe(iris);
    expect(holdingsOf(next, iris)).toEqual([chorister]);
    expect(next.dugoutInclusions).toEqual(withCalling.dugoutInclusions);
    expect(next.dugoutInclusions).not.toContain(iris);
  });

  it('counselors keep their other callings', () => {
    const { ward, board, faye, gwen, president, first } = reliefSociety();
    const teachers = assignmentNamed(board, ...RS_TEACHERS).id;
    const added = expectOk(addToList(board, contextFor(ward), { memberId: gwen, from: null, assignmentId: teachers }));
    const kept = positionNamed(added, ...RS_TEACHERS, 3);
    expect(added.placements[kept]).toBe(gwen);
    expect(holdingsOf(added, gwen)).toHaveLength(2);

    const next = expectOk(releaseCalling(added, contextFor(ward), { memberId: faye, positionId: president }));

    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[kept]).toBe(gwen);
    expect(holdingsOf(next, gwen)).toEqual([kept]);
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('a counselor with no other calling gets no explicit inclusion', () => {
    const { ward, board, faye, hana, president, second } = reliefSociety();
    expect(holdingsOf(board, hana)).toEqual([second]);

    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: faye, positionId: president }));

    expect(released.placements[second]).toBeUndefined();
    expect(holdingsOf(released, hana)).toEqual([]);
    expect(released.dugoutInclusions).toEqual([]);

    const ada = memberNamed(ward, 'Ada Fictional');
    const seeded = rebuild(board, ward, { dugoutInclusions: [ada, hana] });
    const kept = expectOk(releaseCalling(seeded, contextFor(ward), { memberId: faye, positionId: president }));

    expect(kept.placements[second]).toBeUndefined();
    expect(kept.dugoutInclusions).toEqual([ada, hana]);
  });

  it('the bishop counts as a president', () => {
    const { ward, board } = fixtureSetup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const ben = memberNamed(ward, 'Ben Example');
    const cal = memberNamed(ward, 'Cal Sample');
    const dora = memberNamed(ward, 'Dora Placeholder');
    const eli = memberNamed(ward, 'Eli Mockup');
    const bishop = positionNamed(board, ...BISHOP);
    const first = positionNamed(board, ...BISHOP_FIRST);
    const second = positionNamed(board, ...BISHOP_SECOND);
    const clerk = positionNamed(board, ...CLERK);
    const executive = positionNamed(board, ...EXECUTIVE_SECRETARY);

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: ada, positionId: bishop }));

    expect(next.placements[bishop]).toBeUndefined();
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.placements[clerk]).toBe(dora);
    expect(next.placements[executive]).toBe(eli);
    expect(holdingsOf(next, ben)).toEqual([]);
    expect(holdingsOf(next, cal)).toEqual([]);
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('moving the president to the dugout releases the counselors', () => {
    const { ward, board, faye, gwen, hana, president, first, second } = reliefSociety();

    const next = expectOk(moveToDugout(board, contextFor(ward), { memberId: faye, from: president }));

    expect(next.placements[president]).toBeUndefined();
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.dugoutInclusions).toEqual([faye]);
    expect(next.dugoutInclusions).not.toContain(gwen);
    expect(next.dugoutInclusions).not.toContain(hana);
  });

  it('release occupant on a president releases the counselors', () => {
    const { ward, board, faye, president, first, second } = reliefSociety();
    const ivy = memberNamed(ward, 'Ivy Notreal');

    const next = expectOk(releaseOccupant(board, contextFor(ward), { memberId: ivy, from: null, to: president }));

    expect(next.placements[president]).toBe(ivy);
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(holdingsOf(next, faye)).toEqual([]);
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('moving the president elsewhere releases the counselors', () => {
    const { ward, board, faye, president, first, second } = reliefSociety();
    const chorister = positionNamed(board, ...CHORISTER);
    const teachers = assignmentNamed(board, ...RS_TEACHERS).id;

    const placed = expectOk(placeInPosition(board, contextFor(ward), { memberId: faye, from: president, to: chorister }));
    expect(placed.placements[chorister]).toBe(faye);
    expect(placed.placements[president]).toBeUndefined();
    expect(placed.placements[first]).toBeUndefined();
    expect(placed.placements[second]).toBeUndefined();

    const listed = expectOk(addToList(board, contextFor(ward), { memberId: faye, from: president, assignmentId: teachers }));
    const kept = holdingsOf(listed, faye);
    expect(kept).toHaveLength(1);
    expect(listed.placements[president]).toBeUndefined();
    expect(listed.placements[first]).toBeUndefined();
    expect(listed.placements[second]).toBeUndefined();
  });

  it('swapping president and first counselor keeps the swapped-in counselor', () => {
    const { ward, board, faye, gwen, president, first, second, secretary } = reliefSociety();

    const next = expectOk(swap(board, contextFor(ward), { memberId: faye, from: president, to: first }));

    expect(next.placements[president]).toBe(gwen);
    expect(next.placements[first]).toBe(faye);
    expect(next.placements[second]).toBeUndefined();
    expect(next.placements[secretary]).toBeUndefined();
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('swapping with someone outside the presidency releases both counselors', () => {
    const { ward, board, faye, president, first, second, secretary } = reliefSociety();
    const gus = memberNamed(ward, 'Gus Demo');
    const organist = positionNamed(board, ...ORGANIST);

    const next = expectOk(swap(board, contextFor(ward), { memberId: faye, from: president, to: organist }));

    expect(next.placements[president]).toBe(gus);
    expect(next.placements[organist]).toBe(faye);
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.placements[secretary]).toBeUndefined();
  });

  it('removing a president assignment releases the counselors', () => {
    const { ward, board, faye, gwen, hana, iris, president, first, second, secretary } = reliefSociety();
    const id = assignmentNamed(board, ...RS_PRESIDENT).id;

    const next = expectOk(removeAssignment(board, contextFor(ward), { assignmentId: id }));

    expect(next.assignments[id]).toBeUndefined();
    expect(next.positions[president]).toBeUndefined();
    expect(next.positions[first]).toEqual(board.positions[first]);
    expect(next.positions[second]).toEqual(board.positions[second]);
    expect(next.positions[secretary]).toEqual(board.positions[secretary]);
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.placements[secretary]).toBeUndefined();
    expect(next.dugoutInclusions).toEqual([faye]);
    expect(next.dugoutInclusions).not.toContain(gwen);
    expect(next.dugoutInclusions).not.toContain(hana);
    expect(next.dugoutInclusions).not.toContain(iris);
    expect(presidencyReleases(board, next)).toEqual([
      { memberId: gwen, positionId: first },
      { memberId: hana, positionId: second },
      { memberId: iris, positionId: secretary },
    ]);
  });

  it('filling a vacant president position releases nobody', () => {
    const { ward, board, gwen, hana, iris, president, first, second, secretary } = reliefSociety();
    const ivy = memberNamed(ward, 'Ivy Notreal');
    const open = rebuild(board, ward, { placements: withoutPlacement(board, president) });
    expect(open.placements[president]).toBeUndefined();
    expect(open.placements[first]).toBe(gwen);

    const next = expectOk(placeInPosition(open, contextFor(ward), { memberId: ivy, from: null, to: president }));

    expect(next.placements[president]).toBe(ivy);
    expect(next.placements[first]).toBe(gwen);
    expect(next.placements[second]).toBe(hana);
    expect(next.placements[secretary]).toBe(iris);
    expect(presidencyReleases(open, next)).toEqual([]);
  });

  it('releasing a counselor releases nobody else', () => {
    const { ward, board, faye, gwen, hana, iris, president, first, second, secretary } = reliefSociety();

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: gwen, positionId: first }));

    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[president]).toBe(faye);
    expect(next.placements[second]).toBe(hana);
    expect(next.placements[secretary]).toBe(iris);
    expect(presidencyReleases(board, next)).toEqual([]);
  });

  it('only the same calling group is affected', () => {
    const { ward, board } = fixtureSetup();
    const ola = memberNamed(ward, 'Ola Mockup');
    const sam = memberNamed(ward, 'Sam Imaginary');
    const ray = memberNamed(ward, 'Ray Imaginary');
    const ben = memberNamed(ward, 'Ben Example');
    const cal = memberNamed(ward, 'Cal Sample');
    const ned = memberNamed(ward, 'Ned Example');
    const gwen = memberNamed(ward, 'Gwen Imaginary');

    const next = expectOk(
      releaseCalling(board, contextFor(ward), { memberId: ola, positionId: positionNamed(board, ...TEACHERS_PRESIDENT) }),
    );

    expect(next.placements[positionNamed(board, ...TEACHERS_COUNSELOR)]).toBeUndefined();
    expect(next.placements[positionNamed(board, ...TEACHERS_ADVISER)]).toBe(sam);
    expect(next.placements[positionNamed(board, ...DEACONS_PRESIDENT)]).toBe(ray);
    expect(next.placements[positionNamed(board, ...DEACONS_COUNSELOR)]).toBeUndefined();
    expect(next.placements[positionNamed(board, ...BISHOP_FIRST)]).toBe(ben);
    expect(next.placements[positionNamed(board, ...BISHOP_SECOND)]).toBe(cal);
    expect(next.placements[positionNamed(board, ...EQ_FIRST)]).toBe(ned);
    expect(next.placements[positionNamed(board, ...RS_FIRST)]).toBe(gwen);
  });

  it('vacant counselor positions are fine', () => {
    const { ward, board } = fixtureSetup();
    const yara = memberNamed(ward, 'Yara Fictional');
    const ari = memberNamed(ward, 'Ari Sample');
    const president = positionNamed(board, ...PRIMARY_PRESIDENT);
    const first = positionNamed(board, ...PRIMARY_FIRST);
    const second = positionNamed(board, ...PRIMARY_SECOND);
    const open = rebuild(board, ward, { placements: withoutPlacement(board, first) });
    expect(open.placements[first]).toBeUndefined();
    expect(open.placements[second]).toBe(ari);

    const next = expectOk(releaseCalling(open, contextFor(ward), { memberId: yara, positionId: president }));

    expect(next.placements[president]).toBeUndefined();
    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.dugoutInclusions).toEqual([]);
  });

  it('approvals of released counselors are dropped', () => {
    const { ward, board, faye, gwen, hana, iris, president, first, second, secretary } = reliefSociety();
    const jo = memberNamed(ward, 'Jo Testwell');
    const teacher = positionNamed(board, ...RS_TEACHERS, 0);
    const approved = rebuild(board, ward, {
      approvals: [approval(gwen, first), approval(hana, second), approval(iris, secretary), approval(faye, president), approval(jo, teacher)],
    });

    const next = expectOk(releaseCalling(approved, contextFor(ward), { memberId: faye, positionId: president }));

    expect(next.placements[first]).toBeUndefined();
    expect(next.placements[second]).toBeUndefined();
    expect(next.placements[secretary]).toBeUndefined();
    expect(next.approvals).toEqual([approval(jo, teacher)]);
  });

  it('presidencyReleases reports the cascade', () => {
    const rs = reliefSociety();
    const released = expectOk(releaseCalling(rs.board, contextFor(rs.ward), { memberId: rs.faye, positionId: rs.president }));
    expect(presidencyReleases(rs.board, released)).toEqual([
      { memberId: rs.gwen, positionId: rs.first },
      { memberId: rs.hana, positionId: rs.second },
      { memberId: rs.iris, positionId: rs.secretary },
    ]);

    const { ward, board } = fixtureSetup();
    const ada = memberNamed(ward, 'Ada Fictional');
    const bishop = positionNamed(board, ...BISHOP);
    const bishopReleased = expectOk(releaseCalling(board, contextFor(ward), { memberId: ada, positionId: bishop }));
    const cascade = presidencyReleases(board, bishopReleased);
    expect(cascade).toEqual([
      { memberId: memberNamed(ward, 'Ben Example'), positionId: positionNamed(board, ...BISHOP_FIRST) },
      { memberId: memberNamed(ward, 'Cal Sample'), positionId: positionNamed(board, ...BISHOP_SECOND) },
    ]);
    const reported = cascade.map((entry) => entry.positionId);
    expect(reported).not.toContain(bishop);
    expect(reported).not.toContain(positionNamed(board, ...CLERK));
    expect(reported).not.toContain(positionNamed(board, ...EXECUTIVE_SECRETARY));

    const jo = memberNamed(ward, 'Jo Testwell');
    const teacherReleased = expectOk(
      releaseCalling(board, contextFor(ward), { memberId: jo, positionId: positionNamed(board, ...RS_TEACHERS) }),
    );
    expect(presidencyReleases(board, teacherReleased)).toEqual([]);

    // Group order is the structural order. Position ids sort the other way.
    const later = callingGroup('cg-b', { order: 0, name: 'Later id' });
    const earlier = callingGroup('cg-a', { order: 1, name: 'Earlier id' });
    const built = boardFrom(
      [
        makeSeat('a-bp', 'p-bp', 'president', 0, 'm-1', later.id),
        makeSeat('a-bc', 'p-z', 'counselor', 1, 'm-2', later.id),
        makeSeat('a-ap', 'p-ap', 'president', 0, 'm-3', earlier.id),
        makeSeat('a-ac', 'p-a', 'counselor', 1, 'm-4', earlier.id),
      ],
      { [later.id]: later, [earlier.id]: earlier },
    );
    const swapped = expectOk(
      swap(built.board, contextFor(built.ward), {
        memberId: memberId('m-1'),
        from: positionId('p-bp'),
        to: positionId('p-ap'),
      }),
    );
    expect(presidencyReleases(built.board, swapped)).toEqual([
      { memberId: memberId('m-2'), positionId: positionId('p-z') },
      { memberId: memberId('m-4'), positionId: positionId('p-a') },
    ]);
  });

  it('the rule never makes an operation fail', () => {
    const { ward, board, faye, gwen, president, first } = reliefSociety();
    const released = expectOk(releaseCalling(board, contextFor(ward), { memberId: faye, positionId: president }));
    expect(applyPresidencyRelease(board, released)).toBe(released);
    expect(released.placements[first]).toBeUndefined();

    const ivy = memberNamed(ward, 'Ivy Notreal');
    const placed = expectOk(placeInPosition(board, contextFor(ward), { memberId: ivy, from: null, to: positionNamed(board, ...CHORISTER) }));
    expect(placed.placements[first]).toBe(gwen);

    const removed = expectOk(
      removeAssignment(board, contextFor(ward), { assignmentId: assignmentNamed(board, ...RS_PRESIDENT).id }),
    );
    expect(removed.positions[president]).toBeUndefined();

    const jo = memberNamed(ward, 'Jo Testwell');
    const refused = expectError(releaseCalling(board, contextFor(ward), { memberId: jo, positionId: president }));
    expect(refused.code).toBe('not_placed');

    const drafted = { ...board, placements: withoutPlacement(board, president) };
    const once = applyPresidencyRelease(board, drafted);
    const twice = applyPresidencyRelease(board, once);
    expect(twice).toBe(once);
    expect(once.placements[first]).toBeUndefined();
  });

  it('a president who is also a counselor is released from both', () => {
    const { ward, board } = boardFrom([
      makeSeat('a-p', 'p-p', 'president', 0, 'm-1'),
      makeSeat('a-c1', 'p-c1', 'counselor', 1, 'm-1'),
      makeSeat('a-c2', 'p-c2', 'counselor', 2, 'm-2'),
      makeSeat('a-s', 'p-s', 'secretary', 3, 'm-3'),
    ]);
    const president = positionId('p-p');
    const ownCounselor = positionId('p-c1');
    const otherCounselor = positionId('p-c2');
    const secretary = positionId('p-s');

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: memberId('m-1'), positionId: president }));

    expect(next.placements[president]).toBeUndefined();
    expect(next.placements[ownCounselor]).toBeUndefined();
    expect(next.placements[otherCounselor]).toBeUndefined();
    expect(next.placements[secretary]).toBeUndefined();
    expect(holdingsOf(next, memberId('m-1'))).toEqual([]);
    expect(next.dugoutInclusions).toEqual([]);
    expect(presidencyReleases(board, next)).toEqual([
      { memberId: memberId('m-1'), positionId: ownCounselor },
      { memberId: memberId('m-2'), positionId: otherCounselor },
      { memberId: memberId('m-3'), positionId: secretary },
    ]);
  });

  it('a counselor seat in another presidency stays', () => {
    const groupA = callingGroup('cg-a', { order: 0, name: 'Presidency A' });
    const groupB = callingGroup('cg-b', { order: 1, name: 'Presidency B' });
    const { ward, board } = boardFrom(
      [
        makeSeat('a-ap', 'p-ap', 'president', 0, 'm-1', groupA.id),
        makeSeat('a-ac', 'p-ac', 'counselor', 1, 'm-2', groupA.id),
        makeSeat('a-bp', 'p-bp', 'president', 0, 'm-3', groupB.id),
        makeSeat('a-bc', 'p-bc', 'counselor', 1, 'm-2', groupB.id),
      ],
      { [groupA.id]: groupA, [groupB.id]: groupB },
    );
    const counselorA = positionId('p-ac');
    const counselorB = positionId('p-bc');

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: memberId('m-1'), positionId: positionId('p-ap') }));

    expect(next.placements[counselorA]).toBeUndefined();
    expect(next.placements[counselorB]).toBe(memberId('m-2'));
    expect(next.placements[positionId('p-bp')]).toBe(memberId('m-3'));
    expect(holdingsOf(next, memberId('m-2'))).toEqual([counselorB]);
    expect(next.dugoutInclusions).toEqual([]);
    expect(presidencyReleases(board, next)).toEqual([{ memberId: memberId('m-2'), positionId: counselorA }]);
  });

  it('a presidency with no counselors or secretary releases only the president', () => {
    const { ward, board } = boardFrom([
      makeSeat('a-p', 'p-p', 'president', 0, 'm-1'),
      makeSeat('a-v', 'p-v', null, 1, 'm-2'),
    ]);
    const adviser = positionId('p-v');

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: memberId('m-1'), positionId: positionId('p-p') }));

    expect(next.placements[positionId('p-p')]).toBeUndefined();
    expect(next.placements[adviser]).toBe(memberId('m-2'));
    expect(next.dugoutInclusions).toEqual([]);
    expect(presidencyReleases(board, next)).toEqual([]);
  });

  it('an adviser in the same calling group stays placed', () => {
    const { ward, board } = fixtureSetup();
    const ola = memberNamed(ward, 'Ola Mockup');
    const sam = memberNamed(ward, 'Sam Imaginary');
    const pax = memberNamed(ward, 'Pax Pretend');
    const adviser = positionNamed(board, ...TEACHERS_ADVISER);
    const counselor = positionNamed(board, ...TEACHERS_COUNSELOR);
    expect(assignmentNamed(board, ...TEACHERS_ADVISER).leadershipRole).toBeNull();

    const next = expectOk(
      releaseCalling(board, contextFor(ward), { memberId: ola, positionId: positionNamed(board, ...TEACHERS_PRESIDENT) }),
    );

    expect(next.placements[adviser]).toBe(sam);
    expect(next.placements[counselor]).toBeUndefined();
    expect(next.dugoutInclusions).not.toContain(sam);
    expect(next.dugoutInclusions).not.toContain(pax);
    expect(holdingsOf(next, sam)).toEqual([adviser]);
  });

  it('a counselor in a nested calling group is not released', () => {
    const parent = callingGroup('cg-parent', { order: 0, name: 'Parent Presidency' });
    const child = callingGroup('cg-child', { order: 0, name: 'Nested Group', parent: { kind: 'callingGroup', id: parent.id } });
    const { ward, board } = boardFrom(
      [
        makeSeat('a-p', 'p-p', 'president', 0, 'm-1', parent.id),
        makeSeat('a-c', 'p-c', 'counselor', 1, 'm-2', parent.id),
        makeSeat('a-n', 'p-n', 'counselor', 0, 'm-3', child.id),
      ],
      { [parent.id]: parent, [child.id]: child },
    );

    const next = expectOk(releaseCalling(board, contextFor(ward), { memberId: memberId('m-1'), positionId: positionId('p-p') }));

    expect(next.placements[positionId('p-c')]).toBeUndefined();
    expect(next.placements[positionId('p-n')]).toBe(memberId('m-3'));
    expect(presidencyReleases(board, next)).toEqual([{ memberId: memberId('m-2'), positionId: positionId('p-c') }]);
  });
});
