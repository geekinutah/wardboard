import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Board, BoardGroupId, PositionId } from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { OrganizationView } from './OrganizationView.tsx';

function required<T>(value: T | undefined | null, message = 'value is undefined or null'): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function findBoardGroupByKey(board: Board, key: string): BoardGroupId {
  const found = Object.values(board.boardGroups).find((bg) => bg.key === key);
  if (found === undefined) {
    throw new Error(`fixture board group with key ${key} not found`);
  }
  return found.id;
}

describe('<OrganizationView />', () => {
  it('context line shows breadcrumb, overseer and vacancy count', () => {
    const data = buildPreviewData();
    const rsId = findBoardGroupByKey(data.proposal.board, 'relief_society');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={rsId}
      />,
    );

    // Context line / breadcrumb
    expect(screen.getByText('Relief Society')).toBeInTheDocument();
    expect(screen.getByText('Ward / Relief Society')).toBeInTheDocument();
    expect(screen.getByText(/Overseen by Bishop/)).toBeInTheDocument();
    expect(screen.getByText(/\d+ vacant/)).toBeInTheDocument();
  });

  it('vacant leadership seat renders Vacant with its title', () => {
    const data = buildPreviewData();
    // In buildPreviewData, Primary's Second Counselor was released, making it vacant
    const primaryId = findBoardGroupByKey(data.proposal.board, 'primary');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={primaryId}
      />,
    );

    const leadershipSection = screen.getByRole('region', { name: 'Leadership' });
    expect(leadershipSection).toBeInTheDocument();

    // The vacant slot should have title and "Vacant"
    const vacantSlot = within(leadershipSection).getByRole('article', { name: /Vacant, Second Counselor/i });
    expect(vacantSlot).toBeInTheDocument();
    expect(within(vacantSlot).getByText('Vacant')).toBeInTheDocument();
  });

  it('occupied leadership cards carry member and position ids', () => {
    const data = buildPreviewData();
    const rsId = findBoardGroupByKey(data.proposal.board, 'relief_society');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={rsId}
      />,
    );

    const leadershipSection = screen.getByRole('region', { name: 'Leadership' });
    const cardWrappers = leadershipSection.querySelectorAll('[data-position-id]');
    expect(cardWrappers.length).toBeGreaterThan(0);

    for (const wrapper of cardWrappers) {
      const positionId = wrapper.getAttribute('data-position-id');
      expect(positionId).toBeTruthy();
      const occupant = data.proposal.board.placements[positionId as PositionId];
      if (occupant) {
        expect(wrapper.getAttribute('data-member-id')).toBe(occupant);
      }
    }
  });

  it('each group row is a labeled group zoom target', () => {
    const data = buildPreviewData();
    const rsId = findBoardGroupByKey(data.proposal.board, 'relief_society');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={rsId}
      />,
    );

    const groupsSection = screen.getByRole('region', { name: 'Groups' });
    const zoomTargets = groupsSection.querySelectorAll('[data-zoom-target]');
    expect(zoomTargets.length).toBeGreaterThan(0);

    for (const target of zoomTargets) {
      expect(target.getAttribute('data-zoom-target')).toMatch(/^group:cg-[a-zA-Z0-9_-]+$/);
      expect(target.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('row hides vacancy text at zero and Overseen by when same as the org', () => {
    const data = buildPreviewData();
    const apId = findBoardGroupByKey(data.proposal.board, 'aaronic_priesthood');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={apId}
      />,
    );

    // Aaronic Priesthood org overseer is Bishop.
    // Priests Quorum overseer is Bishop (same as org) -> should NOT display "Overseen by"
    const priestsRow = screen.getByLabelText('Priests Quorum');
    expect(priestsRow).toBeInTheDocument();
    expect(within(priestsRow).queryByText(/Overseen by/)).toBeNull();

    // Teachers Quorum overseer is First Counselor (differs from org) -> MUST display "Overseen by First Counselor"
    const teachersRow = screen.getByLabelText('Teachers Quorum');
    expect(teachersRow).toBeInTheDocument();
    expect(within(teachersRow).getByText(/Overseen by First Counselor/)).toBeInTheDocument();

    // Zero vacancy check: if vacantCount is 0, shows "<filled> filled" and no "vacant"
    const rows = screen.getByRole('region', { name: 'Groups' }).querySelectorAll('[data-zoom-target]');
    for (const row of rows) {
      const text = row.textContent;
      if (!text.includes('vacant')) {
        expect(text).toMatch(/\d+ filled/);
      }
    }
  });

  it('bishopric support row is labeled Support roles', () => {
    const data = buildPreviewData();
    const bId = findBoardGroupByKey(data.proposal.board, 'bishopric');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={bId}
      />,
    );

    const supportGroup = required(
      Object.values(data.proposal.board.callingGroups).find((g) => g.key === 'bishopric_support'),
      'Support group not found',
    );

    const supportRow = screen.getByLabelText(supportGroup.name);
    expect(supportRow).toBeInTheDocument();
    expect(within(supportRow).getByText('Support roles')).toBeInTheDocument();
  });

  it('selected row has aria-current', () => {
    const data = buildPreviewData();
    const rsId = findBoardGroupByKey(data.proposal.board, 'relief_society');
    const rsGroup = required(
      Object.values(data.proposal.board.callingGroups).find(
        (g) => g.parent.kind === 'boardGroup' && g.parent.id === rsId && g.kind !== 'presidency',
      ),
      'RS group not found',
    );

    const { rerender } = render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={rsId}
        selectedId={rsGroup.id}
      />,
    );

    const selectedRow = screen.getByLabelText(rsGroup.name);
    expect(selectedRow).toHaveAttribute('aria-current', 'true');

    // Also support selectedId as `group:<id>`
    rerender(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={rsId}
        selectedId={`group:${rsGroup.id}`}
      />,
    );
    expect(selectedRow).toHaveAttribute('aria-current', 'true');

    // When not selected
    rerender(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={rsId}
        selectedId="other-id"
      />,
    );
    expect(selectedRow).not.toHaveAttribute('aria-current');
  });

  it('renders fallback when no leadership positions or no groups exist', () => {
    const data = buildPreviewData();
    const emptyBgId = 'bg-empty' as BoardGroupId;
    const emptyBoard: Board = {
      ...data.proposal.board,
      boardGroups: {
        ...data.proposal.board.boardGroups,
        [emptyBgId]: {
          id: emptyBgId,
          name: 'Empty Org',
          order: 99,
          visible: true,
          key: null,
        },
      },
    };

    render(
      <OrganizationView
        board={emptyBoard}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={emptyBgId}
      />,
    );

    expect(screen.getByText('No leadership positions.')).toBeInTheDocument();
    expect(screen.getByText('No groups.')).toBeInTheDocument();
  });

  it('no proposed markers when baseline is null', () => {
    const data = buildPreviewData();
    const rsId = findBoardGroupByKey(data.proposal.board, 'relief_society');

    render(
      <OrganizationView
        board={data.proposal.board}
        ward={data.ward}
        baseline={null}
        boardGroupId={rsId}
      />,
    );

    expect(screen.queryByText('+ Proposed')).toBeNull();
  });
});
