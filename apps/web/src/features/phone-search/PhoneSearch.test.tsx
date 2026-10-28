import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  type AssignmentId,
  type Board,
  type CallingAssignment,
  type Member,
  type MemberId,
  type Position,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { PhoneSearch, type PhoneSearchTarget } from './PhoneSearch.tsx';

function testFixture() {
  const data = buildPreviewData({ steps: [] });
  const activeBoard = data.proposal.board;
  const allBoards = [data.proposal.board, data.current];
  return { ward: data.ward, activeBoard, allBoards, current: data.current };
}

describe('PhoneSearch', () => {
  it('empty query and no filters shows helper prompt', () => {
    const { ward, activeBoard, allBoards } = testFixture();
    render(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={true}
        onSelectResult={vi.fn()}
        onAddToDugout={vi.fn()}
      />,
    );

    expect(screen.getByText('Type a name, calling, or tag, or choose a filter.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Callings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Tags' })).not.toBeInTheDocument();
    expect(screen.queryByText("Note text isn't searched.")).not.toBeInTheDocument();
  });

  it('searching Ada lists Ada Fictional under People, omits removed members, and never searches notes', async () => {
    const user = userEvent.setup();
    const { ward, activeBoard, allBoards } = testFixture();

    // Create a modified ward with a removed member
    const removedMemberId = 'm-removed' as MemberId;
    const baseMember = Object.values(ward.members)[0];
    if (baseMember === undefined) throw new Error('missing member');
    const removedMember: Member = {
      ...baseMember,
      id: removedMemberId,
      name: 'Ada RemovedPerson',
      removedDate: '2026-01-01',
    };
    const wardWithRemoved: Ward = {
      ...ward,
      members: {
        ...ward.members,
        [removedMemberId]: removedMember,
      },
    };

    render(
      <PhoneSearch
        ward={wardWithRemoved}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={true}
        onSelectResult={vi.fn()}
        onAddToDugout={vi.fn()}
      />,
    );

    const input = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(input, 'Ada');

    expect(screen.getByRole('heading', { level: 2, name: 'People' })).toBeInTheDocument();
    expect(screen.getByText('Ada Fictional')).toBeInTheDocument();
    expect(screen.queryByText('Ada RemovedPerson')).not.toBeInTheDocument();
    expect(screen.getByText("Note text isn't searched.")).toBeInTheDocument();

    // Now test note body query: Jay Storybook has note "Travels for work most weekdays in March."
    await user.clear(input);
    await user.type(input, 'travels');

    expect(screen.getByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByText('Jay Storybook')).not.toBeInTheDocument();
  });

  it('+ Dugout button calls onAddToDugout without selecting the person, and In dugout shows for dugout members', async () => {
    const user = userEvent.setup();
    const { ward, activeBoard, allBoards } = testFixture();
    const onSelectResult = vi.fn<(target: PhoneSearchTarget) => void>();
    const onAddToDugout = vi.fn();

    const { rerender } = render(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={true}
        initialQuery="Ada"
        onSelectResult={onSelectResult}
        onAddToDugout={onAddToDugout}
      />,
    );

    // Ada Fictional is Bishop, not in dugout
    const addAdaBtn = screen.getByRole('button', { name: 'Add Ada Fictional to dugout' });
    expect(addAdaBtn).toBeInTheDocument();

    await user.click(addAdaBtn);
    expect(onAddToDugout).toHaveBeenCalledTimes(1);
    expect(onAddToDugout).toHaveBeenCalledWith(expect.any(String));
    expect(onSelectResult).not.toHaveBeenCalled();

    // Now test a member already in dugout: Jay Storybook
    const input = screen.getByRole('searchbox', { name: 'Search' });
    await user.clear(input);
    await user.type(input, 'Jay Storybook');

    expect(screen.getByText('Jay Storybook')).toBeInTheDocument();
    expect(screen.getByText('In dugout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Jay Storybook to dugout' })).not.toBeInTheDocument();

    // When editable={false}, + Dugout button is hidden
    await user.clear(input);
    await user.type(input, 'Ada');
    rerender(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={false}
        initialQuery="Ada"
        onSelectResult={onSelectResult}
        onAddToDugout={onAddToDugout}
      />,
    );

    expect(screen.getByText('Ada Fictional')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Ada Fictional to dugout' })).not.toBeInTheDocument();
  });

  it('scope toggle switches between This proposal and All', async () => {
    const user = userEvent.setup();
    const { ward, activeBoard, current } = testFixture();

    // Add a unique assignment only to current board
    const uniqueAssignmentId = 'a-unique-current' as AssignmentId;
    const uniquePositionId = 'p-unique-current' as PositionId;
    const baseAssignment = Object.values(current.assignments)[0];
    if (baseAssignment === undefined) throw new Error('missing assignment');
    const uniqueAssignment: CallingAssignment = {
      ...baseAssignment,
      id: uniqueAssignmentId,
      title: 'Secret Special Coordinator',
    };
    const basePosition = Object.values(current.positions)[0];
    if (basePosition === undefined) throw new Error('missing position');
    const uniquePosition: Position = {
      ...basePosition,
      id: uniquePositionId,
      assignmentId: uniqueAssignmentId,
    };
    const modifiedCurrent: Board = {
      ...current,
      assignments: {
        ...current.assignments,
        [uniqueAssignmentId]: uniqueAssignment,
      },
      positions: {
        ...current.positions,
        [uniquePositionId]: uniquePosition,
      },
    };

    render(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={[activeBoard, modifiedCurrent]}
        editable={true}
        initialQuery="Secret Special"
        onSelectResult={vi.fn()}
        onAddToDugout={vi.fn()}
      />,
    );

    // Active board is proposal, scope defaults to active ("This proposal")
    expect(screen.getByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByText('Secret Special Coordinator')).not.toBeInTheDocument();

    // Click "All" scope button
    const allBtn = screen.getByRole('button', { name: 'All' });
    expect(allBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(allBtn);

    expect(allBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Secret Special Coordinator')).toBeInTheDocument();

    // Click "This proposal" to switch back
    const thisProposalBtn = screen.getByRole('button', { name: /This proposal/ });
    await user.click(thisProposalBtn);

    expect(thisProposalBtn).toHaveAttribute('aria-pressed', 'true');
    expect(allBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('Vacant, No calling, Youth chips and tag rows filter results', async () => {
    const user = userEvent.setup();
    const { ward, activeBoard, allBoards } = testFixture();
    const onSelectResult = vi.fn<(target: PhoneSearchTarget) => void>();

    render(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={true}
        onSelectResult={onSelectResult}
        onAddToDugout={vi.fn()}
      />,
    );

    // Initially empty query: helper prompt
    expect(screen.getByText('Type a name, calling, or tag, or choose a filter.')).toBeInTheDocument();

    // Click Vacant chip
    const vacantBtn = screen.getByRole('button', { name: 'Vacant' });
    expect(vacantBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(vacantBtn);

    expect(vacantBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Callings' })).toBeInTheDocument();

    // Toggle Vacant off
    await user.click(vacantBtn);
    expect(vacantBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Type a name, calling, or tag, or choose a filter.')).toBeInTheDocument();

    // Search for a tag like "Musical"
    const input = screen.getByRole('searchbox', { name: 'Search' });
    await user.type(input, 'Musical');

    const tagRow = screen.getByRole('button', { name: /Musical/ });
    expect(tagRow).toBeInTheDocument();

    // Clicking tag row activates tag filter and calls onSelectResult
    await user.click(tagRow);
    const musicalTag = Object.values(ward.tags).find((t) => t.name === 'Musical');
    expect(onSelectResult).toHaveBeenCalledWith({ kind: 'tag', tagId: musicalTag?.id });

    // Active chip "Tag: Musical" should now be visible in filter bar
    const activeTagChip = screen.getByRole('button', { name: /Tag: Musical/ });
    expect(activeTagChip).toBeInTheDocument();
    expect(activeTagChip).toHaveAttribute('aria-pressed', 'true');

    // Clicking the active tag chip clears it
    await user.click(activeTagChip);
    expect(screen.queryByRole('button', { name: /Tag: Musical/ })).not.toBeInTheDocument();
  });

  it('navigates when clicking person or calling result', async () => {
    const user = userEvent.setup();
    const { ward, activeBoard, allBoards } = testFixture();
    const onSelectResult = vi.fn<(target: PhoneSearchTarget) => void>();

    render(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={true}
        initialQuery="Bishop"
        onSelectResult={onSelectResult}
        onAddToDugout={vi.fn()}
      />,
    );

    // Bishop should appear under Callings
    const callingBtn = screen.getByRole('button', { name: /Bishop\s+Bishopric/ });
    await user.click(callingBtn);
    const callingTarget = onSelectResult.mock.calls[0]?.[0];
    expect(callingTarget).toMatchObject({
      kind: 'calling',
      boardId: activeBoard.id,
    });

    // Clear and search for person Ada
    const input = screen.getByRole('searchbox', { name: 'Search' });
    await user.clear(input);
    await user.type(input, 'Ada Fictional');

    const personBtn = screen.getByRole('button', { name: /^Ada Fictional/ });
    await user.click(personBtn);
    const ada = Object.values(ward.members).find((m) => m.name === 'Ada Fictional');
    expect(onSelectResult).toHaveBeenCalledWith({
      kind: 'person',
      memberId: ada?.id,
    });
  });

  it('formats youth subtitle with Youth prefix and handles No calling', () => {
    const { ward, activeBoard, allBoards } = testFixture();

    render(
      <PhoneSearch
        ward={ward}
        activeBoard={activeBoard}
        allBoards={allBoards}
        editable={true}
        initialQuery="Tai Demo"
        onSelectResult={vi.fn()}
        onAddToDugout={vi.fn()}
      />,
    );

    // Tai Demo is a youth member with no callings
    expect(screen.getByText('Tai Demo')).toBeInTheDocument();
    expect(screen.getByText('Youth · No calling')).toBeInTheDocument();
  });
});
