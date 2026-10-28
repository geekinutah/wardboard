import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assignmentId, type Board } from '@wardboard/core';
import { describe, expect, it, vi } from 'vitest';
import { okResult, refusal, tagsScenario } from './fixtures.ts';
import { CallingTagsEditor, type CallingTagsEditorProps } from './CallingTagsEditor.tsx';

function setup(overrides: Partial<CallingTagsEditorProps> = {}, board?: Board) {
  const s = tagsScenario();
  const props: CallingTagsEditorProps = {
    board: board ?? s.proposal.board,
    ward: s.ward,
    assignmentId: s.listAssignment,
    proposalName: 'Spring adjustments',
    dugoutMemberIds: [s.members.dee, s.members.cid, s.members.ann],
    onSetCallingTags: vi.fn(() => okResult()),
    onSetPreferences: vi.fn(() => okResult()),
    onHighlight: vi.fn(),
    ...overrides,
  };
  render(<CallingTagsEditor {...props} />);
  return { s, props, user: userEvent.setup() };
}

describe('CallingTagsEditor', () => {
  it('shows the editable header, subtitle, sections, help and footer', () => {
    setup();
    expect(screen.getByText('CALLING · THIS PROPOSAL ONLY')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Deacons Quorum Adviser' })).toBeInTheDocument();
    expect(screen.getByText('Aaronic Priesthood · list · 1 of 3 filled')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Calling tags' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prefers members tagged' })).toBeInTheDocument();
    expect(screen.getByText('Describe the calling itself.')).toBeInTheDocument();
    expect(
      screen.getByText('Preferences, not requirements — a missing tag never blocks a placement.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Changes apply to/)).toHaveTextContent(
      'Changes apply to Spring adjustments. Current and other proposals keep their own calling tags.',
    );
  });

  it('single assignment subtitle has no filled count', () => {
    const s = tagsScenario();
    setup({ assignmentId: s.singleAssignment });
    expect(screen.getByText('Aaronic Priesthood · single')).toBeInTheDocument();
  });

  it('adds and removes calling tags and preferences via the right callback', async () => {
    const { s, props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove calling tag Outdoors' }));
    expect(props.onSetCallingTags).toHaveBeenCalledWith([]);
    expect(props.onSetPreferences).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove preference Weekday' }));
    expect(props.onSetPreferences).toHaveBeenCalledWith([s.tags.pianist]);
    expect(props.onSetCallingTags).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '+ Tag' }));
    await user.click(screen.getByRole('option', { name: /Evenings only/ }));
    expect(props.onSetCallingTags).toHaveBeenLastCalledWith([s.tags.outdoors, s.tags.evenings]);

    await user.click(screen.getByRole('button', { name: '+ Preference' }));
    await user.click(screen.getByRole('option', { name: /Outdoors/ }));
    expect(props.onSetPreferences).toHaveBeenLastCalledWith([s.tags.weekday, s.tags.pianist, s.tags.outdoors]);
  });

  it('pickers offer no create option', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Tag' }));
    await user.keyboard('zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('shows dugout match count and Highlight passes the matches', async () => {
    const { s, props, user } = setup();
    expect(screen.getByText('2 people in the dugout match a preference')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(props.onHighlight).toHaveBeenCalledWith([s.members.cid, s.members.ann]);
  });

  it('uses the singular for one match', () => {
    const s = tagsScenario();
    setup({ dugoutMemberIds: [s.members.dee, s.members.cid] });
    expect(screen.getByText('1 person in the dugout match a preference')).toBeInTheDocument();
  });

  it('renders no match line when the dugout has no matches', () => {
    const s = tagsScenario();
    setup({ dugoutMemberIds: [s.members.dee] });
    expect(screen.queryByText(/in the dugout match/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Highlight' })).not.toBeInTheDocument();
  });

  it('read-only on Current: chips, no controls, no footer', () => {
    const s = tagsScenario();
    // Current with the proposal's tags, so the chips have something to show.
    setup({ proposalName: null }, { ...s.proposal.board, kind: 'current' });
    expect(screen.getByText('CALLING')).toBeInTheDocument();
    expect(screen.getByText('Outdoors')).toBeInTheDocument();
    expect(screen.getByText('Weekday')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Tag' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Preference' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Changes apply to/)).not.toBeInTheDocument();
  });

  it('is read-only on a proposal board when no proposal name is given', () => {
    setup({ proposalName: null });
    expect(screen.queryByRole('button', { name: '+ Tag' })).not.toBeInTheDocument();
  });

  it('is read-only when the board is not a proposal even with a name', () => {
    const s = tagsScenario();
    setup({ proposalName: 'Spring adjustments' }, { ...s.proposal.board, kind: 'baseline' });
    expect(screen.queryByRole('button', { name: '+ Tag' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Changes apply to/)).not.toBeInTheDocument();
  });

  it('unknown assignment renders Calling not found.', () => {
    setup({ assignmentId: assignmentId('nope') });
    expect(screen.getByText('Calling not found.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('refusal shows the message and keeps the chips', async () => {
    const { user } = setup({
      onSetPreferences: vi.fn(() =>
        refusal('board_not_editable', 'Board is locked.'),
      ),
    });
    await user.click(screen.getByRole('button', { name: 'Remove preference Weekday' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Board is locked.');
    expect(screen.getByRole('button', { name: 'Remove preference Weekday' })).toBeInTheDocument();
  });
});
