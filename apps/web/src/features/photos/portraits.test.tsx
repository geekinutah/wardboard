import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  wardOverview,
  type Board,
  type BoardGroupId,
  type Member,
  type MemberId,
  type OverviewLeader,
  type Ward,
} from '@wardboard/core';
import { buildPreviewData } from '../../preview/data.ts';
import { AaronicView } from '../aaronic/AaronicView.tsx';
import { DugoutPanel } from '../dugout/DugoutPanel.tsx';
import { GroupDetail } from '../group-view/GroupDetail.tsx';
import { OrganizationView } from '../org-view/OrganizationView.tsx';
import { Presentation } from '../presentation/Presentation.tsx';
import { WardOverview } from '../ward-overview/WardOverview.tsx';

function required<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function withPhoto(ward: Ward, id: MemberId, photoRef: string | null): Ward {
  const member = required(ward.members[id], `member ${id} missing`);
  return { ...ward, members: { ...ward.members, [id]: { ...member, photoRef } } };
}

function groupKey(board: Board, key: string): BoardGroupId {
  return required(Object.values(board.boardGroups).find((g) => g.key === key), `group ${key}`).id;
}

function bishopId(board: Board): MemberId {
  const bishopric = required(
    Object.values(board.callingGroups).find((g) => g.kind === 'bishopric'),
    'bishopric',
  );
  const assignment = required(
    Object.values(board.assignments).find((a) => a.groupId === bishopric.id && a.title === 'Bishop'),
    'bishop assignment',
  );
  const position = required(
    Object.values(board.positions).find((p) => p.assignmentId === assignment.id),
    'bishop position',
  );
  return required(board.placements[position.id], 'bishop vacant');
}

function filledLeaders(board: Board, baseline: Board | null, key: string): (OverviewLeader & { memberId: MemberId })[] {
  const tile = required(
    wardOverview(board, baseline).find((t) => t.boardGroupId === groupKey(board, key)),
    `tile ${key}`,
  );
  return tile.leaders.filter((l): l is OverviewLeader & { memberId: MemberId } => l.memberId !== null);
}

function card(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('article[aria-label]')].find(
    (el) => el.getAttribute('aria-label') === name,
  );
  return required(found, `card ${name}`);
}

function nameOf(ward: Ward, id: MemberId): string {
  return required(ward.members[id], 'member').name.split(' · ')[0] as string;
}

function srcs(el: Element): string[] {
  return [...el.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
}

describe('portraits on the board views', () => {
  it('organization cards show stored portraits', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const [first, second] = filledLeaders(board, data.proposal.baseline, 'relief_society');
    const a = required(first, 'leader a');
    const b = required(second, 'leader b');
    const ward = withPhoto(data.ward, a.memberId, 'ref-a');
    const { container } = render(
      <OrganizationView
        board={board}
        ward={ward}
        baseline={data.proposal.baseline}
        boardGroupId={groupKey(board, 'relief_society')}
      />,
    );
    const withImg = card(container, nameOf(ward, a.memberId));
    expect(srcs(withImg)).toEqual(['/api/photos/ref-a']);
    const without = card(container, nameOf(ward, b.memberId));
    expect(without.querySelector('img')).toBeNull();
    expect(without.querySelector('.wb-avatar')).not.toBeNull();
  });

  it('group detail cards show stored portraits', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const group = required(Object.values(board.callingGroups).find((g) => g.name === 'Relief Society Teachers'), 'g');
    const positions = Object.values(board.positions).filter(
      (p) => board.assignments[p.assignmentId]?.groupId === group.id && board.placements[p.id] !== undefined,
    );
    const a = required(board.placements[required(positions[0], 'p0').id], 'm0');
    const b = required(board.placements[required(positions[1], 'p1').id], 'm1');
    const ward = withPhoto(data.ward, a, 'ref-g');
    const { container } = render(
      <GroupDetail
        board={board}
        ward={ward}
        baseline={data.proposal.baseline}
        callingGroupId={group.id}
        readOnly={false}
        onAddPosition={() => undefined}
        onAddGroup={() => undefined}
      />,
    );
    expect(srcs(card(container, nameOf(ward, a)))).toEqual(['/api/photos/ref-g']);
    expect(card(container, nameOf(ward, b)).querySelector('img')).toBeNull();
  });

  it('Aaronic cards and the linked bishop show stored portraits', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const bishop = bishopId(board);
    const priests = required(Object.values(board.callingGroups).find((g) => g.key === 'priests_quorum'), 'priests');
    const priestPositions = Object.values(board.positions).filter(
      (p) => board.assignments[p.assignmentId]?.groupId === priests.id && board.placements[p.id] !== undefined,
    );
    const priest = required(board.placements[required(priestPositions[0], 'pp').id], 'priest');
    let ward = withPhoto(data.ward, priest, 'ref-p');
    ward = withPhoto(ward, bishop, 'ref-b');
    const { container } = render(
      <AaronicView
        board={board}
        ward={ward}
        baseline={data.proposal.baseline}
        boardGroupId={groupKey(board, 'aaronic_priesthood')}
        readOnly={false}
        onSetOversight={() => undefined}
      />,
    );
    expect(srcs(card(container, nameOf(ward, priest)))).toEqual(['/api/photos/ref-p']);
    const linked = required(container.querySelector('.wb-aaronic-linked'), 'linked');
    expect(srcs(linked)).toEqual(['/api/photos/ref-b']);
    expect(linked.querySelector('img')).toHaveAttribute('aria-hidden', 'true');
  });

  it('Aaronic linked bishop keeps initials without a portrait', () => {
    const data = buildPreviewData();
    const { container } = render(
      <AaronicView
        board={data.proposal.board}
        ward={data.ward}
        baseline={data.proposal.baseline}
        boardGroupId={groupKey(data.proposal.board, 'aaronic_priesthood')}
        readOnly={false}
        onSetOversight={() => undefined}
      />,
    );
    const linked = required(container.querySelector('.wb-aaronic-linked'), 'linked');
    expect(linked.querySelector('img')).toBeNull();
    expect(linked.querySelector('.wb-avatar')).not.toBeNull();
  });

  it('dugout rows show stored portraits', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const placed = new Set(Object.values(board.placements));
    const free = Object.values(data.ward.members).filter((m: Member) => !placed.has(m.id));
    const a = required(free[0], 'free a');
    const b = required(free[1], 'free b');
    const ward = withPhoto(data.ward, a.id, 'ref-d');
    const { container } = render(<DugoutPanel board={board} ward={ward} />);
    const rowA = container.querySelector(`article[data-member-id="${a.id}"]`);
    const rowB = container.querySelector(`article[data-member-id="${b.id}"]`);
    expect(srcs(required(rowA, 'row a'))).toEqual(['/api/photos/ref-d']);
    if (rowB !== null) expect(rowB.querySelector('img')).toBeNull();
  });

  it('ward overview leaders show stored portraits', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const [first, second] = filledLeaders(board, data.proposal.baseline, 'relief_society');
    const a = required(first, 'a');
    const b = required(second, 'b');
    const ward = withPhoto(data.ward, a.memberId, 'ref-o');
    const { container } = render(<WardOverview board={board} ward={ward} baseline={data.proposal.baseline} />);
    const slots = [...container.querySelectorAll<HTMLElement>('.wb-overview-leader')];
    const slotOf = (id: MemberId): HTMLElement =>
      required(
        slots.find((s) => s.querySelector('.wb-overview-leader-name')?.textContent === nameOf(ward, id)),
        'slot',
      );
    expect(srcs(slotOf(a.memberId))).toEqual(['/api/photos/ref-o']);
    expect(slotOf(a.memberId).querySelector('img')).toHaveAttribute('aria-hidden', 'true');
    expect(slotOf(b.memberId).querySelector('img')).toBeNull();
    expect(slotOf(b.memberId).querySelector('.wb-overview-avatar')?.textContent).not.toBe('');
  });

  it('presentation leaders show stored portraits', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const leaders = wardOverview(board, data.proposal.baseline)
      .flatMap((t) => t.leaders)
      .filter((l): l is OverviewLeader & { memberId: MemberId } => l.memberId !== null);
    const proposedLeader = required(leaders[0], 'a leader');
    const plain = required(leaders[1], 'another leader');
    // A baseline that lacks the first leader's placement makes that leader a proposed change.
    const rest = Object.fromEntries(
      Object.entries(board.placements).filter(([id]) => id !== proposedLeader.positionId),
    );
    const baseline: Board = { ...board, placements: rest };
    expect(
      wardOverview(board, baseline)
        .flatMap((t) => t.leaders)
        .find((l) => l.positionId === proposedLeader.positionId)?.proposed,
    ).toBe(true);
    let ward = withPhoto(data.ward, proposedLeader.memberId, 'ref-pp');
    ward = withPhoto(ward, plain.memberId, 'ref-pl');
    const { container } = render(
      <Presentation
        board={board}
        ward={ward}
        baseline={baseline}
        title="Draft"
        status="draft"
        baselineCapturedAt={null}
        showNeedsApproval={false}
        onExit={() => undefined}
      />,
    );
    const imgs = [...container.querySelectorAll('img.wb-presentation-avatar')];
    const proposedImg = required(
      imgs.find((i) => i.getAttribute('src') === '/api/photos/ref-pp'),
      'proposed img',
    );
    expect(proposedImg).toHaveClass('wb-presentation-avatar-proposed');
    const plainImg = required(
      imgs.find((i) => i.getAttribute('src') === '/api/photos/ref-pl'),
      'plain img',
    );
    expect(plainImg).not.toHaveClass('wb-presentation-avatar-proposed');
    expect(plainImg).toHaveAttribute('aria-hidden', 'true');
  });

  it('a ward update changes the portrait', () => {
    const data = buildPreviewData();
    const board = data.proposal.board;
    const a = required(filledLeaders(board, data.proposal.baseline, 'relief_society')[0], 'a');
    const props = { board, baseline: data.proposal.baseline, boardGroupId: groupKey(board, 'relief_society') };
    const { container, rerender } = render(
      <OrganizationView {...props} ward={withPhoto(data.ward, a.memberId, 'ref-1')} />,
    );
    const name = nameOf(data.ward, a.memberId);
    expect(srcs(card(container, name))).toEqual(['/api/photos/ref-1']);
    rerender(<OrganizationView {...props} ward={withPhoto(data.ward, a.memberId, 'ref-2')} />);
    expect(srcs(card(container, name))).toEqual(['/api/photos/ref-2']);
    rerender(<OrganizationView {...props} ward={withPhoto(data.ward, a.memberId, null)} />);
    expect(card(container, name).querySelector('img')).toBeNull();
  });
});
