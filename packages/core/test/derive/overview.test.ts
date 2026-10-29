import { describe, expect, it } from 'vitest';
import {
  addListPosition,
  addToList,
  boardGroupId,
  placeInPosition,
  releaseCalling,
  removePosition,
  setBoardGroupVisible,
  vacancyCountsByBoardGroup,
  wardOverview,
  type Board,
  type BoardGroup,
  type BoardGroupKey,
} from '../../src/index.ts';
import {
  assignmentNamed,
  contextFor,
  expectOk,
  fixtureSetup,
  memberNamed,
  positionNamed,
  rebuild,
} from '../ops/helpers.ts';

function findGroupByKey(board: Board, key: BoardGroupKey): BoardGroup {
  const found = Object.values(board.boardGroups).find((group) => group.key === key);
  if (found === undefined) {
    throw new Error(`no board group with key ${key}`);
  }
  return found;
}

describe('wardOverview', () => {
  it('one tile per visible board group in order', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    const initialTiles = wardOverview(board, baseline);
    const visibleGroups = Object.values(board.boardGroups)
      .filter((g) => g.visible)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));

    expect(initialTiles.map((t) => t.boardGroupId)).toEqual(visibleGroups.map((g) => g.id));
    expect(initialTiles.map((t) => t.name)).toEqual(visibleGroups.map((g) => g.name));

    // Hide Relief Society board group
    const reliefSociety = findGroupByKey(board, 'relief_society');
    const withHidden = expectOk(
      setBoardGroupVisible(board, ctx, { boardGroupId: reliefSociety.id, visible: false }),
    );
    const updatedTiles = wardOverview(withHidden, baseline);

    expect(updatedTiles.some((t) => t.boardGroupId === reliefSociety.id)).toBe(false);
    expect(updatedTiles).toHaveLength(initialTiles.length - 1);
    // Order still matches visible groups
    const remainingVisible = Object.values(withHidden.boardGroups)
      .filter((g) => g.visible)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
    expect(updatedTiles.map((t) => t.boardGroupId)).toEqual(remainingVisible.map((g) => g.id));
  });

  it('the Aaronic tile has no leaders', () => {
    const { baseline, board } = fixtureSetup();
    const tiles = wardOverview(board, baseline);

    const aaronicGroup = findGroupByKey(board, 'aaronic_priesthood');
    const aaronicTile = tiles.find((t) => t.boardGroupId === aaronicGroup.id);
    expect(aaronicTile).toBeDefined();
    expect(aaronicTile?.leaders).toEqual([]);
  });

  it('vacant leader has null memberId', () => {
    const { ward, baseline, board } = fixtureSetup();
    const primaryGroup = findGroupByKey(board, 'primary');
    const presPos = positionNamed(board, 'Primary Presidency', 'President');

    const ctx = contextFor(ward);
    const occupant = board.placements[presPos];
    expect(occupant).toBeDefined();
    if (occupant === undefined) {
      throw new Error('expected occupant');
    }

    const testBoard = expectOk(releaseCalling(board, ctx, { memberId: occupant, positionId: presPos }));

    const tiles = wardOverview(testBoard, baseline);
    const primaryTile = tiles.find((t) => t.boardGroupId === primaryGroup.id);
    const leader = primaryTile?.leaders.find((l) => l.positionId === presPos);

    expect(leader).toBeDefined();
    expect(leader?.memberId).toBeNull();
  });

  it('counts ignore disabled assignments and match vacancyCountsByBoardGroup', () => {
    const { ward, baseline, board } = fixtureSetup();
    const primaryGroup = findGroupByKey(board, 'primary');
    const teacherAssignment = assignmentNamed(board, 'Primary Teachers', 'Primary Teacher');

    // Disable Primary Teacher assignment
    const disabledBoard = rebuild(board, ward, {
      assignments: {
        ...board.assignments,
        [teacherAssignment.id]: {
          ...teacherAssignment,
          enabled: false,
        },
      },
    });

    const tiles = wardOverview(disabledBoard, baseline);
    const expectedVacancies = vacancyCountsByBoardGroup(disabledBoard);

    for (const tile of tiles) {
      expect(tile.vacantCount).toBe(expectedVacancies.get(tile.boardGroupId) ?? 0);
      expect(tile.vacantCount).toBe(tile.positionCount - tile.filledCount);
    }

    const primaryTile = tiles.find((t) => t.boardGroupId === primaryGroup.id);
    const originalTile = wardOverview(board, baseline).find((t) => t.boardGroupId === primaryGroup.id);

    expect(primaryTile).toBeDefined();
    expect(originalTile).toBeDefined();
    if (originalTile === undefined) {
      throw new Error('expected originalTile');
    }
    const disabledPositionsCount = Object.values(board.positions).filter(
      (p) => p.assignmentId === teacherAssignment.id,
    ).length;
    expect(primaryTile?.positionCount).toBe(originalTile.positionCount - disabledPositionsCount);
  });

  it('change count is zero with no baseline and for an unchanged proposal', () => {
    const { baseline, board } = fixtureSetup();

    // Baseline null
    const noBaselineTiles = wardOverview(board, null);
    for (const tile of noBaselineTiles) {
      expect(tile.changeCount).toBe(0);
      for (const leader of tile.leaders) {
        expect(leader.proposed).toBe(false);
      }
    }

    // Unchanged proposal (board identical to baseline)
    const unchangedTiles = wardOverview(board, baseline);
    for (const tile of unchangedTiles) {
      expect(tile.changeCount).toBe(0);
      for (const leader of tile.leaders) {
        expect(leader.proposed).toBe(false);
      }
    }
  });

  it('release counts toward the board group it came from', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    const primaryGroup = findGroupByKey(board, 'primary');
    const pos = positionNamed(board, 'Primary Teachers', 'Primary Teacher', 0);
    const occupant = board.placements[pos];
    expect(occupant).toBeDefined();
    if (occupant === undefined) {
      throw new Error('expected occupant');
    }

    const released = expectOk(releaseCalling(board, ctx, { memberId: occupant, positionId: pos }));
    const tiles = wardOverview(released, baseline);

    for (const tile of tiles) {
      if (tile.boardGroupId === primaryGroup.id) {
        expect(tile.changeCount).toBe(1);
      } else {
        expect(tile.changeCount).toBe(0);
      }
    }
  });

  it('move across organizations counts in both', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    const primaryGroup = findGroupByKey(board, 'primary');
    const reliefGroup = findGroupByKey(board, 'relief_society');

    const fromPos = positionNamed(board, 'Primary Teachers', 'Primary Teacher', 0);
    const occupant = board.placements[fromPos];
    expect(occupant).toBeDefined();
    if (occupant === undefined) {
      throw new Error('expected occupant');
    }

    const rsAssignment = assignmentNamed(board, 'Relief Society Teachers', 'Relief Society Teacher');

    // Move across using addToList
    const moved = expectOk(
      addToList(board, ctx, {
        memberId: occupant,
        from: fromPos,
        assignmentId: rsAssignment.id,
      }),
    );

    const tiles = wardOverview(moved, baseline);
    const primaryTile = tiles.find((t) => t.boardGroupId === primaryGroup.id);
    const rsTile = tiles.find((t) => t.boardGroupId === reliefGroup.id);

    expect(primaryTile?.changeCount).toBe(1); // 1 release
    expect(rsTile?.changeCount).toBe(1); // 1 calling
  });

  it('added and removed positions count', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    const ssGroup = findGroupByKey(board, 'sunday_school');
    const ssTeacher = assignmentNamed(board, 'Gospel Doctrine', 'Gospel Doctrine Teacher');

    // Add list position
    const withAdded = expectOk(addListPosition(board, ctx, { assignmentId: ssTeacher.id }));
    const addedTiles = wardOverview(withAdded, baseline);
    const ssTileAdded = addedTiles.find((t) => t.boardGroupId === ssGroup.id);
    expect(ssTileAdded?.changeCount).toBe(1);

    // Remove a vacant position in primary
    const primaryGroup = findGroupByKey(board, 'primary');
    const primaryVacantPos = positionNamed(board, 'Primary Teachers', 'Primary Teacher', 2);
    expect(board.placements[primaryVacantPos]).toBeUndefined();

    const withRemoved = expectOk(removePosition(board, ctx, { positionId: primaryVacantPos }));
    const removedTiles = wardOverview(withRemoved, baseline);
    const primaryTileRemoved = removedTiles.find((t) => t.boardGroupId === primaryGroup.id);
    expect(primaryTileRemoved?.changeCount).toBe(1);
  });

  it('moving back cancels', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    const ssPresidentPos = positionNamed(board, 'Sunday School Presidency', 'President');
    const occupant = board.placements[ssPresidentPos];
    expect(occupant).toBeDefined();
    if (occupant === undefined) {
      throw new Error('expected occupant');
    }

    // Release occupant
    const released = expectOk(releaseCalling(board, ctx, { memberId: occupant, positionId: ssPresidentPos }));

    // Place occupant back into pos
    const back = expectOk(
      placeInPosition(released, ctx, {
        memberId: occupant,
        from: null,
        to: ssPresidentPos,
      }),
    );

    const tiles = wardOverview(back, baseline);
    for (const tile of tiles) {
      expect(tile.changeCount).toBe(0);
    }
  });

  it('proposed leader flag', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    // Sunday School First Counselor is vacant in baseline
    const ssCounselorPos = positionNamed(board, 'Sunday School Presidency', 'First Counselor');
    expect(baseline.placements[ssCounselorPos]).toBeUndefined();
    const ssGroup = findGroupByKey(board, 'sunday_school');

    const testMember = memberNamed(ward, 'Ivy Notreal');
    const proposedBoard = expectOk(
      placeInPosition(board, ctx, {
        memberId: testMember,
        from: null,
        to: ssCounselorPos,
      }),
    );

    const tiles = wardOverview(proposedBoard, baseline);
    const ssTile = tiles.find((t) => t.boardGroupId === ssGroup.id);
    const leader = ssTile?.leaders.find((l) => l.positionId === ssCounselorPos);

    expect(leader).toBeDefined();
    expect(leader?.proposed).toBe(true);
    expect(leader?.memberId).toBe(testMember);
  });

  it('handles edge case: board group with no positions', () => {
    const { ward, baseline, board } = fixtureSetup();

    const emptyBgId = boardGroupId('bg-empty');
    const emptyBoardGroup: BoardGroup = {
      id: emptyBgId,
      name: 'Empty Org',
      order: 99,
      visible: true,
      key: null,
    };
    const boardWithEmpty = rebuild(board, ward, {
      boardGroups: {
        ...board.boardGroups,
        [emptyBgId]: emptyBoardGroup,
      },
    });

    const tiles = wardOverview(boardWithEmpty, baseline);
    const emptyTile = tiles.find((t) => t.boardGroupId === emptyBgId);

    expect(emptyTile).toBeDefined();
    expect(emptyTile?.positionCount).toBe(0);
    expect(emptyTile?.filledCount).toBe(0);
    expect(emptyTile?.vacantCount).toBe(0);
    expect(emptyTile?.changeCount).toBe(0);
    expect(emptyTile?.leaders).toEqual([]);
  });

  it('handles edge case: all board groups hidden', () => {
    const { ward, baseline, board } = fixtureSetup();
    const ctx = contextFor(ward);

    let hiddenBoard = board;
    for (const bg of Object.values(board.boardGroups)) {
      hiddenBoard = expectOk(setBoardGroupVisible(hiddenBoard, ctx, { boardGroupId: bg.id, visible: false }));
    }

    const tiles = wardOverview(hiddenBoard, baseline);
    expect(tiles).toEqual([]);
  });
});
