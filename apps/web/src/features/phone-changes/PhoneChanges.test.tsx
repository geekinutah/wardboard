import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneChangesModel } from './model.ts';
import { PhoneChanges } from './PhoneChanges.tsx';

describe('PhoneChanges component', () => {
  it('renders Removed from Current section, collapsible details, and disabled Accept button when blocked', () => {
    const blockedModel: PhoneChangesModel = {
      proposalName: 'Spring adjustments',
      status: 'draft',
      subtitle: 'Spring adjustments vs. its Jan 4 baseline · net only',
      removedItems: [
        {
          key: 'm-1',
          kind: 'member',
          headline: 'Flo Madeup',
          detail: 'Member removed · Music Coordinator here',
        },
        {
          key: 'p-1',
          kind: 'position',
          headline: 'Ward-wide Callings · Livestream Coordinator',
          detail: 'Position removed · held by Liv Example',
        },
      ],
      callings: [
        {
          key: 'c-1',
          who: 'Ivy Notreal',
          what: 'Relief Society · Relief Society Teacher',
        },
      ],
      releases: [
        {
          key: 'r-1',
          who: 'Ari Sample',
          what: 'Primary · Second Counselor',
        },
      ],
      positionChanges: [
        {
          key: 'pc-1',
          who: 'Added',
          what: 'Sunday School · Gospel Doctrine Teacher',
        },
      ],
      canAccept: false,
      acceptBlockReason: 'Resolve the 2 removed items to accept',
    };

    render(<PhoneChanges model={blockedModel} onAccept={vi.fn()} />);

    // Header
    expect(screen.getByRole('heading', { level: 1, name: 'Changes' })).toBeInTheDocument();
    expect(screen.getByText('Spring adjustments vs. its Jan 4 baseline · net only')).toBeInTheDocument();

    // Removed section
    expect(screen.getByRole('heading', { level: 2, name: 'Removed from Current · 2' })).toBeInTheDocument();
    expect(screen.getByText('Flo Madeup')).toBeInTheDocument();
    expect(screen.getByText('Member removed · Music Coordinator here')).toBeInTheDocument();
    expect(screen.getByText('REMOVED')).toBeInTheDocument();
    expect(screen.getByText('Ward-wide Callings · Livestream Coordinator')).toBeInTheDocument();
    expect(screen.getByText('Position removed · held by Liv Example')).toBeInTheDocument();
    expect(screen.getByText('POSITION REMOVED')).toBeInTheDocument();

    // Summaries with signs
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(screen.getByText('Suggested callings')).toBeInTheDocument();
    expect(screen.getByText('−')).toBeInTheDocument();
    expect(screen.getByText('Suggested releases')).toBeInTheDocument();
    expect(screen.getByText('±')).toBeInTheDocument();
    expect(screen.getByText('Position changes')).toBeInTheDocument();

    // Rows
    expect(screen.getByText('Ivy Notreal')).toBeInTheDocument();
    expect(screen.getByText('Relief Society · Relief Society Teacher')).toBeInTheDocument();

    // Accept button disabled and reason shown
    const acceptBtn = screen.getByRole('button', { name: 'Accept proposal' });
    expect(acceptBtn).toBeDisabled();
    expect(screen.getByText('Resolve the 2 removed items to accept')).toBeInTheDocument();
  });

  it('omits Removed section when empty and enables Accept proposal when eligible', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();

    const eligibleModel: PhoneChangesModel = {
      proposalName: 'Clean proposal',
      status: 'draft',
      subtitle: 'Clean proposal vs. its Jan 4 baseline · net only',
      removedItems: [],
      callings: [
        {
          key: 'c-1',
          who: 'Ivy Notreal',
          what: 'Relief Society · Relief Society Teacher',
        },
      ],
      releases: [],
      positionChanges: [],
      canAccept: true,
      acceptBlockReason: null,
    };

    render(<PhoneChanges model={eligibleModel} onAccept={onAccept} />);

    // Removed section should not be present
    expect(screen.queryByText(/Removed from Current/)).not.toBeInTheDocument();

    // Accept button enabled
    const acceptBtn = screen.getByRole('button', { name: 'Accept proposal' });
    expect(acceptBtn).toBeEnabled();
    expect(screen.queryByText(/Resolve|Approve/)).not.toBeInTheDocument();

    await user.click(acceptBtn);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('accepted status shows Accepted · read-only and Return to Draft button', async () => {
    const user = userEvent.setup();
    const onReopen = vi.fn();

    const acceptedModel: PhoneChangesModel = {
      proposalName: 'Spring adjustments',
      status: 'accepted',
      subtitle: 'Spring adjustments vs. its Jan 4 baseline · net only',
      removedItems: [],
      callings: [],
      releases: [],
      positionChanges: [],
      canAccept: false,
      acceptBlockReason: null,
    };

    render(<PhoneChanges model={acceptedModel} onAccept={vi.fn()} onReopen={onReopen} />);

    expect(screen.queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument();
    expect(screen.getByText('Accepted · read-only')).toBeInTheDocument();

    const returnBtn = screen.getByRole('button', { name: 'Return to Draft' });
    expect(returnBtn).toBeInTheDocument();

    await user.click(returnBtn);
    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it('null model on Current shows the baseline reference message', () => {
    render(<PhoneChanges model={null} onAccept={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Changes' })).toBeInTheDocument();
    expect(
      screen.getByText('Current is the baseline reference board and has no proposed changes.'),
    ).toBeInTheDocument();
  });

  it('renders None when a collapsible section has no rows', () => {
    const modelWithEmpty: PhoneChangesModel = {
      proposalName: 'Empty changes',
      status: 'draft',
      subtitle: 'Empty changes · net only',
      removedItems: [],
      callings: [],
      releases: [],
      positionChanges: [],
      canAccept: true,
      acceptBlockReason: null,
    };

    render(<PhoneChanges model={modelWithEmpty} onAccept={vi.fn()} />);

    // Three sections with None
    const noneElements = screen.getAllByText('None');
    expect(noneElements).toHaveLength(3);
  });

  it('controls default open state based on callings and releases counts', () => {
    // Case 1: callings > 0 -> callings open, releases closed
    const model1: PhoneChangesModel = {
      proposalName: 'Model 1',
      status: 'draft',
      subtitle: 'Model 1 · net only',
      removedItems: [],
      callings: [{ key: 'c1', who: 'A', what: 'B' }],
      releases: [{ key: 'r1', who: 'C', what: 'D' }],
      positionChanges: [],
      canAccept: true,
      acceptBlockReason: null,
    };

    const { unmount } = render(<PhoneChanges model={model1} onAccept={vi.fn()} />);
    const callingsDetails1 = screen.getByText('Suggested callings').closest('details');
    const releasesDetails1 = screen.getByText('Suggested releases').closest('details');
    const positionsDetails1 = screen.getByText('Position changes').closest('details');

    expect(callingsDetails1).toHaveAttribute('open');
    expect(releasesDetails1).not.toHaveAttribute('open');
    expect(positionsDetails1).not.toHaveAttribute('open');
    unmount();

    // Case 2: callings == 0, releases > 0 -> releases open
    const model2: PhoneChangesModel = {
      proposalName: 'Model 2',
      status: 'draft',
      subtitle: 'Model 2 · net only',
      removedItems: [],
      callings: [],
      releases: [{ key: 'r1', who: 'C', what: 'D' }],
      positionChanges: [],
      canAccept: true,
      acceptBlockReason: null,
    };

    render(<PhoneChanges model={model2} onAccept={vi.fn()} />);
    const callingsDetails2 = screen.getByText('Suggested callings').closest('details');
    const releasesDetails2 = screen.getByText('Suggested releases').closest('details');

    expect(callingsDetails2).not.toHaveAttribute('open');
    expect(releasesDetails2).toHaveAttribute('open');
  });
});
