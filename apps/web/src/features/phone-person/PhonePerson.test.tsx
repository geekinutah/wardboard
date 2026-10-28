import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PhonePersonSheetModel, PhoneVacantDestinationRow } from './model.ts';
import { PhoneMoveSheet } from './PhoneMoveSheet.tsx';
import { PhonePersonSheet } from './PhonePersonSheet.tsx';

const sampleJoModel: PhonePersonSheetModel = {
  memberId: 'm-jo',
  name: 'Jo Testwell',
  categoryLabel: 'Adult',
  tagNames: ['Teaches well'],
  needsApproval: false,
  externalCallings: [],
  callings: [
    {
      positionId: 'pos-rs',
      assignmentId: 'a-rs',
      title: 'Relief Society Teacher',
      orgLabel: 'Relief Society · Relief Society Teachers',
    },
    {
      positionId: 'pos-nursery',
      assignmentId: 'a-nursery',
      title: 'Nursery Leader',
      orgLabel: 'Primary · Nursery',
    },
  ],
  inExplicitDugout: false,
};

describe('PhonePersonSheet', () => {
  it('person sheet renders callings, Move and Release buttons when editable, and hides them when read-only', async () => {
    const user = userEvent.setup();
    const onStartMove = vi.fn();
    const onRelease = vi.fn();

    const { rerender } = render(
      <PhonePersonSheet
        model={sampleJoModel}
        boardName="Spring adjustments"
        editable={true}
        onStartMove={onStartMove}
        onRelease={onRelease}
        onAddToDugout={vi.fn()}
        onOpenProfile={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: /Jo Testwell/ })).toBeInTheDocument();
    expect(screen.getByText('Relief Society Teacher')).toBeInTheDocument();
    expect(screen.getByText('Nursery Leader')).toBeInTheDocument();

    const moveNursery = screen.getByRole('button', { name: 'Move from Nursery Leader' });
    const releaseNursery = screen.getByRole('button', { name: 'Release from Nursery Leader' });

    await user.click(moveNursery);
    expect(onStartMove).toHaveBeenCalledWith('pos-nursery');

    await user.click(releaseNursery);
    expect(onRelease).toHaveBeenCalledWith('pos-nursery');

    rerender(
      <PhonePersonSheet
        model={sampleJoModel}
        boardName="Spring adjustments"
        editable={false}
        onStartMove={onStartMove}
        onRelease={onRelease}
        onAddToDugout={vi.fn()}
        onOpenProfile={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Move from Nursery Leader' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release from Nursery Leader' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to dugout/ })).not.toBeInTheDocument();
  });

  it('Add to dugout and In dugout states', async () => {
    const user = userEvent.setup();
    const onAddToDugout = vi.fn();

    const { rerender } = render(
      <PhonePersonSheet
        model={sampleJoModel}
        boardName="Spring adjustments"
        editable={true}
        onStartMove={vi.fn()}
        onRelease={vi.fn()}
        onAddToDugout={onAddToDugout}
        onOpenProfile={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const addBtn = screen.getByRole('button', { name: /Add to dugout/ });
    await user.click(addBtn);
    expect(onAddToDugout).toHaveBeenCalledTimes(1);

    rerender(
      <PhonePersonSheet
        model={{ ...sampleJoModel, inExplicitDugout: true }}
        boardName="Spring adjustments"
        editable={true}
        onStartMove={vi.fn()}
        onRelease={vi.fn()}
        onAddToDugout={onAddToDugout}
        onOpenProfile={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Add to dugout/ })).not.toBeInTheDocument();
    expect(screen.getByText('In dugout')).toBeInTheDocument();
  });

  it('Close button and Escape close the person sheet', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <PhonePersonSheet
        model={sampleJoModel}
        boardName="Spring adjustments"
        editable={true}
        onStartMove={vi.fn()}
        onRelease={vi.fn()}
        onAddToDugout={vi.fn()}
        onOpenProfile={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders zero callings and Assign calling button', async () => {
    const user = userEvent.setup();
    const onPlaceFromDugout = vi.fn();

    render(
      <PhonePersonSheet
        model={{ ...sampleJoModel, callings: [] }}
        boardName="Spring adjustments"
        editable={true}
        onStartMove={vi.fn()}
        onRelease={vi.fn()}
        onAddToDugout={vi.fn()}
        onPlaceFromDugout={onPlaceFromDugout}
        onOpenProfile={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('No callings in this proposal.')).toBeInTheDocument();
    const assignBtn = screen.getByRole('button', { name: 'Assign calling…' });
    await user.click(assignBtn);
    expect(onPlaceFromDugout).toHaveBeenCalledTimes(1);
  });

  it('renders external callings, Needs approval badge, and profile button', async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();

    render(
      <PhonePersonSheet
        model={{
          ...sampleJoModel,
          needsApproval: true,
          externalCallings: [{ unit: 'Example Stake', title: 'Stake Family History Consultant' }],
        }}
        boardName="Spring adjustments"
        editable={true}
        onStartMove={vi.fn()}
        onRelease={vi.fn()}
        onAddToDugout={vi.fn()}
        onOpenProfile={onOpenProfile}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(screen.getByText('Outside the ward')).toBeInTheDocument();
    expect(screen.getByText('Example Stake · Stake Family History Consultant')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Profile, note & photo' }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneMoveSheet', () => {
  const sampleDestinations: readonly PhoneVacantDestinationRow[] = [
    {
      key: 'pos-sec',
      target: { kind: 'single', positionId: 'pos-sec' },
      title: 'Second Counselor',
      orgLabel: 'Primary · Primary Presidency',
      matchedTagNames: [],
    },
    {
      key: 'a-teacher',
      target: { kind: 'list', assignmentId: 'a-teacher' },
      title: 'Primary Teacher',
      orgLabel: 'Primary · Primary Teachers',
      matchedTagNames: ['Teaches well'],
    },
  ];

  it('move sheet shows source release subtitle, filters destinations, shows Matches badge, and selects a destination', async () => {
    const user = userEvent.setup();
    const onSelectDestination = vi.fn();
    const onQueryChange = vi.fn();

    render(
      <PhoneMoveSheet
        memberName="Jo Testwell"
        sourceCalling={{
          positionId: 'pos-nursery',
          title: 'Nursery Leader',
          orgLabel: 'Primary · Nursery',
        }}
        destinations={sampleDestinations}
        query=""
        onQueryChange={onQueryChange}
        onSelectDestination={onSelectDestination}
        onSendToDugout={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Move Jo Testwell' })).toBeInTheDocument();
    expect(
      screen.getByText('Releases from Primary · Nursery · Nursery Leader. Tap a destination.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Matches Teaches well')).toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', { name: 'Find a calling' });
    await user.type(searchInput, 'teacher');
    expect(onQueryChange).toHaveBeenCalled();

    const teacherBtn = screen.getByRole('button', { name: /Primary Teacher/ });
    await user.click(teacherBtn);
    expect(onSelectDestination).toHaveBeenCalledWith({ kind: 'list', assignmentId: 'a-teacher' });
  });

  it('move sheet Send to dugout and Cancel callbacks', async () => {
    const user = userEvent.setup();
    const onSendToDugout = vi.fn();
    const onCancel = vi.fn();

    const { rerender } = render(
      <PhoneMoveSheet
        memberName="Jo Testwell"
        sourceCalling={{
          positionId: 'pos-nursery',
          title: 'Nursery Leader',
          orgLabel: 'Primary · Nursery',
        }}
        destinations={sampleDestinations}
        query=""
        onQueryChange={vi.fn()}
        onSelectDestination={vi.fn()}
        onSendToDugout={onSendToDugout}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send to dugout' }));
    expect(onSendToDugout).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);

    rerender(
      <PhoneMoveSheet
        memberName="Jo Testwell"
        sourceCalling={null}
        destinations={sampleDestinations}
        query=""
        onQueryChange={vi.fn()}
        onSelectDestination={vi.fn()}
        onSendToDugout={onSendToDugout}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('Tap a vacant calling to place Jo Testwell.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to dugout' })).not.toBeInTheDocument();
  });

  it('displays empty message when destinations list is empty', () => {
    render(
      <PhoneMoveSheet
        memberName="Jo Testwell"
        sourceCalling={null}
        destinations={[]}
        query="xyz"
        onQueryChange={vi.fn()}
        onSelectDestination={vi.fn()}
        onSendToDugout={null}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('No matching vacant positions.')).toBeInTheDocument();
  });
});
