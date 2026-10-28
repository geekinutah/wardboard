import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  addToDugout,
  sequentialIds,
  type Board,
  type OperationContext,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { PhoneDugout } from './PhoneDugout.tsx';

function testDugoutFixture() {
  const data = buildPreviewData({ steps: [] });
  const ward = data.ward;
  const ctx: OperationContext = { ward, ids: sequentialIds('dugout-test') };

  const jo = Object.values(ward.members).find((m) => m.name === 'Jo Testwell');
  const cy = Object.values(ward.members).find((m) => m.name === 'Cy Mockup');
  if (jo === undefined || cy === undefined) throw new Error('missing fixture members');

  // Add Jo Testwell and Cy Mockup to dugout explicitly
  const withJo = addToDugout(data.proposal.board, ctx, { memberId: jo.id });
  if (!withJo.ok) throw new Error('failed to add Jo to dugout');
  const withBoth = addToDugout(withJo.board, ctx, { memberId: cy.id });
  if (!withBoth.ok) throw new Error('failed to add Cy to dugout');

  return { ward, board: withBoth.board, joId: jo.id, cyId: cy.id };
}

describe('PhoneDugout', () => {
  it('dugout lists automatic and explicit members with Adult/Youth, tags, Needs approval, and remaining callings', () => {
    const { ward, board } = testDugoutFixture();
    render(
      <PhoneDugout
        board={board}
        ward={ward}
        editable={true}
        onPlaceMember={vi.fn()}
      />,
    );

    // Jay Storybook is an automatic dugout member with tag 'Weekday availability' and category adult
    const jayRow = screen.getByRole('button', { name: 'Place Jay Storybook' });
    expect(jayRow).toHaveTextContent(/Jay Storybook/);
    expect(jayRow).toHaveTextContent(/· Adult/);
    expect(jayRow).toHaveTextContent(/Weekday availability/);

    // Jo Testwell is an explicit inclusion who still has callings
    const joRow = screen.getByRole('button', { name: 'Place Jo Testwell' });
    expect(joRow).toHaveTextContent(/Jo Testwell/);
    expect(joRow).toHaveTextContent(/Placed here · still/);

    // Cy Mockup has needsApproval: true
    const cyRow = screen.getByRole('button', { name: 'Place Cy Mockup' });
    expect(cyRow).toHaveTextContent(/Cy Mockup/);
    expect(cyRow).toHaveTextContent(/Needs approval/);

    // Explanation subtitle
    expect(
      screen.getByText('No calling in this proposal, or placed here on purpose. Not a measure of availability.'),
    ).toBeInTheDocument();
  });

  it('All, Adults, Youth, Weekday, and Teaching chips filter without mutating the board', async () => {
    const user = userEvent.setup();
    const { ward, board } = testDugoutFixture();
    const boardSnapshot = JSON.parse(JSON.stringify(board)) as Board;

    render(
      <PhoneDugout
        board={board}
        ward={ward}
        editable={true}
        onPlaceMember={vi.fn()}
      />,
    );

    // Initial state: All is active
    const allChip = screen.getByRole('button', { name: /All/ });
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Jay Storybook/)).toBeInTheDocument();
    expect(screen.getByText(/Tai Demo/)).toBeInTheDocument();

    // Click Youth chip
    const youthChip = screen.getByRole('button', { name: /Youth/ });
    await user.click(youthChip);

    expect(youthChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Tai Demo/)).toBeInTheDocument();
    expect(screen.queryByText(/Jay Storybook/)).not.toBeInTheDocument();

    // Switch to Adults
    const adultsChip = screen.getByRole('button', { name: /Adults/ });
    await user.click(adultsChip);
    expect(adultsChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Jay Storybook/)).toBeInTheDocument();
    expect(screen.queryByText(/Tai Demo/)).not.toBeInTheDocument();

    // Switch back to All, then test Weekday tag filter
    await user.click(allChip);
    const weekdayChip = screen.getByRole('button', { name: /Weekday/ });
    await user.click(weekdayChip);

    expect(weekdayChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Jay Storybook/)).toBeInTheDocument();
    expect(screen.queryByText(/Tai Demo/)).not.toBeInTheDocument();

    // Now active Youth category while Weekday is also active (Youth + Weekday)
    await user.click(youthChip);
    // Tai Demo doesn't have Weekday tag, so no one matches both Youth and Weekday
    expect(screen.getByText('No one matches this filter.')).toBeInTheDocument();

    // Verify board is unchanged
    expect(board).toEqual(boardSnapshot);
  });

  it('Place button calls onPlaceMember when editable and is hidden when read-only', async () => {
    const user = userEvent.setup();
    const { ward, board } = testDugoutFixture();
    const onPlaceMember = vi.fn();

    const jay = Object.values(ward.members).find((m) => m.name === 'Jay Storybook');
    if (jay === undefined) throw new Error('missing Jay Storybook');

    const { rerender } = render(
      <PhoneDugout
        board={board}
        ward={ward}
        editable={true}
        onPlaceMember={onPlaceMember}
      />,
    );

    const placeJayBtn = screen.getByRole('button', { name: `Place ${jay.name}` });
    expect(placeJayBtn).toBeInTheDocument();

    await user.click(placeJayBtn);
    expect(onPlaceMember).toHaveBeenCalledTimes(1);
    expect(onPlaceMember).toHaveBeenCalledWith(jay.id);

    // When editable={false}, no Place button exists
    rerender(
      <PhoneDugout
        board={board}
        ward={ward}
        editable={false}
        onPlaceMember={onPlaceMember}
      />,
    );

    expect(screen.queryByRole('button', { name: `Place ${jay.name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place/ })).not.toBeInTheDocument();
  });

  it('handles empty dugout and explicit member with no callings', () => {
    const data = buildPreviewData({ steps: [] });
    // In empty dugout:
    const emptyWard: Ward = {
      ...data.ward,
      members: {},
    };

    const { rerender } = render(
      <PhoneDugout
        board={data.proposal.board}
        ward={emptyWard}
        editable={true}
        onPlaceMember={vi.fn()}
      />,
    );

    expect(screen.getByText('No one is in the dugout.')).toBeInTheDocument();

    // Now test explicit member with NO callings:
    // Create a board where Jay Storybook is explicitly in dugoutInclusions
    const jay = Object.values(data.ward.members).find((m) => m.name === 'Jay Storybook');
    if (jay === undefined) throw new Error('missing Jay Storybook');
    const boardWithExplicitJay: Board = {
      ...data.proposal.board,
      dugoutInclusions: [...data.proposal.board.dugoutInclusions, jay.id],
    };

    rerender(
      <PhoneDugout
        board={boardWithExplicitJay}
        ward={data.ward}
        editable={true}
        onPlaceMember={vi.fn()}
      />,
    );

    const jayRow = screen.getByRole('button', { name: `Place ${jay.name}` });
    expect(jayRow).toHaveTextContent(/Placed here · Weekday availability/);
  });
});
