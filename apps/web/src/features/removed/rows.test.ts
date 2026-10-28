import { describe, expect, it } from 'vitest';
import { buildPreviewData } from '../../preview/data.ts';
import { buildRemovedScenario, currentWithoutOccupant, findGroup, findMember, REMOVED_DATE, slotByTitle, slotOfOccupant, withRemovedDate } from './fixtures.ts';
import { removedRows } from './rows.ts';

describe('removedRows', () => {
  it('no removed items → total 0, empty lists', () => {
    const data = buildPreviewData();
    // A pristine fixture (no removed_date, current untouched) has nothing removed.
    const rows = removedRows(data.proposal, data.current, data.ward);

    expect(rows.total).toBe(0);
    expect(rows.members).toEqual([]);
    expect(rows.positions).toEqual([]);
  });

  it('removed member lists every position they hold here with title and group', () => {
    const scenario = buildRemovedScenario();
    const data = scenario.data;
    const rows = removedRows(data.proposal, data.current, scenario.ward);

    const jo = findMember(data.ward, 'Jo Testwell');
    // Jo Testwell is the fixture's two-calling member: Relief Society Teacher + Nursery Leader.
    const teachersGroup = findGroup(data.proposal.board, 'Relief Society Teachers');
    const nurseryGroup = findGroup(data.proposal.board, 'Nursery');
    const teacherSlot = slotOfOccupant(data.proposal.board, teachersGroup, jo);
    const nurserySlot = slotOfOccupant(data.proposal.board, nurseryGroup, jo);

    expect(rows.members).toEqual([
      {
        memberId: jo.id,
        name: 'Jo Testwell',
        removedDate: REMOVED_DATE,
        positions: [
          {
            positionId: teacherSlot.id,
            title: 'Relief Society Teacher',
            groupName: 'Relief Society Teachers',
          },
          {
            positionId: nurserySlot.id,
            title: 'Nursery Leader',
            groupName: 'Nursery',
          },
        ],
      },
    ]);
    expect(rows.positions).toEqual([]);
    expect(rows.total).toBe(1);
  });

  it('removed occupied position names the occupant; vacant removed position has occupantName null', () => {
    const scenario = buildRemovedScenario();
    const data = scenario.data;
    // The fixture proposal released Ari Sample from Primary's Second Counselor, so that
    // slot is vacant in the proposal board: its removal must not crash.
    let current = scenario.current;
    current = currentWithoutOccupant(data.ward, current, 'Primary Presidency', 'Ari Sample');
    const rows = removedRows(data.proposal, current, data.ward);

    const kit = findMember(data.ward, 'Kit Notreal');
    const teachersGroup = findGroup(data.proposal.board, 'Relief Society Teachers');
    const primaryGroup = findGroup(data.proposal.board, 'Primary Presidency');
    const kitSlot = slotOfOccupant(data.proposal.board, teachersGroup, kit);
    const ariSlot = slotByTitle(data.proposal.board, primaryGroup, 'Second Counselor');

    expect(rows.positions).toEqual([
      {
        positionId: kitSlot.id,
        title: 'Relief Society Teacher',
        groupName: 'Relief Society Teachers',
        occupantName: 'Kit Notreal',
      },
      {
        positionId: ariSlot.id,
        title: 'Second Counselor',
        groupName: 'Primary Presidency',
        occupantName: null,
      },
    ]);
    expect(rows.members).toEqual([]);
    expect(rows.total).toBe(2);
  });

  it('a member removed and holding a removed position appears in both lists; total counts both', () => {
    const data = buildRemovedScenario().data;
    const ward = withRemovedDate(data.ward, 'Kit Notreal');
    const current = currentWithoutOccupant(data.ward, data.current, 'Relief Society Teachers', 'Kit Notreal');
    const rows = removedRows(data.proposal, current, ward);

    const kit = findMember(data.ward, 'Kit Notreal');
    const teachersGroup = findGroup(data.proposal.board, 'Relief Society Teachers');
    const kitSlot = slotOfOccupant(data.proposal.board, teachersGroup, kit);

    expect(rows.members.map((member) => member.memberId)).toEqual([kit.id]);
    expect(rows.members[0]?.positions.map((position) => position.positionId)).toEqual([kitSlot.id]);
    expect(rows.positions.map((position) => position.positionId)).toEqual([kitSlot.id]);
    expect(rows.total).toBe(2);
  });

  it('proposal-only position (lineage never in baseline) is not listed', () => {
    const scenario = buildRemovedScenario();
    const data = scenario.data;
    const baselineLineages = new Set(Object.values(data.proposal.baseline.positions).map((slot) => slot.lineageId));
    const currentLineages = new Set(Object.values(data.current.positions).map((slot) => slot.lineageId));
    const addedOnly = Object.values(data.proposal.board.positions).filter(
      (slot) => !baselineLineages.has(slot.lineageId) && !currentLineages.has(slot.lineageId),
    );
    // The preview harness adds a Gospel Doctrine list position: a real proposal-only lineage.
    expect(addedOnly.length).toBeGreaterThan(0);

    const rows = removedRows(data.proposal, data.current, data.ward);

    for (const slot of addedOnly) {
      expect(rows.positions).not.toContain(slot.id);
    }
    expect(rows.total).toBe(0);
  });
});
