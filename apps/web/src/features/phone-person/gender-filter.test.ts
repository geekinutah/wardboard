import { describe, expect, it } from 'vitest';
import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  createWard,
  lineageId,
  memberId,
  positionId,
  type AssignmentId,
  type Board,
  type CallingAssignment,
  type CallingGenderRule,
  type Member,
  type MemberId,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { buildFillCandidates, buildVacantDestinations } from './model.ts';

const ORG = boardGroupId('bg-ward');
const EQ = callingGroupId('cg-eq');
const RS = callingGroupId('cg-rs');
const OPEN = callingGroupId('cg-open');
const SS = callingGroupId('cg-ss');

const ADAM = memberId('m-adam');
const BEA = memberId('m-bea');
const CY = memberId('m-cy');
const EVE = memberId('m-eve');

function member(id: MemberId, name: string, gender?: 'M' | 'F'): Member {
  return {
    id,
    name,
    category: 'adult',
    ...(gender === undefined ? {} : { gender }),
    photoRef: null,
    note: null,
    tagIds: [],
    needsApproval: false,
    removedDate: null,
    externalCallings: [],
  };
}

function assignment(
  id: string,
  groupId: typeof EQ,
  title: string,
  order: number,
  genderRule: CallingGenderRule,
): CallingAssignment {
  return {
    id: assignmentId(id),
    groupId,
    title,
    type: 'single',
    order,
    enabled: true,
    prominent: false,
    origin: 'standard',
    genderRule,
    leadershipRole: null,
    callingTagIds: [],
    preferredMemberTagIds: [],
  };
}

function genderedBoard(): { board: Board; ward: Ward } {
  const wardResult = createWard({
    members: {
      [ADAM]: member(ADAM, 'Adam Example', 'M'),
      [BEA]: member(BEA, 'Bea Example', 'F'),
      [CY]: member(CY, 'Cy Legacy'),
      [EVE]: member(EVE, 'Eve Example', 'F'),
    },
    tags: {},
  });
  if (!wardResult.ok) throw new Error(JSON.stringify(wardResult.errors));
  const ward = wardResult.value;

  const specs = [
    assignment('a-eq', EQ, 'Elders Quorum President', 0, 'M'),
    assignment('a-rs', RS, 'Relief Society President', 0, 'F'),
    assignment('a-any', OPEN, 'Chorister', 0, 'any'),
    assignment('a-ss-pres', SS, 'Sunday School President', 0, 'presidency_aligned'),
    assignment('a-ss-first', SS, 'First Counselor', 1, 'presidency_aligned'),
    assignment('a-ss-teacher', SS, 'Sunday School Teacher', 2, 'any'),
  ];
  const positions = specs.map((item, index) => ({
    id: positionId(`p-${String(index)}`),
    assignmentId: item.id,
    lineageId: lineageId(`l-${String(index)}`),
    order: 0,
  }));
  const president = positions[3];
  if (president === undefined) throw new Error('missing president seat');
  const boardResult = createBoard(
    {
      id: boardId('b-gender-phone'),
      kind: 'proposal',
      version: 1,
      boardGroups: { [ORG]: { id: ORG, name: 'Ward', order: 0, visible: true, key: null } },
      callingGroups: {
        [EQ]: { id: EQ, name: 'Elders Quorum', order: 0, parent: { kind: 'boardGroup', id: ORG }, kind: 'quorum', key: null },
        [RS]: { id: RS, name: 'Relief Society', order: 1, parent: { kind: 'boardGroup', id: ORG }, kind: 'presidency', key: null },
        [OPEN]: { id: OPEN, name: 'Music', order: 2, parent: { kind: 'boardGroup', id: ORG }, kind: 'committee', key: null },
        [SS]: {
          id: SS,
          name: 'Sunday School Presidency',
          order: 3,
          parent: { kind: 'boardGroup', id: ORG },
          kind: 'presidency',
          key: null,
        },
      },
      assignments: Object.fromEntries(specs.map((item) => [item.id, item])),
      positions: Object.fromEntries(positions.map((item) => [item.id, item])),
      placements: { [president.id]: EVE },
      oversight: [],
      dugoutInclusions: [],
      approvals: [],
    },
    ward,
  );
  if (!boardResult.ok) throw new Error(JSON.stringify(boardResult.errors));
  return { board: boardResult.value, ward };
}

function titles(board: Board, ward: Ward, member: MemberId): string[] {
  return buildVacantDestinations(board, ward, member).map((row) => row.title);
}

function positionFor(board: Board, title: string): PositionId {
  const found = Object.values(board.positions).find((position) => board.assignments[position.assignmentId]?.title === title);
  if (found === undefined) throw new Error(`missing ${title}`);
  return found.id;
}

function candidateNames(board: Board, ward: Ward, title: string): string[] {
  return buildFillCandidates(board, ward, positionFor(board, title)).map((row) => row.name);
}

describe('phone gender filters', () => {
  it('phone move and fill models omit gender-incompatible destinations and candidates', () => {
    const { board, ward } = genderedBoard();

    expect(titles(board, ward, ADAM)).toEqual(['Elders Quorum President', 'Chorister', 'Sunday School Teacher']);
    expect(titles(board, ward, BEA)).toEqual(
      expect.arrayContaining(['Relief Society President', 'Chorister', 'Sunday School Teacher']),
    );
    expect(titles(board, ward, BEA)).not.toContain('Elders Quorum President');
    expect(titles(board, ward, CY)).toEqual(
      expect.arrayContaining(['Elders Quorum President', 'Relief Society President', 'Chorister', 'Sunday School Teacher']),
    );

    expect(candidateNames(board, ward, 'Relief Society President')).toEqual(['Bea Example', 'Cy Legacy']);
    expect(candidateNames(board, ward, 'Chorister')).toEqual(['Adam Example', 'Bea Example', 'Cy Legacy']);
  });

  it('Sunday School counselor seats follow a female president', () => {
    const { board, ward } = genderedBoard();
    const counselor: AssignmentId = assignmentId('a-ss-first');
    expect(board.assignments[counselor]?.genderRule).toBe('presidency_aligned');

    expect(titles(board, ward, ADAM)).not.toContain('First Counselor');
    expect(titles(board, ward, BEA)).toContain('First Counselor');
    expect(titles(board, ward, CY)).toContain('First Counselor');
    expect(candidateNames(board, ward, 'First Counselor')).toEqual(['Bea Example', 'Cy Legacy']);
  });
});
