import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  boardGroupId,
  type Board,
  type MemberId,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { WardOverview } from './WardOverview.tsx';

describe('WardOverview', () => {
  it('each tile is a labeled org zoom target', () => {
    const data = buildPreviewData();
    render(<WardOverview board={data.proposal.board} ward={data.ward} baseline={data.proposal.baseline} />);

    // Check visible board groups
    const visibleGroups = Object.values(data.proposal.board.boardGroups).filter((g) => g.visible);
    expect(visibleGroups.length).toBeGreaterThan(0);

    for (const group of visibleGroups) {
      const tile = document.querySelector(`[data-zoom-target="org:${group.id}"]`);
      expect(tile).not.toBeNull();
      expect(tile).toHaveAttribute('aria-label', group.name);
      // tile heading h2 has group name
      const heading = tile?.querySelector('h2');
      expect(heading?.textContent).toBe(group.name);
    }
  });

  it('vacant leaders say Vacant', () => {
    const data = buildPreviewData();
    render(<WardOverview board={data.proposal.board} ward={data.ward} baseline={data.proposal.baseline} />);

    // In preview data, Primary Second Counselor ('p-0038') was released, so that leader slot is vacant
    const vacantTexts = screen.getAllByText('Vacant');
    expect(vacantTexts.length).toBeGreaterThan(0);
  });

  it('vacancy and position counts render as text', () => {
    const data = buildPreviewData();
    render(<WardOverview board={data.proposal.board} ward={data.ward} baseline={data.proposal.baseline} />);

    // Look for text matching "<count> vacant" and "<positions> positions · <filled> filled"
    const vacantMatches = screen.getAllByText(/\d+\s+vacant/i);
    expect(vacantMatches.length).toBeGreaterThan(0);

    const positionMatches = screen.getAllByText(/\d+\s+positions\s+·\s+\d+\s+filled/);
    expect(positionMatches.length).toBeGreaterThan(0);
  });

  it('zero vacancies reads No vacancies', () => {
    const data = buildPreviewData();
    const { unmount } = render(
      <WardOverview board={data.proposal.board} ward={data.ward} baseline={data.proposal.baseline} />,
    );

    // In the fixture, Bishopric has 0 vacancies and renders "No vacancies"
    const noVacancies = screen.getAllByText('No vacancies');
    expect(noVacancies.length).toBeGreaterThan(0);
    unmount();

    // Also verify dedicated board group with 0 vacancies
    const bgZero = boardGroupId('bg-zero');
    const boardWithZeroVacancies: Board = {
      ...data.current,
      boardGroups: {
        [bgZero]: {
          id: bgZero,
          name: 'Full Organization',
          order: 1,
          visible: true,
          key: null,
        },
      },
      callingGroups: {},
      assignments: {},
      positions: {},
      placements: {},
    };
    render(
      <WardOverview board={boardWithZeroVacancies} ward={data.ward} baseline={null} />,
    );
    expect(screen.getByText('No vacancies')).toBeInTheDocument();
  });

  it('proposed chip only when changes exist', () => {
    const data = buildPreviewData();
    render(
      <WardOverview board={data.proposal.board} ward={data.ward} baseline={data.proposal.baseline} />,
    );

    // Some groups have changes (e.g. Primary, Relief Society, Sunday School)
    const proposedChips = screen.getAllByText(/\d+\s+proposed/);
    expect(proposedChips.length).toBeGreaterThan(0);

    // For groups with 0 changes, no chip is rendered (e.g. "0 proposed" must NOT exist)
    expect(screen.queryByText(/0\s+proposed/)).toBeNull();
  });

  it('proposed leader shows + Proposed text', () => {
    const data = buildPreviewData();

    const sundaySchool = Object.values(data.current.callingGroups).find((cg) => cg.name === 'Sunday School Presidency');
    expect(sundaySchool).toBeDefined();
    if (sundaySchool === undefined) throw new Error('missing Sunday School Presidency');

    const ssCounselorAssignment = Object.values(data.current.assignments).find(
      (a) => a.title === 'First Counselor' && a.groupId === sundaySchool.id,
    );
    expect(ssCounselorAssignment).toBeDefined();
    if (ssCounselorAssignment === undefined) throw new Error('missing assignment');

    const pos = Object.values(data.current.positions).find((p) => p.assignmentId === ssCounselorAssignment.id);
    expect(pos).toBeDefined();
    if (pos === undefined) throw new Error('missing position');

    const firstMember = Object.keys(data.ward.members)[0];
    expect(firstMember).toBeDefined();
    if (firstMember === undefined) throw new Error('missing member');
    const memberId = firstMember as MemberId;

    // Filter out pos.id from baseline placements so it is vacant in baseline
    const baselinePlacements = Object.fromEntries(
      Object.entries(data.current.placements).filter(([k]) => k !== pos.id),
    );
    const baseline = {
      ...data.current,
      placements: baselinePlacements,
    };

    const board = {
      ...data.current,
      placements: { ...data.current.placements, [pos.id]: memberId },
    };

    render(<WardOverview board={board} ward={data.ward} baseline={baseline} />);
    expect(screen.getAllByText('+ Proposed').length).toBeGreaterThan(0);
  });

  it('selected tile has aria-current', () => {
    const data = buildPreviewData();
    const visibleGroups = Object.values(data.proposal.board.boardGroups).filter((g) => g.visible);
    expect(visibleGroups.length).toBeGreaterThan(1);
    const selectedGroup = visibleGroups[0];
    const unselectedGroup = visibleGroups[1];
    if (selectedGroup === undefined || unselectedGroup === undefined) {
      throw new Error('expected visible groups');
    }

    const { rerender } = render(
      <WardOverview
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        selectedId={selectedGroup.id}
      />,
    );

    const selectedTile = document.querySelector(`[data-zoom-target="org:${selectedGroup.id}"]`);
    expect(selectedTile).toHaveAttribute('aria-current', 'true');

    // Unselected tile does not have aria-current
    const unselectedTile = document.querySelector(`[data-zoom-target="org:${unselectedGroup.id}"]`);
    expect(unselectedTile).not.toHaveAttribute('aria-current');

    // Without selectedId
    rerender(
      <WardOverview
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
      />,
    );
    expect(selectedTile).not.toHaveAttribute('aria-current');
  });

  it('edge case: board group with no positions renders with 0/0 and No vacancies', () => {
    const data = buildPreviewData();
    const emptyBg = boardGroupId('bg-empty');
    const boardWithEmpty: Board = {
      ...data.current,
      boardGroups: {
        [emptyBg]: {
          id: emptyBg,
          name: 'Empty Group',
          order: 0,
          visible: true,
          key: null,
        },
      },
      callingGroups: {},
      assignments: {},
      positions: {},
      placements: {},
    };

    render(<WardOverview board={boardWithEmpty} ward={data.ward} baseline={null} />);

    const tile = document.querySelector(`[data-zoom-target="org:${emptyBg}"]`);
    expect(tile).not.toBeNull();
    expect(screen.getByText('Empty Group')).toBeInTheDocument();
    expect(screen.getByText('No vacancies')).toBeInTheDocument();
    expect(screen.getByText('0 positions · 0 filled')).toBeInTheDocument();
  });

  it('edge case: all board groups hidden shows text "No organizations are shown."', () => {
    const data = buildPreviewData();
    const hiddenGroups = Object.fromEntries(
      Object.entries(data.current.boardGroups).map(([id, bg]) => [id, { ...bg, visible: false }]),
    );
    const hiddenBoard: Board = {
      ...data.current,
      boardGroups: hiddenGroups,
    };

    render(<WardOverview board={hiddenBoard} ward={data.ward} baseline={null} />);

    expect(screen.getByText('No organizations are shown.')).toBeInTheDocument();
  });

  it('edge case: baseline null has no proposed chips or markers anywhere', () => {
    const data = buildPreviewData();
    render(<WardOverview board={data.proposal.board} ward={data.ward} baseline={null} />);

    expect(screen.queryByText(/\d+\s+proposed/)).toBeNull();
    expect(screen.queryByText('+ Proposed')).toBeNull();
  });
});
