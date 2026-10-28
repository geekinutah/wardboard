import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  placeInPosition,
  sequentialIds,
  setBoardGroupVisible,
  type Board,
  type BoardGroupId,
  type MemberId,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import type { PreviewData } from '../../preview/types.ts';
import type { PhoneOrganization } from './model.ts';
import { PhoneBoard, PhoneOrganizationScreen, type PhoneBoardProps } from './PhoneBoard.tsx';

function draftFixture(): PreviewData {
  return buildPreviewData({ steps: [] });
}

function boardGroupNamed(board: Board, name: string): BoardGroupId {
  const found = Object.values(board.boardGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`missing board group ${name}`);
  }
  return found.id;
}

function callingGroupNamed(board: Board, name: string): string {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`missing calling group ${name}`);
  }
  return found.id;
}

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`missing member ${name}`);
  }
  return found.id;
}

function positionNamed(
  board: Board,
  groupName: string,
  title: string,
): { readonly positionId: PositionId; readonly memberId: MemberId | null } {
  const group = Object.values(board.callingGroups).find((item) => item.name === groupName);
  if (group === undefined) {
    throw new Error(`missing calling group ${groupName}`);
  }
  const assignment = Object.values(board.assignments).find(
    (item) => item.groupId === group.id && item.title === title,
  );
  if (assignment === undefined) {
    throw new Error(`missing assignment ${groupName} / ${title}`);
  }
  const position = Object.values(board.positions)
    .filter((item) => item.assignmentId === assignment.id)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id, 'en'))[0];
  if (position === undefined) {
    throw new Error(`missing position ${groupName} / ${title}`);
  }
  const memberId = Object.hasOwn(board.placements, position.id) ? (board.placements[position.id] ?? null) : null;
  return { positionId: position.id, memberId };
}

function fillPrimarySecretary(data: PreviewData): Board {
  const secretary = positionNamed(data.proposal.board, 'Primary Presidency', 'Secretary');
  if (secretary.memberId !== null) {
    throw new Error('Primary Secretary is not vacant on the fixture proposal');
  }
  const result = placeInPosition(
    data.proposal.board,
    { ward: data.ward, ids: sequentialIds('t048-ui') },
    { memberId: memberNamed(data.ward, 'Ivy Notreal'), from: null, to: secretary.positionId },
  );
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function renderBoard(data: PreviewData, overrides: Partial<PhoneBoardProps> = {}) {
  const props: PhoneBoardProps = {
    board: data.proposal.board,
    baseline: data.proposal.baseline,
    ward: data.ward,
    editable: true,
    onAddPosition: vi.fn(),
    onOpenPerson: vi.fn(),
    onOpenVacancy: vi.fn(),
    ...overrides,
  };
  const view = render(<PhoneBoard {...props} />);
  return { ...view, props };
}

describe('PhoneBoard', () => {
  it('list buttons open an organization', async () => {
    const user = userEvent.setup();
    renderBoard(draftFixture());
    const primary = screen.getByRole('button', { name: /^Primary,/ });
    expect(primary).toHaveAccessibleName(/^Primary, No changes, \d+ vacant$/);
    expect(primary).toHaveAccessibleName(/Primary/);
    expect(primary).toHaveAccessibleName(/No changes/);
    expect(primary).toHaveAccessibleName(/vacant/);
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getAllByText('No changes').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\d+ vacant/).length).toBeGreaterThan(0);

    await user.click(primary);
    expect(screen.getByRole('heading', { level: 1, name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByText('Yara Fictional')).toBeInTheDocument();
    expect(screen.getAllByText('Vacant').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument();
  });

  it('Board returns to the list', async () => {
    const user = userEvent.setup();
    const data = draftFixture();
    renderBoard(data, {
      initialScreen: { kind: 'organization', boardGroupId: boardGroupNamed(data.proposal.board, 'Primary') },
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Primary' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByRole('main', { name: 'Organizations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Primary' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Primary,/ })).toBeInTheDocument();
  });

  it('add and vacancy callbacks fire only when editable', async () => {
    const user = userEvent.setup();
    const data = draftFixture();
    const onAddPosition = vi.fn();
    const onOpenVacancy = vi.fn();
    const primaryId = boardGroupNamed(data.proposal.board, 'Primary');
    const teachersId = callingGroupNamed(data.proposal.board, 'Primary Teachers');
    const secretary = positionNamed(data.proposal.board, 'Primary Presidency', 'Secretary');
    const { props, rerender } = renderBoard(data, {
      onAddPosition,
      onOpenVacancy,
      initialScreen: { kind: 'organization', boardGroupId: primaryId },
    });

    await user.click(screen.getByRole('button', { name: 'Add a position to Primary Teachers' }));
    expect(onAddPosition).toHaveBeenCalledTimes(1);
    expect(onAddPosition).toHaveBeenCalledWith(teachersId);

    await user.click(screen.getByRole('button', { name: 'Vacant, Secretary' }));
    expect(onOpenVacancy).toHaveBeenCalledTimes(1);
    expect(onOpenVacancy).toHaveBeenCalledWith(secretary.positionId);

    rerender(<PhoneBoard {...props} editable={false} onAddPosition={onAddPosition} onOpenVacancy={onOpenVacancy} />);
    expect(screen.queryByRole('button', { name: 'Add a position to Primary Teachers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vacant, Secretary' })).not.toBeInTheDocument();
    expect(screen.getByText('This board is read-only')).toBeInTheDocument();
    expect(screen.queryByText('Tap a person for options · tap a vacancy to fill it')).not.toBeInTheDocument();
    expect(screen.getAllByText('Vacant').length).toBeGreaterThan(0);
  });

  it('person callback and proposed text', async () => {
    const user = userEvent.setup();
    const data = draftFixture();
    const onOpenPerson = vi.fn();
    const primaryId = boardGroupNamed(data.proposal.board, 'Primary');
    const president = positionNamed(data.proposal.board, 'Primary Presidency', 'President');
    if (president.memberId === null) {
      throw new Error('Primary President is vacant');
    }
    const { props, rerender } = renderBoard(data, {
      onOpenPerson,
      initialScreen: { kind: 'organization', boardGroupId: primaryId },
    });
    expect(screen.queryByText('+ Proposed')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yara Fictional, President' }));
    expect(onOpenPerson).toHaveBeenCalledTimes(1);
    expect(onOpenPerson).toHaveBeenCalledWith(president.memberId, president.positionId);

    rerender(<PhoneBoard {...props} board={fillPrimarySecretary(data)} onOpenPerson={onOpenPerson} />);
    expect(screen.getByRole('button', { name: 'Ivy Notreal, Secretary' })).toBeInTheDocument();
    expect(screen.getByText('+ Proposed')).toBeInTheDocument();
  });

  it('unknown initial organization', () => {
    expect(() => {
      renderBoard(draftFixture(), { initialScreen: { kind: 'organization', boardGroupId: 'bg-missing' } });
    }).not.toThrow();
    expect(screen.getByText('Organization not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument();
  });

  it('empty organization screen', () => {
    const organization: PhoneOrganization = {
      boardGroupId: 'bg-empty',
      name: 'Empty Org',
      vacantLabel: '0 vacant',
      overseerText: 'Overseen by Bishop',
      sections: [],
    };
    render(
      <PhoneOrganizationScreen
        organization={organization}
        editable
        onBack={vi.fn()}
        onAddPosition={vi.fn()}
        onOpenPerson={vi.fn()}
        onOpenVacancy={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Empty Org' })).toBeInTheDocument();
    expect(screen.getByText('No positions in this organization.')).toBeInTheDocument();
  });

  it('empty list says there are no organizations', () => {
    const data = draftFixture();
    let board = data.proposal.board;
    const ctx = { ward: data.ward, ids: sequentialIds('t048-hide') };
    for (const group of Object.values(data.proposal.board.boardGroups)) {
      const result = setBoardGroupVisible(board, ctx, { boardGroupId: group.id, visible: false });
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }
      board = result.board;
    }
    renderBoard(data, { board });
    expect(screen.getByText('No organizations.')).toBeInTheDocument();
  });
});
