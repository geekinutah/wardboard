import { describe, expect, it } from 'vitest';
import type {
  AssignmentId,
  Board,
  BoardGroupId,
  CallingGroupId,
  LineageId,
  MemberId,
  PositionId,
  Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { buildPersonSheetModel, buildVacantDestinations } from './model.ts';

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`missing member ${name}`);
  }
  return found.id;
}

describe('phone-person model', () => {
  const data = buildPreviewData();
  const board = data.proposal.board;
  const ward = data.ward;

  it('buildPersonSheetModel returns callings, tags, category, and null for unknown member', () => {
    const joId = memberNamed(ward, 'Jo Testwell');
    const joModel = buildPersonSheetModel(board, ward, joId);
    expect(joModel).not.toBeNull();
    if (!joModel) return;

    expect(joModel.memberId).toBe(joId);
    expect(joModel.name).toBe('Jo Testwell');
    expect(joModel.categoryLabel).toBe('Adult');
    expect(joModel.tagNames).toEqual(['Teaches well']);
    expect(joModel.callings).toHaveLength(2);
    expect(joModel.callings[0]).toMatchObject({
      title: 'Relief Society Teacher',
      orgLabel: 'Relief Society · Relief Society Teachers',
    });
    expect(typeof joModel.callings[0]?.positionId).toBe('string');
    expect(typeof joModel.callings[0]?.assignmentId).toBe('string');
    expect(joModel.callings[1]).toMatchObject({
      title: 'Nursery Leader',
      orgLabel: 'Primary · Nursery',
    });
    expect(typeof joModel.callings[1]?.positionId).toBe('string');
    expect(typeof joModel.callings[1]?.assignmentId).toBe('string');

    const taiId = memberNamed(ward, 'Tai Demo');
    const taiModel = buildPersonSheetModel(board, ward, taiId);
    expect(taiModel).not.toBeNull();
    expect(taiModel?.categoryLabel).toBe('Youth');

    expect(buildPersonSheetModel(board, ward, 'm-missing')).toBeNull();
  });

  it('buildPersonSheetModel includes external callings and Needs approval', () => {
    const halId = memberNamed(ward, 'Hal Testwell');
    const halModel = buildPersonSheetModel(board, ward, halId);
    expect(halModel).not.toBeNull();
    expect(halModel?.externalCallings).toEqual([
      { unit: 'Example Stake', title: 'Stake Family History Consultant' },
    ]);

    const cyId = memberNamed(ward, 'Cy Mockup');
    const cyModel = buildPersonSheetModel(board, ward, cyId);
    expect(cyModel).not.toBeNull();
    expect(cyModel?.needsApproval).toBe(true);

    // inExplicitDugout is true when in board.dugoutInclusions
    const boardWithDugout = { ...board, dugoutInclusions: [cyId] };
    const cyWithDugout = buildPersonSheetModel(boardWithDugout, ward, cyId);
    expect(cyWithDugout?.inExplicitDugout).toBe(true);
  });

  it('buildPersonSheetModel formats orgLabel with single name when boardGroup and callingGroup share a name', () => {
    const joId = memberNamed(ward, 'Jo Testwell');
    const bgId = 'bg-test' as BoardGroupId;
    const cgId = 'cg-test' as CallingGroupId;
    const aId = 'a-test' as AssignmentId;
    const pId = 'p-test' as PositionId;
    const lnId = 'ln-test' as LineageId;
    const customBoard: Board = {
      ...board,
      boardGroups: {
        ...board.boardGroups,
        [bgId]: { id: bgId, name: 'Primary', order: 1, visible: true, key: null },
      },
      callingGroups: {
        ...board.callingGroups,
        [cgId]: {
          id: cgId,
          name: 'Primary',
          kind: 'other',
          parent: { kind: 'boardGroup', id: bgId },
          order: 1,
          key: null,
        },
      },
      assignments: {
        ...board.assignments,
        [aId]: {
          id: aId,
          groupId: cgId,
          title: 'Primary Leader',
          type: 'single',
          enabled: true,
          callingTagIds: [],
          preferredMemberTagIds: [],
        },
      },
      positions: {
        ...board.positions,
        [pId]: { id: pId, assignmentId: aId, lineageId: lnId, order: 1 },
      },
      placements: {
        ...board.placements,
        [pId]: joId,
      },
    };
    const model = buildPersonSheetModel(customBoard, ward, joId);
    const primaryCalling = model?.callings.find((c) => c.title === 'Primary Leader');
    expect(primaryCalling?.orgLabel).toBe('Primary');
  });

  it('buildVacantDestinations lists single and collapsed list vacancies with preference matches', () => {
    const joId = memberNamed(ward, 'Jo Testwell');
    const destinations = buildVacantDestinations(board, ward, joId);

    // Primary Second Counselor is a vacant single position
    const secondCounselor = destinations.find((d) => d.title === 'Second Counselor' && d.orgLabel.startsWith('Primary'));
    expect(secondCounselor).toBeDefined();
    expect(secondCounselor?.target.kind).toBe('single');
    expect(secondCounselor?.matchedTagNames).toEqual([]);

    // Primary Teacher list has vacant positions which collapse into one row with Teaches well match
    const primaryTeacherRows = destinations.filter((d) => d.title === 'Primary Teacher');
    expect(primaryTeacherRows).toHaveLength(1);
    const primaryTeacher = primaryTeacherRows[0];
    expect(primaryTeacher?.target.kind).toBe('list');
    expect(primaryTeacher?.matchedTagNames).toEqual(['Teaches well']);

    // Nursery Leader list is excluded because Jo Testwell already holds a position in that list
    const nurseryLeader = destinations.find((d) => d.title === 'Nursery Leader');
    expect(nurseryLeader).toBeUndefined();
  });

  it('buildVacantDestinations filters by query without reordering', () => {
    const joId = memberNamed(ward, 'Jo Testwell');
    const all = buildVacantDestinations(board, ward, joId);
    const blank = buildVacantDestinations(board, ward, joId, '   ');
    expect(blank).toEqual(all);

    const chorister = buildVacantDestinations(board, ward, joId, 'chorister');
    expect(chorister.length).toBeGreaterThan(0);
    expect(chorister.every((d) => d.title.toLowerCase().includes('chorister') || d.orgLabel.toLowerCase().includes('chorister'))).toBe(true);

    const teachesWell = buildVacantDestinations(board, ward, joId, 'teaches well');
    expect(teachesWell.some((d) => d.title === 'Primary Teacher')).toBe(true);
  });
});
