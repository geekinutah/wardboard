import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  addAssignment,
  addCallingGroup,
  sequentialIds,
  type Board,
  type CallingGroupId,
  type OperationResult,
  type PositionId,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { GroupDetail, type GroupDetailProps } from './GroupDetail.tsx';

function required<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

function expectOk(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function groupIdNamed(board: Board, name: string): CallingGroupId {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`calling group ${name} not found`);
  }
  return found.id;
}

function renderGroup(name: string, overrides: Partial<GroupDetailProps> = {}) {
  const data = buildPreviewData();
  const board = overrides.board ?? data.proposal.board;
  const callingGroupId = overrides.callingGroupId ?? groupIdNamed(board, name);
  const onAddPosition = overrides.onAddPosition ?? vi.fn();
  const onAddGroup = overrides.onAddGroup ?? vi.fn();
  const props: GroupDetailProps = {
    board,
    ward: overrides.ward ?? data.ward,
    baseline: overrides.baseline === undefined ? data.proposal.baseline : overrides.baseline,
    callingGroupId,
    readOnly: overrides.readOnly ?? false,
    onAddPosition,
    onAddGroup,
  };
  const view = render(<GroupDetail {...props} />);
  return { ...view, data, props, onAddPosition, onAddGroup, callingGroupId };
}

describe('GroupDetail', () => {
  it('list renders as a list with filled of total and no numbering', () => {
    const { props } = renderGroup('Relief Society Teachers');
    const groupId = props.callingGroupId;
    const assignment = required(
      Object.values(props.board.assignments).find(
        (item) => item.groupId === groupId && item.title === 'Relief Society Teacher',
      ),
      'Relief Society Teacher missing',
    );
    const positions = Object.values(props.board.positions).filter((position) => position.assignmentId === assignment.id);
    const filled = positions.filter((position) => props.board.placements[position.id] !== undefined).length;

    expect(
      screen.getByRole('heading', { name: 'Relief Society · Relief Society Teachers', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText(`List · ${String(filled)} of ${String(positions.length)} filled`)).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Relief Society Teacher' });
    expect(list.textContent).not.toMatch(/#\d|\b\d+\./u);
    expect(list.tagName).toBe('UL');
    expect(list.querySelectorAll(':scope > li')).toHaveLength(positions.length);
  });

  it('vacancies say Vacant with the title', () => {
    renderGroup('Sunday School Presidency');
    const slot = screen.getByRole('article', { name: 'Vacant, First Counselor' });
    expect(within(slot).getByText('Vacant')).toBeInTheDocument();
    expect(within(slot).getByText('First Counselor')).toBeInTheDocument();
  });

  it('prefers and matches text render; nothing blocks', () => {
    const { props } = renderGroup('Primary Teachers');
    expect(screen.getByText('Prefers Teaches well')).toBeInTheDocument();

    const bea = required(
      Object.values(props.ward.members).find((member) => member.name === 'Bea Placeholder'),
      'Bea missing',
    );
    const cy = required(
      Object.values(props.ward.members).find((member) => member.name === 'Cy Mockup'),
      'Cy missing',
    );
    const beaCard = required(
      document.querySelector<HTMLElement>(`[data-member-id="${bea.id}"]`),
      'Bea card missing',
    );
    const cyCard = required(document.querySelector<HTMLElement>(`[data-member-id="${cy.id}"]`), 'Cy card missing');

    expect(beaCard.textContent).toContain('Matches preferred: Teaches well');
    expect(cyCard.textContent).not.toContain('Matches preferred');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/required|ineligible|blocked|does not match|warning/iu)).toBeNull();
  });

  it('add position single emits count 1 with trimmed title', async () => {
    const user = userEvent.setup();
    const { onAddPosition, callingGroupId } = renderGroup('Music');

    await user.click(screen.getByRole('button', { name: 'Add position to Music' }));
    expect(screen.queryByRole('spinbutton', { name: 'Positions' })).toBeNull();
    expect(
      screen.getByText('Adds 1 vacant position(s) to this proposal only. Current and other proposals are unchanged.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: /^\+$/u }));
    await user.click(screen.getByRole('radio', { name: 'Single person' }));
    expect(screen.queryByRole('spinbutton', { name: 'Positions' })).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), '  Pianist ');
    await user.click(screen.getByRole('button', { name: /^Add position$/u }));

    expect(onAddPosition).toHaveBeenCalledTimes(1);
    expect(onAddPosition).toHaveBeenCalledWith({
      groupId: callingGroupId,
      title: 'Pianist',
      type: 'single',
      positionCount: 1,
    });
    expect(screen.queryByRole('textbox', { name: 'Calling title' })).toBeNull();
  });

  it('add position list emits the chosen count; minus stops at 1 and plus at 50', async () => {
    const user = userEvent.setup();
    const { onAddPosition, callingGroupId } = renderGroup('Music');

    await user.click(screen.getByRole('button', { name: 'Add position to Music' }));
    await user.click(screen.getByRole('radio', { name: 'List' }));
    const count = screen.getByRole('spinbutton', { name: 'Positions' });
    expect(count).toHaveValue(2);
    expect(
      screen.getByText('Adds 2 vacant position(s) to this proposal only. Current and other proposals are unchanged.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^−$/u }));
    expect(count).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: /^−$/u }));
    expect(count).toHaveValue(1);

    fireEvent.change(count, { target: { value: '50' } });
    expect(count).toHaveValue(50);
    await user.click(screen.getByRole('button', { name: /^\+$/u }));
    expect(count).toHaveValue(50);

    fireEvent.change(count, { target: { value: '99' } });
    expect(count).toHaveValue(50);
    fireEvent.change(count, { target: { value: '0' } });
    expect(count).toHaveValue(1);

    fireEvent.change(count, { target: { value: '3' } });
    expect(count).toHaveValue(3);
    expect(
      screen.getByText('Adds 3 vacant position(s) to this proposal only. Current and other proposals are unchanged.'),
    ).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Advisers');
    await user.click(screen.getByRole('button', { name: /^Add position$/u }));

    expect(onAddPosition).toHaveBeenCalledTimes(1);
    expect(onAddPosition).toHaveBeenCalledWith({
      groupId: callingGroupId,
      title: 'Advisers',
      type: 'list',
      positionCount: 3,
    });
  });

  it('empty title shows an error and does not emit', async () => {
    const user = userEvent.setup();
    const { onAddPosition } = renderGroup('Music');

    await user.click(screen.getByRole('button', { name: 'Add position to Music' }));
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), '   ');
    await user.click(screen.getByRole('button', { name: /^Add position$/u }));

    expect(screen.getByText('Enter a calling title')).toBeInTheDocument();
    expect(onAddPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Calling title' })).toBeInTheDocument();
  });

  it('cancel closes and resets the form', async () => {
    const user = userEvent.setup();
    const { onAddPosition } = renderGroup('Music');

    await user.click(screen.getByRole('button', { name: 'Add position to Music' }));
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Organist');
    await user.click(screen.getByRole('radio', { name: 'List' }));
    await user.click(screen.getByRole('button', { name: /^\+$/u }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onAddPosition).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Calling title' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add position to Music' }));
    expect(screen.getByRole('textbox', { name: 'Calling title' })).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Single person' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.getByRole('spinbutton', { name: 'Positions' })).toHaveValue(2);
  });

  it('add group emits parent, trimmed name and kind', async () => {
    const user = userEvent.setup();
    const { onAddGroup, callingGroupId } = renderGroup('Music');

    await user.click(screen.getByRole('button', { name: 'Add group to Music' }));
    await user.click(screen.getByRole('button', { name: /^Add group$/u }));
    expect(screen.getByText('Enter a group name')).toBeInTheDocument();
    expect(onAddGroup).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Group name' }), '  Choir ');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'committee');
    await user.click(screen.getByRole('button', { name: /^Add group$/u }));

    expect(onAddGroup).toHaveBeenCalledTimes(1);
    expect(onAddGroup).toHaveBeenCalledWith({
      parent: { kind: 'callingGroup', id: callingGroupId },
      name: 'Choir',
      kind: 'committee',
    });
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull();
  });

  it('readOnly hides add controls', () => {
    renderGroup('Music', { readOnly: true });
    expect(screen.getByRole('heading', { name: 'Ward-wide Callings · Music' })).toBeInTheDocument();
    expect(screen.getByText('Flo Madeup')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add position/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add group/u })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('cards carry position and member ids', () => {
    const { props } = renderGroup('Gospel Doctrine');
    const wrappers = document.querySelectorAll<HTMLElement>('[data-position-id]');
    expect(wrappers.length).toBeGreaterThan(0);

    let occupied = 0;
    let vacant = 0;
    for (const wrapper of wrappers) {
      const positionId = wrapper.getAttribute('data-position-id');
      expect(positionId).toBeTruthy();
      const position = props.board.positions[positionId as PositionId];
      expect(position).toBeDefined();
      const memberId = positionId === null ? undefined : props.board.placements[positionId as PositionId];
      if (memberId === undefined) {
        vacant += 1;
        expect(wrapper.hasAttribute('data-member-id')).toBe(false);
      } else {
        occupied += 1;
        expect(wrapper.getAttribute('data-member-id')).toBe(memberId);
      }
    }
    expect(occupied).toBeGreaterThan(0);
    expect(vacant).toBeGreaterThan(0);
  });

  it('a group with no enabled assignments shows No positions yet and Add position', () => {
    const data = buildPreviewData();
    const primary = required(
      Object.values(data.proposal.board.boardGroups).find((group) => group.key === 'primary'),
      'Primary board group missing',
    );
    const board = expectOk(
      addCallingGroup(data.proposal.board, { ward: data.ward, ids: sequentialIds('empty') }, {
        parent: { kind: 'boardGroup', id: primary.id },
        name: 'Empty Class',
        kind: 'class',
      }),
    );

    renderGroup('Empty Class', { board });
    expect(screen.getByText('No positions yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add position to Empty Class' })).toBeInTheDocument();
  });

  it('a list with zero positions says 0 of 0 filled', () => {
    const data = buildPreviewData();
    const musicId = groupIdNamed(data.proposal.board, 'Music');
    const board = expectOk(
      addAssignment(data.proposal.board, { ward: data.ward, ids: sequentialIds('zero') }, {
        groupId: musicId,
        title: 'Future Teachers',
        type: 'list',
        positionCount: 0,
      }),
    );

    renderGroup('Music', { board });
    expect(screen.getByText('List · 0 of 0 filled')).toBeInTheDocument();
  });

  it('optional roles off are noted and not shown as vacancies', () => {
    const data = buildPreviewData();
    const organist = required(
      Object.values(data.proposal.board.assignments).find((assignment) => assignment.title === 'Organist'),
      'Organist missing',
    );
    const board: Board = {
      ...data.proposal.board,
      assignments: {
        ...data.proposal.board.assignments,
        [organist.id]: { ...organist, enabled: false },
      },
    };

    renderGroup('Music', { board });
    expect(screen.getByText('1 optional roles off · not counted as vacancies')).toBeInTheDocument();
    expect(screen.queryByText('Gus Demo')).toBeNull();
    expect(screen.queryByRole('article', { name: 'Vacant, Organist' })).toBeNull();
    expect(screen.getByText('Flo Madeup')).toBeInTheDocument();
  });

  it('nested sections get their own headings', () => {
    const data = buildPreviewData();
    const ctx = { ward: data.ward, ids: sequentialIds('nest') };
    const rootId = groupIdNamed(data.proposal.board, 'Gospel Doctrine');
    let board = expectOk(
      addCallingGroup(data.proposal.board, ctx, {
        parent: { kind: 'callingGroup', id: rootId },
        name: 'Class Committee',
        kind: 'committee',
      }),
    );
    const childId = groupIdNamed(board, 'Class Committee');
    board = expectOk(
      addCallingGroup(board, ctx, {
        parent: { kind: 'callingGroup', id: childId },
        name: 'Helpers',
        kind: 'other',
      }),
    );

    renderGroup('Gospel Doctrine', { board });
    expect(screen.getByRole('heading', { name: 'Gospel Doctrine', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Class Committee', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Helpers', level: 2 })).toBeInTheDocument();
  });
});
