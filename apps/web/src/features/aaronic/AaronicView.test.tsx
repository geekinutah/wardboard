import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  overseerOf,
  placeInPosition,
  sequentialIds,
  type Board,
  type BoardGroupId,
  type CallingGroup,
  type CallingGroupId,
  type MemberId,
  type OperationResult,
  type PositionId,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { AaronicView, type AaronicViewProps } from './AaronicView.tsx';

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function expectOk(result: OperationResult): Board {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.board;
}

function boardGroupByKey(board: Board, key: string): BoardGroupId {
  const found = Object.values(board.boardGroups).find((group) => group.key === key);
  if (found === undefined) throw new Error(`board group ${key} not found`);
  return found.id;
}

function callingGroupByKey(board: Board, key: string): CallingGroup {
  const found = Object.values(board.callingGroups).find((group) => group.key === key);
  if (found === undefined) throw new Error(`calling group ${key} not found`);
  return found;
}

function groupCounts(board: Board, groupId: CallingGroupId): { filled: number; vacant: number } {
  const assignmentIds = new Set(
    Object.values(board.assignments)
      .filter((assignment) => assignment.groupId === groupId && assignment.enabled)
      .map((assignment) => assignment.id),
  );
  let filled = 0;
  let vacant = 0;
  for (const position of Object.values(board.positions)) {
    if (!assignmentIds.has(position.assignmentId)) continue;
    if (Object.hasOwn(board.placements, position.id)) filled += 1;
    else vacant += 1;
  }
  return { filled, vacant };
}

function bishopPositionId(board: Board): PositionId {
  const bishopric = Object.values(board.callingGroups).find((group) => group.kind === 'bishopric');
  const group = required(bishopric, 'bishopric group missing');
  const assignment = Object.values(board.assignments).find(
    (item) => item.groupId === group.id && item.title === 'Bishop',
  );
  const bishop = required(assignment, 'Bishop assignment missing');
  const position = Object.values(board.positions).find((item) => item.assignmentId === bishop.id);
  return required(position, 'Bishop position missing').id;
}

function withoutPlacement(board: Board, positionId: PositionId): Board {
  const placements: Record<PositionId, MemberId> = {};
  for (const [id, memberId] of Object.entries(board.placements) as [PositionId, MemberId][]) {
    if (id === positionId) continue;
    placements[id] = memberId;
  }
  return { ...board, placements };
}

function renderAaronic(overrides: Partial<AaronicViewProps> = {}) {
  const data = buildPreviewData();
  const board = overrides.board ?? data.proposal.board;
  const onSetOversight = overrides.onSetOversight ?? vi.fn();
  const onOpenBishopric = overrides.onOpenBishopric ?? vi.fn();
  const props: AaronicViewProps = {
    board,
    ward: overrides.ward ?? data.ward,
    baseline: overrides.baseline === undefined ? data.proposal.baseline : overrides.baseline,
    boardGroupId: overrides.boardGroupId ?? boardGroupByKey(board, 'aaronic_priesthood'),
    readOnly: overrides.readOnly ?? false,
    onSetOversight,
    onOpenBishopric,
  };
  const view = render(<AaronicView {...props} />);
  return { ...view, data, props, onSetOversight, onOpenBishopric, board };
}

describe('AaronicView', () => {
  it('priests quorum shows the linked bishop card text and no Change control', async () => {
    const user = userEvent.setup();
    const { board, onOpenBishopric } = renderAaronic();
    const ward = buildPreviewData().ward;
    const memberId = required(board.placements[bishopPositionId(board)], 'bishop is vacant');
    const name = required(ward.members[memberId], 'bishop member missing').name;
    const priests = screen.getByRole('region', { name: 'Priests Quorum' });

    expect(priests).toHaveTextContent('Overseen by Bishop · fixed by office');
    expect(within(priests).queryByRole('button', { name: 'Change' })).toBeNull();
    const linked = within(priests).getByRole('button', { name: /Presides by office · linked from Bishopric/ });
    expect(linked).toHaveTextContent(name);
    expect(linked).toHaveTextContent('Presides by office · linked from Bishopric');

    await user.click(linked);
    expect(onOpenBishopric).toHaveBeenCalledTimes(1);
  });

  it('bishop card is not counted in the priests quorum filled/vacant counts', () => {
    const { board } = renderAaronic();
    const priestsGroup = callingGroupByKey(board, 'priests_quorum');
    const counts = groupCounts(board, priestsGroup.id);
    const priests = screen.getByRole('region', { name: 'Priests Quorum' });
    const memberId = required(board.placements[bishopPositionId(board)], 'bishop is vacant');
    const name = required(buildPreviewData().ward.members[memberId], 'bishop member missing').name;

    expect(counts.filled).toBeGreaterThan(0);
    expect(priests).toHaveTextContent(`${String(counts.filled)} filled`);
    expect(priests).toHaveTextContent(`${String(counts.vacant)} vacant`);
    expect(within(priests).getAllByRole('article')).toHaveLength(counts.filled + counts.vacant);
    expect(within(priests).getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
  });

  it('vacant bishop shows Vacant on the linked card', () => {
    const data = buildPreviewData();
    const board = withoutPlacement(data.proposal.board, bishopPositionId(data.proposal.board));

    renderAaronic({ board });
    const linked = within(screen.getByRole('region', { name: 'Priests Quorum' })).getByRole('button', {
      name: /Presides by office · linked from Bishopric/,
    });
    expect(within(linked).getByText('Vacant')).toBeInTheDocument();
  });

  it('Change → pick Second Counselor → confirm emits SetOversightRequest exactly', async () => {
    const user = userEvent.setup();
    const { board, onSetOversight } = renderAaronic();
    const teachers = callingGroupByKey(board, 'teachers_quorum');
    expect(overseerOf(board, { kind: 'callingGroup', id: teachers.id })).toBe('first_counselor');

    const region = screen.getByRole('region', { name: 'Teachers Quorum' });
    await user.click(within(region).getByRole('button', { name: 'Change' }));
    expect(within(region).getByRole('radio', { name: 'First Counselor' })).toBeChecked();
    await user.click(within(region).getByRole('radio', { name: 'Second Counselor' }));
    await user.click(within(region).getByRole('button', { name: 'Confirm' }));

    expect(onSetOversight).toHaveBeenCalledTimes(1);
    expect(onSetOversight).toHaveBeenCalledWith({
      target: { kind: 'callingGroup', id: teachers.id },
      overseer: 'second_counselor',
    });
  });

  it('confirming the current overseer emits nothing; Cancel emits nothing', async () => {
    const user = userEvent.setup();
    const { onSetOversight } = renderAaronic();
    const region = screen.getByRole('region', { name: 'Teachers Quorum' });

    await user.click(within(region).getByRole('button', { name: 'Change' }));
    expect(within(region).getByRole('radio', { name: 'First Counselor' })).toBeChecked();
    await user.click(within(region).getByRole('button', { name: 'Confirm' }));
    expect(onSetOversight).not.toHaveBeenCalled();
    expect(within(region).queryByRole('radio', { name: 'First Counselor' })).toBeNull();

    await user.click(within(region).getByRole('button', { name: 'Change' }));
    await user.click(within(region).getByRole('radio', { name: 'Second Counselor' }));
    await user.click(within(region).getByRole('button', { name: 'Cancel' }));
    expect(onSetOversight).not.toHaveBeenCalled();
    expect(within(region).queryByRole('radio', { name: 'Second Counselor' })).toBeNull();
  });

  it('readOnly hides Change', () => {
    renderAaronic({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByRole('button', { name: /Presides by office · linked from Bishopric/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Teachers Quorum' })).toHaveTextContent('Overseen by First Counselor');
    expect(screen.getByRole('region', { name: 'Deacons Quorum' })).toHaveTextContent('Overseen by Second Counselor');
  });

  it('Overseen by label follows inheritance when a quorum has no own entry', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const deacons = callingGroupByKey(board, 'deacons_quorum');
    const aaronicId = boardGroupByKey(board, 'aaronic_priesthood');
    const inherited: Board = {
      ...board,
      oversight: [
        ...board.oversight.filter(
          (entry) => !(entry.target.kind === 'callingGroup' && entry.target.id === deacons.id),
        ),
        { overseer: 'first_counselor', target: { kind: 'boardGroup', id: aaronicId }, fixed: false },
      ],
    };
    expect(
      inherited.oversight.some((entry) => entry.target.kind === 'callingGroup' && entry.target.id === deacons.id),
    ).toBe(false);
    expect(overseerOf(inherited, { kind: 'callingGroup', id: deacons.id })).toBe('first_counselor');

    renderAaronic({ board: inherited });
    const region = screen.getByRole('region', { name: 'Deacons Quorum' });
    expect(region).toHaveTextContent('Overseen by First Counselor');
    expect(region).not.toHaveTextContent('fixed by office');
    expect(within(region).getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('a changed placement shows + Proposed', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const deacons = callingGroupByKey(board, 'deacons_quorum');
    const assignment = required(
      Object.values(board.assignments).find(
        (item) => item.groupId === deacons.id && item.title === 'Deacons Quorum First Counselor',
      ),
      'deacons counselor missing',
    );
    const vacant = required(
      Object.values(board.positions).find(
        (position) => position.assignmentId === assignment.id && !Object.hasOwn(board.placements, position.id),
      ),
      'deacons counselor is filled',
    );
    const member = required(
      Object.values(data.ward.members).find((item) => item.name === 'Liv Example'),
      'Liv Example missing',
    );
    const next = expectOk(
      placeInPosition(board, { ward: data.ward, ids: sequentialIds('aaronic') }, {
        memberId: member.id,
        from: null,
        to: vacant.id,
      }),
    );

    renderAaronic({ board: next, baseline: board });
    const region = screen.getByRole('region', { name: 'Deacons Quorum' });
    expect(within(region).getByText('+ Proposed')).toBeInTheDocument();
    expect(within(region).getByText('Liv Example')).toBeInTheDocument();
  });
});
