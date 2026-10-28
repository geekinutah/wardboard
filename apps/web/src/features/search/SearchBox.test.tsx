import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  addAssignment,
  addToDugout,
  createBoard,
  createWard,
  filterMatches,
  memberId,
  search,
  sequentialIds,
  type Board,
  type CallingGroupId,
  type MemberId,
  type OperationResult,
  type TagId,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { SearchBox, type SearchBoxProps } from './SearchBox.tsx';

function required<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  return required(found, `no fixture member named ${name}`).id;
}

function tagNamed(ward: Ward, name: string): TagId {
  const found = Object.values(ward.tags).find((tag) => tag.name === name);
  return required(found, `no tag ${name}`).id;
}

function callingGroupIdNamed(board: Board, name: string): CallingGroupId {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  return required(found, `no calling group ${name}`).id;
}

function boardFromOp(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function boardFrom(result: { ok: true; value: Board } | { ok: false; errors: readonly { message: string }[] }): Board {
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join('; '));
  }
  return result.value;
}

function wardFrom(result: { ok: true; value: Ward } | { ok: false; errors: readonly { message: string }[] }): Ward {
  if (!result.ok) {
    throw new Error(result.errors.map((error) => error.message).join('; '));
  }
  return result.value;
}

function renderSearch(overrides: Partial<SearchBoxProps> = {}) {
  const { ward, current } = buildFixtureWard();
  const proposal = buildFixtureProposal(current, ward);
  const onNavigate = overrides.onNavigate ?? vi.fn();
  const onAddToDugout = overrides.onAddToDugout ?? vi.fn();
  const onHighlight = overrides.onHighlight ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const props: SearchBoxProps = {
    ward: overrides.ward ?? ward,
    active: overrides.active ?? proposal.board,
    boards: overrides.boards ?? [proposal.board, current],
    readOnly: overrides.readOnly ?? false,
    onNavigate,
    onAddToDugout,
    onHighlight,
    onClose,
  };
  const view = render(<SearchBox {...props} />);
  return { ...view, props, ward, current, proposal, onNavigate, onAddToDugout, onHighlight, onClose };
}

function searchbox(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search people, callings, tags' });
}

function optionAt(index: number): HTMLElement {
  const option = screen.getAllByRole('option')[index];
  if (option === undefined) {
    throw new Error(`missing option ${String(index)}`);
  }
  return option;
}

describe('SearchBox', () => {
  it('empty query and no filters leaves the listbox closed', async () => {
    const user = userEvent.setup();
    const { props, onHighlight } = renderSearch();

    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
    expect(screen.queryByText('Esc to close')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('Filters highlight matches on the board; they never change placements.')).toBeInTheDocument();
    expect(onHighlight).toHaveBeenCalledWith(filterMatches(props.active, props.ward, {}));

    await user.type(searchbox(), '   ');
    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
  });

  it('typing Ada lists Ada Fictional under People and omits a removed member', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const gone = memberId('m-ada-gone');
    const removedWard = wardFrom(
      createWard({
        tags: ward.tags,
        members: {
          ...ward.members,
          [gone]: {
            id: gone,
            name: 'Ada Gone',
            category: 'adult',
            photoRef: null,
            note: null,
            tagIds: [],
            needsApproval: false,
            removedDate: '2026-04-01',
            externalCallings: [],
          },
        },
      }),
    );

    renderSearch({ ward: removedWard, active: proposal.board, boards: [proposal.board, current] });
    await user.type(searchbox(), 'Ada');

    const people = screen.getByRole('heading', { name: 'People' }).closest('section');
    if (!(people instanceof HTMLElement)) {
      throw new Error('People section missing');
    }
    expect(within(people).getByRole('option', { name: /Ada Fictional/ })).toBeInTheDocument();
    expect(within(people).getByRole('option', { name: /Ada Fictional/ })).toHaveTextContent('Adult');
    expect(screen.queryByText('Ada Gone')).not.toBeInTheDocument();
    expect(screen.getByText('Esc to close')).toBeInTheDocument();
  });

  it('a note query shows No matches', async () => {
    const user = userEvent.setup();
    renderSearch();
    await user.type(searchbox(), 'travels');

    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.queryByText('Jay Storybook')).not.toBeInTheDocument();
    expect(screen.getByText(/note text isn't searched/)).toBeInTheDocument();
    expect(screen.getByText('0 results')).toBeInTheDocument();
  });

  it('Vacant positions lists a vacant calling and does not change the board', async () => {
    const user = userEvent.setup();
    const { props, onHighlight } = renderSearch();
    const boardBefore = JSON.stringify(props.active);
    const wardBefore = JSON.stringify(props.ward);
    const chorister = required(
      Object.values(props.active.assignments).find((assignment) => assignment.title === 'Chorister'),
      'Chorister missing',
    );
    const position = required(
      Object.values(props.active.positions).find(
        (item) => item.assignmentId === chorister.id && props.active.placements[item.id] === undefined,
      ),
      'Chorister vacancy missing',
    );

    await user.click(screen.getByRole('button', { name: 'Vacant positions' }));

    const row = screen.getByRole('option', { name: /Chorister/ });
    expect(row).toHaveTextContent('Vacant');
    expect(row).toHaveTextContent('Ward-wide Callings · Music');
    expect(JSON.stringify(props.active)).toBe(boardBefore);
    expect(JSON.stringify(props.ward)).toBe(wardBefore);
    const expected = filterMatches(props.active, props.ward, { vacant: true });
    expect(expected.positionIds).toContain(position.id);
    expect(onHighlight).toHaveBeenCalledWith(expected);
    const chip = screen.getByRole('button', { name: /Vacant positions/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveTextContent('✓');
    expect(chip).toHaveStyle({ fontWeight: '700' });
  });

  it('Youth and Adults are exclusive, and a tag chip requires that tag', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Tag: Musical' }));
    await user.click(screen.getByRole('button', { name: 'Adults' }));

    expect(screen.getByRole('button', { name: /Tag: Musical/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Adults/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Youth' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('option', { name: /Flo Madeup/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Gus Demo/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ivy Notreal/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Tai Demo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ada Fictional/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Youth' }));

    expect(screen.getByRole('button', { name: /Youth/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Adults' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Tag: Musical/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('option', { name: /Tai Demo/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Flo Madeup/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Youth/ })).toHaveStyle({ fontWeight: '700' });
    expect(screen.getByRole('button', { name: /^Adults$/ })).toHaveStyle({ fontWeight: '400' });
  });

  it('This proposal searches only the active board; All proposals & Current includes Current', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const ctx = { ward, ids: sequentialIds('scope') };
    const musicId = callingGroupIdNamed(current, 'Music');
    const editableCurrent = boardFrom(createBoard({ ...current, kind: 'proposal' }, ward));
    const currentWithCalling = boardFrom(
      createBoard(
        {
          ...boardFromOp(
            addAssignment(editableCurrent, ctx, {
              groupId: musicId,
              title: 'Zebra Current Harp',
              type: 'single',
              positionCount: 1,
            }),
          ),
          id: current.id,
          kind: 'current',
        },
        ward,
      ),
    );
    const proposalWithCalling = boardFromOp(
      addAssignment(proposal.board, ctx, {
        groupId: musicId,
        title: 'Zebra Proposal Bell',
        type: 'single',
        positionCount: 1,
      }),
    );

    renderSearch({
      ward,
      active: proposalWithCalling,
      boards: [proposalWithCalling, currentWithCalling],
    });
    await user.type(searchbox(), 'Zebra');

    expect(screen.getByRole('option', { name: /Zebra Proposal Bell/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Zebra Current Harp/ })).not.toBeInTheDocument();
    const narrow = screen.getByRole('button', { name: 'This proposal' });
    const wide = screen.getByRole('button', { name: 'All proposals & Current' });
    expect(narrow).toHaveAttribute('aria-pressed', 'true');
    expect(wide).toHaveAttribute('aria-pressed', 'false');

    await user.click(wide);

    expect(narrow).toHaveAttribute('aria-pressed', 'false');
    expect(wide).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('option', { name: /Zebra Proposal Bell/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Zebra Current Harp/ })).toBeInTheDocument();
  });

  it('Add to dugout emits the member id and does not navigate or warn', async () => {
    const user = userEvent.setup();
    const { ward, onNavigate, onAddToDugout } = renderSearch();
    const ada = memberNamed(ward, 'Ada Fictional');

    await user.type(searchbox(), 'Ada');
    const option = screen.getByRole('option', { name: /Ada Fictional/ });
    expect(option).toHaveTextContent('Bishop');
    expect(option).not.toHaveTextContent('No calling');
    await user.click(within(option).getByRole('button', { name: 'Add to dugout' }));

    expect(onAddToDugout).toHaveBeenCalledTimes(1);
    expect(onAddToDugout).toHaveBeenCalledWith({ memberId: ada });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/warning/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
  });

  it('Add to dugout is hidden when the member is already explicitly included or readOnly', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    const proposal = buildFixtureProposal(current, ward);
    const ada = memberNamed(ward, 'Ada Fictional');
    const included = boardFromOp(
      addToDugout(proposal.board, { ward, ids: sequentialIds('dugout') }, { memberId: ada }),
    );

    const readOnly = renderSearch({ ward, active: proposal.board, boards: [proposal.board, current], readOnly: true });
    await user.type(searchbox(), 'Ada');
    expect(screen.getByRole('option', { name: /Ada Fictional/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).not.toBeInTheDocument();
    readOnly.unmount();

    renderSearch({ ward, active: included, boards: [included, current], readOnly: false });
    await user.type(searchbox(), 'Ada');
    expect(screen.getByRole('option', { name: /Ada Fictional/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).not.toBeInTheDocument();
  });

  it('arrow keys move the selected option and Enter navigates', async () => {
    const user = userEvent.setup();
    const { ward, onNavigate } = renderSearch();
    const kit = memberNamed(ward, 'Kit Notreal');

    await user.type(searchbox(), 'notreal');
    expect(optionAt(0)).toHaveTextContent('Ivy Notreal');
    expect(optionAt(1)).toHaveTextContent('Kit Notreal');
    expect(optionAt(2)).toHaveTextContent('Wren Notreal');
    expect(optionAt(0)).toHaveAttribute('aria-selected', 'true');
    expect(optionAt(1)).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}');
    expect(optionAt(0)).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(optionAt(1)).toHaveAttribute('aria-selected', 'true');
    expect(optionAt(0)).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}');
    expect(optionAt(2)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(optionAt(2)).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    expect(optionAt(1)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'person', memberId: kit });
  });

  it('Escape closes the list and calls onClose, leaving the query', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSearch();

    await user.type(searchbox(), 'Ada');
    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByText('Esc to close')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.queryByText('Esc to close')).not.toBeInTheDocument();
    expect(searchbox()).toHaveValue('Ada');
  });

  it('a tag row presses its chip', async () => {
    const user = userEvent.setup();
    const { props, onNavigate } = renderSearch();
    const musical = tagNamed(props.ward, 'Musical');
    const found = search({ query: 'music', boards: [props.active] }, props.ward);
    const tag = required(
      found.tags.find((item) => item.name === 'Musical'),
      'Musical tag result missing',
    );
    const group = required(
      found.groups.find((item) => item.name === 'Music'),
      'Music group result missing',
    );

    await user.type(searchbox(), 'music');
    const tagRow = screen.getByRole('option', {
      name: new RegExp(`Tag · ${String(tag.memberIds.length)} people · select to highlight`),
    });
    expect(tagRow).toHaveTextContent('Musical');
    const coordinator = screen.getByRole('option', { name: /^Music Coordinator/ });
    expect(coordinator).toHaveTextContent('Ward-wide Callings · Music');
    expect(coordinator).toHaveTextContent('Flo Madeup');
    expect(coordinator).not.toHaveTextContent('Vacant');
    expect(
      screen.getByRole('option', {
        name: new RegExp(`Group · ${String(group.positionCount)} positions, ${String(group.vacantCount)} vacant`),
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tag: Musical' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(tagRow);

    const chip = screen.getByRole('button', { name: /Tag: Musical/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveTextContent('✓');
    expect(chip).toHaveStyle({ fontWeight: '700' });
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'tag', tagId: musical });
  });

  it('In dugout shows for a dugout member, with No calling when they have none', async () => {
    const user = userEvent.setup();
    const { ward, current } = buildFixtureWard();
    renderSearch({ ward, active: current, boards: [current] });
    await user.type(searchbox(), 'Jay Storybook');

    const option = screen.getByRole('option', { name: /Jay Storybook/ });
    expect(option).toHaveTextContent('In dugout');
    expect(option).toHaveTextContent('No calling');
    expect(option).toHaveTextContent('Adult');
    expect(screen.getByRole('button', { name: 'Current' })).toHaveAttribute('aria-pressed', 'true');
  });
});
