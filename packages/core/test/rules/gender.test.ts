import { describe, expect, it } from 'vitest';
import {
  addAssignment,
  addToList,
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  canPlaceMemberInAssignment,
  classifyCallingGender,
  createBoard,
  createWard,
  memberId,
  occupiedDropOptions,
  placeInPosition,
  positionId,
  releaseOccupant,
  swap,
  type AssignmentId,
  type Board,
  type CallingAssignment,
  type CallingGenderRule,
  type CallingGroupId,
  type Member,
  type MemberId,
  type PositionId,
  type Ward,
} from '../../src/index.ts';
import { A1, assignment, callingGroup, member, minimalBoard, position, valueOf, wardOf } from '../model/helpers.ts';
import { contextFor, expectError, expectOk } from '../ops/helpers.ts';

const ORG = boardGroupId('bg-org');
const EQ = callingGroupId('cg-eq');
const RS = callingGroupId('cg-rs');
const OPEN = callingGroupId('cg-open');
const SS = callingGroupId('cg-ss');

const A_EQ = assignmentId('a-eq');
const A_EQ_LIST = assignmentId('a-eq-list');
const A_RS = assignmentId('a-rs');
const A_RS_LIST = assignmentId('a-rs-list');
const A_UNSET = assignmentId('a-unset');
const A_SS_FIRST = assignmentId('a-ss-first');

const P_EQ = positionId('p-eq');
const P_EQ_LIST = positionId('p-eq-list');
const P_RS = positionId('p-rs');
const P_RS_LIST = positionId('p-rs-list');
const P_ANY = positionId('p-any');
const P_UNSET = positionId('p-unset');
const P_SS_PRES = positionId('p-ss-pres');
const P_SS_FIRST = positionId('p-ss-first');
const P_SS_SECOND = positionId('p-ss-second');
const P_SS_SEC = positionId('p-ss-sec');
const P_SS_TEACHER = positionId('p-ss-teacher');

const MALE = memberId('m-male');
const MALE_2 = memberId('m-male-2');
const MALE_3 = memberId('m-male-3');
const MALE_4 = memberId('m-male-4');
const FEMALE = memberId('m-female');
const FEMALE_2 = memberId('m-female-2');
const LEGACY = memberId('m-legacy');

function expectClass(organization: string, title: string, rule: CallingGenderRule): void {
  expect([organization, title, classifyCallingGender(organization, title)]).toEqual([organization, title, rule]);
}

function genderedWard(): Ward {
  return wardOf(
    member('m-male', { name: 'Adam Example', gender: 'M' }),
    member('m-male-2', { name: 'Dan Example', gender: 'M' }),
    member('m-male-3', { name: 'Finn Example', gender: 'M' }),
    member('m-male-4', { name: 'Gus Example', gender: 'M' }),
    member('m-female', { name: 'Bea Example', gender: 'F' }),
    member('m-female-2', { name: 'Eve Example', gender: 'F' }),
    member('m-legacy', { name: 'Cy Legacy' }),
  );
}

function seat(
  id: string,
  group: CallingGroupId,
  title: string,
  order: number,
  extras: Partial<CallingAssignment> = {},
): CallingAssignment {
  return assignment(id, { groupId: group, title, order, ...extras });
}

function proposalBoard(ward: Ward, placements: Board['placements'] = {}): Board {
  const assignments = [
    seat('a-eq', EQ, 'Elders Quorum President', 0, { genderRule: 'M' }),
    seat('a-eq-list', EQ, 'Elders Quorum Teacher', 1, { type: 'list', genderRule: 'M' }),
    seat('a-rs', RS, 'Relief Society President', 0, { genderRule: 'F' }),
    seat('a-rs-list', RS, 'Relief Society Teacher', 1, { type: 'list', genderRule: 'F' }),
    seat('a-any', OPEN, 'Chorister', 0, { genderRule: 'any' }),
    seat('a-unset', OPEN, 'Music Leader', 1),
    seat('a-ss-pres', SS, 'Sunday School President', 0, { genderRule: 'presidency_aligned', leadershipRole: 'president' }),
    seat('a-ss-first', SS, 'First Counselor', 1, { genderRule: 'presidency_aligned', leadershipRole: 'counselor' }),
    seat('a-ss-second', SS, 'Second Counselor', 2, { genderRule: 'presidency_aligned', leadershipRole: 'counselor' }),
    seat('a-ss-sec', SS, 'Secretary', 3, { genderRule: 'presidency_aligned', leadershipRole: 'secretary' }),
    seat('a-ss-teacher', SS, 'Sunday School Teacher', 4, { type: 'list', genderRule: 'any' }),
  ];
  const positions = [
    position('p-eq', 'a-eq'),
    position('p-eq-list', 'a-eq-list'),
    position('p-rs', 'a-rs'),
    position('p-rs-list', 'a-rs-list'),
    position('p-any', 'a-any'),
    position('p-unset', 'a-unset'),
    position('p-ss-pres', 'a-ss-pres'),
    position('p-ss-first', 'a-ss-first'),
    position('p-ss-second', 'a-ss-second'),
    position('p-ss-sec', 'a-ss-sec'),
    position('p-ss-teacher', 'a-ss-teacher'),
  ];
  return valueOf(
    createBoard(
      {
        id: boardId('b-gender'),
        kind: 'proposal',
        version: 1,
        boardGroups: { [ORG]: { id: ORG, name: 'Ward', order: 0, visible: true, key: null } },
        callingGroups: {
          [EQ]: callingGroup('cg-eq', { name: 'Elders Quorum', order: 0, kind: 'quorum', parent: { kind: 'boardGroup', id: ORG } }),
          [RS]: callingGroup('cg-rs', { name: 'Relief Society', order: 1, kind: 'presidency', parent: { kind: 'boardGroup', id: ORG } }),
          [OPEN]: callingGroup('cg-open', { name: 'Music', order: 2, kind: 'committee', parent: { kind: 'boardGroup', id: ORG } }),
          [SS]: callingGroup('cg-ss', {
            name: 'Sunday School Presidency',
            order: 3,
            kind: 'presidency',
            parent: { kind: 'boardGroup', id: ORG },
          }),
        },
        assignments: Object.fromEntries(assignments.map((item) => [item.id, item])),
        positions: Object.fromEntries(positions.map((item) => [item.id, item])),
        placements,
        oversight: [],
        dugoutInclusions: [],
        approvals: [],
      },
      ward,
    ),
  );
}

function place(board: Board, ward: Ward, memberId: MemberId, to: PositionId) {
  return placeInPosition(board, contextFor(ward), { memberId, from: null, to });
}

function addList(board: Board, ward: Ward, memberId: MemberId, assignmentId: AssignmentId) {
  return addToList(board, contextFor(ward), { memberId, from: null, assignmentId });
}

describe('calling gender', () => {
  it('createWard and createBoard validate gender and genderRule', () => {
    const plain = member('m-plain');
    const male = member('m-male', { gender: 'M' });
    const female = member('m-female', { gender: 'F' });
    const ward = valueOf(
      createWard({
        members: { [plain.id]: plain, [male.id]: male, [female.id]: female },
        tags: {},
      }),
    );

    expect(ward.members[male.id]?.gender).toBe('M');
    expect(ward.members[female.id]?.gender).toBe('F');
    expect(Object.hasOwn(ward.members[plain.id] ?? {}, 'gender')).toBe(false);

    const holder = wardOf(member('m-1', { gender: 'M' }));
    for (const rule of ['M', 'F', 'any', 'presidency_aligned'] as const) {
      const board = valueOf(createBoard(minimalBoard({ assignments: { [A1]: assignment('a-1', { genderRule: rule }) } }), holder));
      expect(board.assignments[A1]?.genderRule).toBe(rule);
    }
    const omitted = valueOf(createBoard(minimalBoard(), holder));
    expect(Object.hasOwn(omitted.assignments[A1] ?? {}, 'genderRule')).toBe(false);

    const badMember = { ...member('m-1'), gender: 'X' } as unknown as Member;
    const rejectedMember = createWard({ members: { [badMember.id]: badMember }, tags: {} });
    expect(rejectedMember.ok).toBe(false);
    if (!rejectedMember.ok) {
      expect(rejectedMember.errors).toEqual([
        expect.objectContaining({ code: 'invalid_field', path: 'members.m-1.gender' }),
      ]);
    }

    const badAssignment = { ...assignment('a-1'), genderRule: 'couple' } as unknown as CallingAssignment;
    const rejectedBoard = createBoard(minimalBoard({ assignments: { [A1]: badAssignment } }), holder);
    expect(rejectedBoard.ok).toBe(false);
    if (!rejectedBoard.ok) {
      expect(rejectedBoard.errors).toEqual([
        expect.objectContaining({ code: 'invalid_field', path: 'assignments.a-1.genderRule' }),
      ]);
    }
  });

  it('classifyCallingGender classifies male-only organizations and leaders', () => {
    const maleOnly: readonly (readonly [string, string])[] = [
      ['Bishopric', 'Bishop'],
      ['Bishopric', 'Ward Clerk'],
      ['Bishopric', 'Ward Executive Secretary'],
      ['Bishopric', 'Assistant Ward Clerk'],
      ['Elders Quorum', 'Elders Quorum President'],
      ['Elders Quorum', 'Elders Quorum Teacher'],
      ['Elders Quorum Presidency', 'Secretary'],
      ['Aaronic Priesthood Quorums', 'Deacons Quorum President'],
      ['Aaronic Priesthood Quorums', 'Priests Quorum Adviser'],
      ['Young Men / Aaronic Priesthood', 'Teachers Quorum President'],
      ['Ward Bishopric', 'Executive Secretary'],
      ['Ward Missionaries', 'Ward Mission Leader'],
      ['Ward Missionaries', 'Assistant Ward Mission Leader'],
      ['Temple and Family History', 'Ward Temple and Family History Leader'],
      ['Other Callings', 'Priesthood Music Director'],
      ['Music', 'Priesthood Music Director'],
      ['Ward-wide Callings', 'Ward Mission Leader'],
    ];
    for (const [organization, title] of maleOnly) {
      expectClass(organization, title, 'M');
    }
    expectClass('Ward Missionaries', 'Ward Missionary', 'any');
    expectClass('Temple and Family History', 'Ward Temple and Family History Consultant', 'any');
    expectClass('Other Callings', 'Priesthood Pianist', 'any');
    expectClass('Music', 'Music Coordinator', 'any');
  });

  it('classifyCallingGender classifies female-only organizations', () => {
    const femaleOnly: readonly (readonly [string, string])[] = [
      ['Relief Society', 'Relief Society President'],
      ['Relief Society', 'Relief Society First Counselor'],
      ['Relief Society', 'Relief Society Second Counselor'],
      ['Relief Society', 'Relief Society Secretary'],
      ['Relief Society', 'Relief Society Teacher'],
      ['Relief Society', 'Relief Society Adviser'],
      ['Relief Society', 'Relief Society Specialist'],
      ['Relief Society Activities', 'Committee Member'],
      ['Young Women', 'Young Women President'],
      ['Young Women', 'Young Women Secretary'],
      ['Young Women', 'Young Women Adviser'],
      ['Young Women', 'Young Women Specialist'],
      ['Young Women', 'Young Women Teacher'],
      ['Young Women', 'Gatherers of Light Class President'],
      ['Young Women', 'Gatherers of Light Class First Counselor'],
      ['Young Women', 'Gatherers of Light Class Second Counselor'],
      ['Young Women', 'Gatherers of Light Class Secretary'],
      ['Young Women Camp', 'Camp Specialist'],
    ];
    for (const [organization, title] of femaleOnly) {
      expectClass(organization, title, 'F');
    }
  });

  it('classifies Primary presidency and secretary as F and other Primary callings as any', () => {
    for (const title of [
      'President',
      'Primary President',
      'First Counselor',
      'Primary First Counselor',
      'Second Counselor',
      'Primary Second Counselor',
      'Secretary',
      'Primary Secretary',
    ]) {
      expectClass('Primary', title, 'F');
    }
    for (const title of [
      'Primary Teacher',
      'Nursery Leader',
      'Primary Music Leader',
      'Primary Pianist',
      'Valiant Activities Leader',
      'Primary Activity Secretary',
    ]) {
      expectClass('Primary', title, 'any');
    }
  });

  it('classifies Sunday School presidency and secretary as presidency_aligned and teachers as any', () => {
    for (const title of [
      'President',
      'Sunday School President',
      'First Counselor',
      'Sunday School First Counselor',
      'Second Counselor',
      'Sunday School Second Counselor',
      'Secretary',
      'Sunday School Secretary',
    ]) {
      expectClass('Sunday School', title, 'presidency_aligned');
    }
    for (const title of [
      'Sunday School Teacher',
      'Gospel Doctrine Teacher',
      'Resource Center Specialist',
      'Youth Sunday School Teacher',
      'Assistant President',
    ]) {
      expectClass('Sunday School', title, 'any');
    }
  });

  it('normalizes organization and title case and whitespace', () => {
    expectClass('  BiShOpRiC  ', '  Ward   Clerk ', 'M');
    expectClass('RELIEF   SOCIETY', ' relief society   teacher ', 'F');
    expectClass('\tPrimary\n', 'PRIMARY   PRESIDENT', 'F');
    expectClass(' primary ', 'primary   teacher', 'any');
    expectClass('Sunday\tSchool', ' sunday   school secretary ', 'presidency_aligned');
    expectClass('  ward   missionaries ', ' Assistant   Ward Mission   Leader ', 'M');
    expectClass('Other   Callings', 'priesthood music director', 'M');
  });

  it('refuses placing a member into a mismatched M or F calling', () => {
    const ward = genderedWard();
    const board = proposalBoard(ward);

    const femaleIntoMale = expectError(place(board, ward, FEMALE, P_EQ));
    expect(femaleIntoMale.code).toBe('gender_mismatch');
    expect(femaleIntoMale.message).toBe('Elders Quorum President requires a male member');

    const maleIntoFemale = expectError(place(board, ward, MALE, P_RS));
    expect(maleIntoFemale.code).toBe('gender_mismatch');
    expect(maleIntoFemale.message).toBe('Relief Society President requires a female member');

    const femaleIntoMaleList = expectError(addList(board, ward, FEMALE, A_EQ_LIST));
    expect(femaleIntoMaleList.code).toBe('gender_mismatch');
    expect(femaleIntoMaleList.message).toBe('Elders Quorum Teacher requires a male member');

    const maleIntoFemaleList = expectError(addList(board, ward, MALE, A_RS_LIST));
    expect(maleIntoFemaleList.code).toBe('gender_mismatch');
    expect(maleIntoFemaleList.message).toBe('Relief Society Teacher requires a female member');

    expect(expectOk(place(board, ward, MALE, P_EQ)).placements[P_EQ]).toBe(MALE);
    expect(expectOk(place(board, ward, FEMALE, P_RS)).placements[P_RS]).toBe(FEMALE);
    expect(expectOk(addList(board, ward, MALE, A_EQ_LIST)).placements[P_EQ_LIST]).toBe(MALE);
    expect(expectOk(addList(board, ward, FEMALE, A_RS_LIST)).placements[P_RS_LIST]).toBe(FEMALE);
    expect(expectOk(place(board, ward, MALE, P_ANY)).placements[P_ANY]).toBe(MALE);
    expect(expectOk(place(board, ward, FEMALE, P_ANY)).placements[P_ANY]).toBe(FEMALE);

    expect(canPlaceMemberInAssignment(board, ward, FEMALE, A_EQ)).toEqual({
      ok: false,
      requiredGender: 'M',
      message: 'Elders Quorum President requires a male member',
    });
    expect(canPlaceMemberInAssignment(board, ward, MALE, A_RS)).toEqual({
      ok: false,
      requiredGender: 'F',
      message: 'Relief Society President requires a female member',
    });
  });

  it('allows a member with no recorded gender in any calling', () => {
    const ward = genderedWard();
    const board = proposalBoard(ward);
    expect(canPlaceMemberInAssignment(board, ward, LEGACY, A_EQ)).toEqual({ ok: true });
    expect(canPlaceMemberInAssignment(board, ward, LEGACY, A_RS)).toEqual({ ok: true });
    expect(expectOk(place(board, ward, LEGACY, P_EQ)).placements[P_EQ]).toBe(LEGACY);
    expect(expectOk(place(board, ward, LEGACY, P_RS)).placements[P_RS]).toBe(LEGACY);
    const aligned = proposalBoard(ward, { [P_SS_PRES]: FEMALE });
    expect(canPlaceMemberInAssignment(aligned, ward, LEGACY, A_SS_FIRST)).toEqual({ ok: true });
    expect(expectOk(place(aligned, ward, LEGACY, P_SS_FIRST)).placements[P_SS_FIRST]).toBe(LEGACY);
  });

  it('treats an assignment with no genderRule as any', () => {
    const ward = genderedWard();
    const board = proposalBoard(ward);
    expect(board.assignments[A_UNSET]?.genderRule).toBeUndefined();
    expect(canPlaceMemberInAssignment(board, ward, MALE, A_UNSET)).toEqual({ ok: true });
    expect(canPlaceMemberInAssignment(board, ward, FEMALE, A_UNSET)).toEqual({ ok: true });
    expect(expectOk(place(board, ward, MALE, P_UNSET)).placements[P_UNSET]).toBe(MALE);
    expect(expectOk(place(board, ward, FEMALE, P_UNSET)).placements[P_UNSET]).toBe(FEMALE);
  });

  it('enforces Sunday School presidency gender alignment', () => {
    const ward = genderedWard();
    const presidentFemale = proposalBoard(ward, { [P_SS_PRES]: FEMALE, [P_SS_TEACHER]: MALE });

    const maleCounselor = expectError(place(presidentFemale, ward, MALE_2, P_SS_FIRST));
    expect(maleCounselor.code).toBe('gender_mismatch');
    expect(maleCounselor.message).toBe('First Counselor must match the gender of the Sunday School presidency (F)');

    const maleSecretary = expectError(place(presidentFemale, ward, MALE_2, P_SS_SEC));
    expect(maleSecretary.code).toBe('gender_mismatch');
    expect(maleSecretary.message).toBe('Secretary must match the gender of the Sunday School presidency (F)');

    expect(expectOk(place(presidentFemale, ward, FEMALE_2, P_SS_FIRST)).placements[P_SS_FIRST]).toBe(FEMALE_2);

    expect(canPlaceMemberInAssignment(presidentFemale, ward, MALE_2, A_SS_FIRST)).toEqual({
      ok: false,
      requiredGender: 'F',
      message: 'First Counselor must match the gender of the Sunday School presidency (F)',
    });
    expect(
      canPlaceMemberInAssignment(presidentFemale, ward, MALE_2, A_SS_FIRST, { ignorePositions: new Set([P_SS_PRES]) }),
    ).toEqual({ ok: true });
    const secretaryAlsoFemale = proposalBoard(ward, { [P_SS_PRES]: FEMALE, [P_SS_SEC]: FEMALE_2 });
    expect(
      canPlaceMemberInAssignment(secretaryAlsoFemale, ward, MALE, A_SS_FIRST, { ignorePositions: new Set([P_SS_PRES]) }),
    ).toEqual({
      ok: false,
      requiredGender: 'F',
      message: 'First Counselor must match the gender of the Sunday School presidency (F)',
    });

    const counselorMale = proposalBoard(ward, { [P_SS_FIRST]: MALE, [P_SS_TEACHER]: FEMALE });
    const femalePresident = expectError(place(counselorMale, ward, FEMALE, P_SS_PRES));
    expect(femalePresident.code).toBe('gender_mismatch');
    expect(femalePresident.message).toBe('Sunday School President must match the gender of the Sunday School presidency (M)');
    expect(expectOk(place(counselorMale, ward, MALE_2, P_SS_PRES)).placements[P_SS_PRES]).toBe(MALE_2);

    const malePresidency = proposalBoard(ward, {
      [P_SS_PRES]: MALE,
      [P_SS_FIRST]: MALE_2,
      [P_SS_SECOND]: MALE_3,
      [P_SS_SEC]: MALE_4,
    });
    const replaced = expectOk(
      releaseOccupant(malePresidency, contextFor(ward), { memberId: FEMALE, from: null, to: P_SS_PRES }),
    );
    expect(replaced.placements[P_SS_PRES]).toBe(FEMALE);
    expect(replaced.placements[P_SS_FIRST]).toBeUndefined();
    expect(replaced.placements[P_SS_SECOND]).toBeUndefined();
    expect(replaced.placements[P_SS_SEC]).toBeUndefined();
  });

  it('swap and releaseOccupant enforce gender rules on both positions', () => {
    const ward = genderedWard();
    const displacedConflicts = proposalBoard(ward, { [P_EQ]: MALE, [P_ANY]: FEMALE });
    const displaced = expectError(swap(displacedConflicts, contextFor(ward), { memberId: MALE, from: P_EQ, to: P_ANY }));
    expect(displaced.code).toBe('gender_mismatch');
    expect(displaced.message).toBe('Elders Quorum President requires a male member');

    const incomingConflicts = proposalBoard(ward, { [P_ANY]: FEMALE, [P_EQ]: MALE });
    const incoming = expectError(swap(incomingConflicts, contextFor(ward), { memberId: FEMALE, from: P_ANY, to: P_EQ }));
    expect(incoming.code).toBe('gender_mismatch');
    expect(incoming.message).toBe('Elders Quorum President requires a male member');

    const cross = proposalBoard(ward, { [P_EQ]: MALE, [P_RS]: FEMALE });
    const both = expectError(swap(cross, contextFor(ward), { memberId: MALE, from: P_EQ, to: P_RS }));
    expect(both.code).toBe('gender_mismatch');

    expect(
      occupiedDropOptions(displacedConflicts, contextFor(ward), { memberId: MALE, from: P_EQ, to: P_ANY }),
    ).toEqual(['release_occupant']);

    const releaseConflicts = proposalBoard(ward, { [P_ANY]: MALE, [P_RS]: FEMALE });
    expect(
      occupiedDropOptions(releaseConflicts, contextFor(ward), { memberId: MALE, from: P_ANY, to: P_RS }),
    ).toEqual([]);
    const released = expectError(releaseOccupant(releaseConflicts, contextFor(ward), { memberId: MALE, from: P_ANY, to: P_RS }));
    expect(released.code).toBe('gender_mismatch');
    expect(released.message).toBe('Relief Society President requires a female member');
  });

  it('addAssignment stores an optional genderRule and rejects invalid values', () => {
    const ward = genderedWard();
    const board = proposalBoard(ward);

    for (const rule of ['M', 'F', 'any', 'presidency_aligned'] as const) {
      const stored = expectOk(
        addAssignment(board, contextFor(ward), {
          groupId: RS,
          title: `Custom ${rule}`,
          type: 'single',
          positionCount: 1,
          genderRule: rule,
        }),
      );
      const created = Object.values(stored.assignments).find((item) => item.title === `Custom ${rule}`);
      expect(created?.genderRule).toBe(rule);
    }

    const omitted = expectOk(
      addAssignment(board, contextFor(ward), {
        groupId: OPEN,
        title: 'Custom Helper',
        type: 'single',
        positionCount: 1,
      }),
    );
    const helper = Object.values(omitted.assignments).find((item) => item.title === 'Custom Helper');
    expect(helper).toBeDefined();
    expect(Object.hasOwn(helper ?? {}, 'genderRule')).toBe(false);

    const invalid = expectError(
      addAssignment(board, contextFor(ward), {
        groupId: OPEN,
        title: 'Bad Rule',
        type: 'single',
        positionCount: 1,
        genderRule: 'couple' as unknown as CallingGenderRule,
      }),
    );
    expect(invalid.code).toBe('invalid_operation');
    expect(invalid.message).toBe('genderRule must be M, F, any, or presidency_aligned');
  });
});
