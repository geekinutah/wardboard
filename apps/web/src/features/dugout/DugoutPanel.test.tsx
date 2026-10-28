import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  addToDugout,
  boardId,
  createBoard,
  createWard,
  dugout,
  memberId,
  positionId,
  releaseCalling,
  sequentialIds,
  type Board,
  type Member,
  type MemberId,
  type OperationResult,
  type PositionId,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { DugoutPanel } from './DugoutPanel.tsx';

function expectOk(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function memberByName(ward: Ward, name: string): Member {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`member ${name} not found`);
  }
  return found;
}

function proposalBoard(current: Board, ward: Ward): Board {
  return buildFixtureProposal(current, ward).board;
}

function include(board: Board, ward: Ward, id: MemberId): Board {
  return expectOk(addToDugout(board, { ward, ids: sequentialIds('dugout') }, { memberId: id }));
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('article[data-member-id]')];
}

function rowFor(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`article[data-member-id="${id}"]`);
  if (row === null) {
    throw new Error(`row ${id} missing`);
  }
  return row;
}

function isLeadershipSeat(board: Board, id: PositionId): boolean {
  const position = board.positions[id];
  if (position === undefined) {
    return true;
  }
  const assignment = board.assignments[position.assignmentId];
  if (assignment === undefined) {
    return true;
  }
  return assignment.leadershipRole !== null;
}

/** Release non-presidency occupants until derived dugout membership is at least 7. */
function releaseUntilSeven(current: Board, ward: Ward): Board {
  let board = proposalBoard(current, ward);
  const ctx = { ward, ids: sequentialIds('show-more') };
  const seats = Object.entries(board.placements);
  for (const [rawPositionId, occupant] of seats) {
    if (dugout(board, ward).length >= 7) {
      return board;
    }
    const id = positionId(rawPositionId);
    if (isLeadershipSeat(board, id) || board.placements[id] !== occupant) {
      continue;
    }
    board = expectOk(releaseCalling(board, ctx, { memberId: occupant, positionId: id }));
  }
  if (dugout(board, ward).length < 7) {
    throw new Error(`dugout stopped at ${String(dugout(board, ward).length)}`);
  }
  return board;
}

describe('DugoutPanel', () => {
  it('lists automatic members with Adult or Youth and no Placed here line', () => {
    const { ward, current } = buildFixtureWard();
    render(<DugoutPanel board={current} ward={ward} />);

    const entries = dugout(current, ward);
    expect(rows().map((row) => row.getAttribute('data-member-id'))).toEqual(
      entries.map((entry) => entry.memberId),
    );

    for (const entry of entries) {
      const member = ward.members[entry.memberId];
      if (member === undefined) {
        throw new Error(`member ${entry.memberId} missing`);
      }
      const kind = member.category === 'adult' ? 'Adult' : 'Youth';
      const row = rowFor(entry.memberId);
      expect(row).toHaveTextContent(`${member.name} · ${kind}`);
      expect(row).not.toHaveTextContent('Placed here');
      for (const tagId of member.tagIds) {
        const tag = ward.tags[tagId];
        if (tag !== undefined) {
          expect(row).toHaveTextContent(tag.name);
        }
      }
    }

    expect(screen.getByRole('heading', { name: `Dugout · ${String(entries.length)}` })).toBeInTheDocument();
    expect(
      screen.getByText(
        'People with no calling in this proposal, plus anyone placed here on purpose. Not a measure of availability.',
      ),
    ).toBeInTheDocument();
  });

  it('explicit inclusion with a calling shows Placed here and the calling title', () => {
    const { ward, current } = buildFixtureWard();
    const ada = memberByName(ward, 'Ada Fictional');
    const board = include(proposalBoard(current, ward), ward, ada.id);
    render(<DugoutPanel board={board} ward={ward} />);

    expect(rowFor(ada.id)).toHaveTextContent('Placed here · still serves as Bishop');
  });

  it('explicit inclusion with no callings says Placed here only', () => {
    const { ward, current } = buildFixtureWard();
    const ivy = memberByName(ward, 'Ivy Notreal');
    const board = include(proposalBoard(current, ward), ward, ivy.id);
    render(<DugoutPanel board={board} ward={ward} />);

    const row = rowFor(ivy.id);
    expect(row).toHaveTextContent('Placed here');
    expect(row).not.toHaveTextContent('still serves');
  });

  it('All, Adults, Youth, and Weekday filter without changing the board', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const boardJson = JSON.stringify(current);
    const wardJson = JSON.stringify(ward);
    const tai = memberByName(ward, 'Tai Demo');
    const jay = memberByName(ward, 'Jay Storybook');
    const ivy = memberByName(ward, 'Ivy Notreal');
    const { rerender } = render(<DugoutPanel board={current} ward={ward} />);

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Adults' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Youth' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Weekday' })).toHaveAttribute('aria-pressed', 'false');
    expect(rowFor(tai.id)).toBeInTheDocument();
    expect(rowFor(ivy.id)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Youth' }));

    const category = screen.getByRole('group', { name: 'Category' });
    expect(within(category).getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Youth' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Adults' })).toHaveAttribute('aria-pressed', 'false');
    expect(rowFor(tai.id)).toHaveTextContent('Tai Demo · Youth');
    expect(document.querySelector(`article[data-member-id="${ivy.id}"]`)).toBeNull();
    expect(JSON.stringify(current)).toBe(boardJson);
    expect(JSON.stringify(ward)).toBe(wardJson);

    const youthRows = rows().map((row) => row.getAttribute('data-member-id'));
    rerender(<DugoutPanel board={current} ward={ward} />);
    expect(rows().map((row) => row.getAttribute('data-member-id'))).toEqual(youthRows);

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'Weekday' }));

    expect(screen.getByRole('button', { name: 'Weekday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(rows().map((row) => row.getAttribute('data-member-id'))).toEqual([jay.id]);
    expect(rowFor(jay.id)).toHaveTextContent('Jay Storybook · Adult');
    expect(JSON.stringify(current)).toBe(boardJson);
    expect(JSON.stringify(ward)).toBe(wardJson);
  });

  it('Youth and Weekday together show the empty-filter message', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    render(<DugoutPanel board={current} ward={ward} />);

    await user.click(screen.getByRole('button', { name: 'Youth' }));
    await user.click(screen.getByRole('button', { name: 'Weekday' }));

    expect(screen.getByText('No one matches this filter.')).toBeInTheDocument();
    expect(screen.queryByText('No one is in the dugout.')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Dugout · 0' })).toBeInTheDocument();
  });

  it('Show more reveals rows after the sixth and a filter collapses them', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const board = releaseUntilSeven(current, ward);
    const entries = dugout(board, ward);
    expect(entries.length).toBeGreaterThanOrEqual(7);
    const hidden = entries[6];
    if (hidden === undefined) {
      throw new Error('seventh dugout row missing');
    }

    render(<DugoutPanel board={board} ward={ward} />);

    expect(rows()).toHaveLength(6);
    expect(document.querySelector(`article[data-member-id="${hidden.memberId}"]`)).toBeNull();
    await user.click(screen.getByRole('button', { name: `Show ${String(entries.length - 6)} more` }));

    expect(rows()).toHaveLength(entries.length);
    expect(rowFor(hidden.memberId)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show \d+ more/u })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Youth' }));
    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(rows()).toHaveLength(6);
    expect(document.querySelector(`article[data-member-id="${hidden.memberId}"]`)).toBeNull();
    expect(screen.getByRole('button', { name: `Show ${String(entries.length - 6)} more` })).toBeInTheDocument();
  });

  it('removed-only ward shows No one is in the dugout', () => {
    const id = memberId('m-removed');
    const member: Member = {
      id,
      name: 'Remy Example',
      category: 'adult',
      photoRef: null,
      note: null,
      tagIds: [],
      needsApproval: false,
      removedDate: '2026-01-02',
      externalCallings: [],
    };
    const wardResult = createWard({ members: { [id]: member }, tags: {} });
    if (!wardResult.ok) {
      throw new Error(JSON.stringify(wardResult.errors));
    }
    const boardResult = createBoard(
      {
        id: boardId('b-empty'),
        kind: 'current',
        version: 0,
        boardGroups: {},
        callingGroups: {},
        assignments: {},
        positions: {},
        placements: {},
        oversight: [],
        dugoutInclusions: [],
        approvals: [],
      },
      wardResult.value,
    );
    if (!boardResult.ok) {
      throw new Error(JSON.stringify(boardResult.errors));
    }

    render(<DugoutPanel board={boardResult.value} ward={wardResult.value} />);

    expect(screen.getByText('No one is in the dugout.')).toBeInTheDocument();
    expect(screen.queryByText('Remy Example')).not.toBeInTheDocument();
    expect(screen.queryByText('No one matches this filter.')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(0);
  });

  it('aside is labelled Dugout and marked data-drop-target', () => {
    const { ward, current } = buildFixtureWard();
    render(<DugoutPanel board={current} ward={ward} />);

    const aside = screen.getByRole('complementary', { name: 'Dugout' });
    expect(aside).toHaveAttribute('data-drop-target', 'dugout');
  });

  it('Needs approval is text', () => {
    const { ward, current } = buildFixtureWard();
    const cy = memberByName(ward, 'Cy Mockup');
    expect(cy.needsApproval).toBe(true);
    const board = include(proposalBoard(current, ward), ward, cy.id);
    render(<DugoutPanel board={board} ward={ward} />);

    expect(within(rowFor(cy.id)).getByText('Needs approval')).toBeInTheDocument();
  });
});
