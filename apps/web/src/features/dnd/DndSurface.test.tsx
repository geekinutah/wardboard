import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToDugout,
  createWard,
  sequentialIds,
  type AssignmentId,
  type Board,
  type CallingGroupId,
  type MemberId,
  type OperationResult,
  type PositionId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import { DugoutPanel } from '../dugout/DugoutPanel.tsx';
import { GroupDetail } from '../group-view/GroupDetail.tsx';
import { DndSurface } from './DndSurface.tsx';
import type { DropOp } from './types.ts';

function expectOk(result: OperationResult): Board {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.board;
}

function memberId(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) {
    throw new Error(`member ${name} not found`);
  }
  return found.id;
}

function groupId(board: Board, name: string): CallingGroupId {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) {
    throw new Error(`group ${name} not found`);
  }
  return found.id;
}

function assignmentId(board: Board, groupName: string, title: string): AssignmentId {
  const group = groupId(board, groupName);
  const found = Object.values(board.assignments).find((assignment) => assignment.groupId === group && assignment.title === title);
  if (found === undefined) {
    throw new Error(`assignment ${title} not found`);
  }
  return found.id;
}

function positions(board: Board, assignment: AssignmentId): PositionId[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === assignment)
    .sort((left, right) => left.order - right.order)
    .map((position) => position.id);
}

function vacancy(board: Board, assignment: AssignmentId): PositionId {
  const found = positions(board, assignment).find((id) => board.placements[id] === undefined);
  if (found === undefined) {
    throw new Error('no vacancy');
  }
  return found;
}

function heldBy(board: Board, assignment: AssignmentId, member: MemberId): PositionId {
  const found = positions(board, assignment).find((id) => board.placements[id] === member);
  if (found === undefined) {
    throw new Error('not held');
  }
  return found;
}

function wardNeedingApproval(ward: Ward, name: string): Ward {
  const id = memberId(ward, name);
  const member = ward.members[id];
  if (member === undefined) {
    throw new Error('missing member');
  }
  const result = createWard({ members: { ...ward.members, [id]: { ...member, needsApproval: true } }, tags: ward.tags });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.value;
}

interface Setup {
  readonly ward: Ward;
  readonly proposal: Proposal;
  readonly board: Board;
}

function setup(options: { needsApproval?: string; include?: string } = {}): Setup {
  const built = buildFixtureWard();
  const ward = options.needsApproval === undefined ? built.ward : wardNeedingApproval(built.ward, options.needsApproval);
  const proposal = buildFixtureProposal(built.current, ward);
  let board = proposal.board;
  if (options.include !== undefined) {
    board = expectOk(addToDugout(board, { ward, ids: sequentialIds('t') }, { memberId: memberId(ward, options.include) }));
  }
  return { ward, proposal: { ...proposal, board }, board };
}

const noop = (): void => undefined;

interface Rendered {
  readonly onCommit: ReturnType<typeof vi.fn<(ops: readonly DropOp[]) => void>>;
  readonly onHoverOpen: ReturnType<typeof vi.fn<(target: string) => void>>;
  readonly onCardClick: ReturnType<typeof vi.fn<() => void>>;
}

function renderSurface(f: Setup, options: { readOnly?: boolean } = {}): Rendered {
  const onCommit = vi.fn<(ops: readonly DropOp[]) => void>();
  const onHoverOpen = vi.fn<(target: string) => void>();
  const onCardClick = vi.fn<() => void>();
  const groups = ['Relief Society Presidency', 'Relief Society Teachers', 'Primary Teachers', 'Sunday School Presidency'];
  render(
    <DndSurface
      board={f.board}
      ward={f.ward}
      proposal={f.proposal}
      me={{ displayName: 'Preview Editor' }}
      readOnly={options.readOnly ?? false}
      onCommit={onCommit}
      onHoverOpen={onHoverOpen}
    >
      {groups.map((name) => (
        <GroupDetail
          key={name}
          board={f.board}
          ward={f.ward}
          baseline={f.proposal.baseline}
          callingGroupId={groupId(f.board, name)}
          readOnly
          onAddPosition={noop}
          onAddGroup={noop}
        />
      ))}
      <DugoutPanel board={f.board} ward={f.ward} />
      <section aria-label="Out-of-Unit">
        <article data-member-id={memberId(f.ward, 'Kai Fictional')}>Kai Fictional</article>
      </section>
      <div data-zoom-target="org:x">Tile X</div>
      <div data-testid="clickable" data-member-id={memberId(f.ward, 'Liv Example')} onClick={onCardClick}>
        Clickable card
      </div>
    </DndSurface>,
  );
  return { onCommit, onHoverOpen, onCardClick };
}

function card(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`${selector} not rendered`);
  }
  return found;
}

function dugoutRow(id: MemberId): HTMLElement {
  return card(`[data-drop-target="dugout"] article[data-member-id="${id}"]`);
}

function slot(id: PositionId): HTMLElement {
  return card(`[data-position-id="${id}"]`);
}

let underPointer: Element | null = null;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(Document.prototype, 'elementFromPoint');

beforeEach(() => {
  underPointer = null;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => underPointer,
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
  if (originalElementFromPoint !== undefined) {
    Object.defineProperty(Document.prototype, 'elementFromPoint', originalElementFromPoint);
  }
  vi.useRealTimers();
});

function press(from: Element, x = 100, y = 100): void {
  fireEvent.pointerDown(from, { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' });
}

function moveOver(over: Element | null, x: number, y: number): void {
  underPointer = over;
  fireEvent.pointerMove(over ?? document.body, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
}

function release(over: Element | null, x: number, y: number): void {
  underPointer = over;
  fireEvent.pointerUp(over ?? document.body, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
}

/** A full drag: press on `from`, move past the threshold onto `to`, and release there. */
function drag(from: Element, to: Element): void {
  press(from);
  moveOver(to, 140, 160);
  release(to, 140, 160);
}

function ghost(): Element | null {
  return document.querySelector('[data-dnd-ghost]');
}

describe('DndSurface', () => {
  it('drag starts only after 6px and never when readOnly', () => {
    const f = setup();
    const { onCardClick, onCommit } = renderSurface(f);
    const clickable = screen.getByTestId('clickable');
    press(clickable, 100, 100);
    moveOver(clickable, 103, 104); // 5px
    expect(ghost()).toBeNull();
    release(clickable, 103, 104);
    fireEvent.click(clickable);
    expect(onCardClick).toHaveBeenCalledTimes(1);

    // Past the threshold a drag starts, and the click that ends it is not delivered.
    press(clickable, 100, 100);
    moveOver(clickable, 104, 105); // 6.4px
    expect(ghost()).not.toBeNull();
    expect(ghost()).toHaveTextContent('Liv Example');
    release(clickable, 104, 105);
    fireEvent.click(clickable);
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    // readOnly (Current): no drag ever starts.
    cleanup();
    const readOnly = renderSurface(f, { readOnly: true });
    const ivy = memberId(f.ward, 'Ivy Notreal');
    const target = slot(vacancy(f.board, assignmentId(f.board, 'Sunday School Presidency', 'Secretary')));
    press(dugoutRow(ivy));
    moveOver(target, 160, 180);
    expect(ghost()).toBeNull();
    expect(target).not.toHaveAttribute('data-drop-active');
    release(target, 160, 180);
    expect(readOnly.onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('direct drop commits once', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const ivy = memberId(f.ward, 'Ivy Notreal');
    const to = vacancy(f.board, assignmentId(f.board, 'Sunday School Presidency', 'Secretary'));
    const target = slot(to);
    press(dugoutRow(ivy));
    moveOver(target, 160, 180);
    expect(ghost()).toHaveTextContent('Ivy Notreal');
    expect(target).toHaveAttribute('data-drop-active', 'true');
    expect(screen.getByText('Drop here')).toBeInTheDocument();
    release(target, 160, 180);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([{ kind: 'placeInPosition', request: { memberId: ivy, from: null, to } }]);
    expect(ghost()).toBeNull();
    expect(target).not.toHaveAttribute('data-drop-active');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a position source shows where it moves from on the ghost', () => {
    const f = setup();
    renderSurface(f);
    const gwen = memberId(f.ward, 'Gwen Imaginary');
    const gwenPos = heldBy(f.board, assignmentId(f.board, 'Relief Society Presidency', 'First Counselor'), gwen);
    press(slot(gwenPos));
    moveOver(document.body, 200, 200);
    expect(ghost()).toHaveTextContent('Gwen Imaginary');
    expect(ghost()).toHaveTextContent('Moving from First Counselor');
    release(document.body, 200, 200);
    expect(ghost()).toBeNull();
  });

  it('drop dialog: radio choice, confirm label, Cancel', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const gwen = memberId(f.ward, 'Gwen Imaginary');
    const hana = memberId(f.ward, 'Hana Madeup');
    const gwenPos = heldBy(f.board, assignmentId(f.board, 'Relief Society Presidency', 'First Counselor'), gwen);
    const hanaPos = heldBy(f.board, assignmentId(f.board, 'Relief Society Presidency', 'Second Counselor'), hana);

    drag(slot(gwenPos), slot(hanaPos));
    const dialog = screen.getByRole('dialog', { name: 'Second Counselor is filled' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Relief Society Presidency · Second Counselor')).toBeInTheDocument();
    expect(
      within(dialog).getByText("You dropped Gwen Imaginary onto Hana Madeup's calling. Choose what this proposal should show."),
    ).toBeInTheDocument();
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label') ?? radio.closest('label')?.textContent)).toHaveLength(2);
    const swapRadio = within(dialog).getByRole('radio', { name: /^Swap/ });
    const releaseRadio = within(dialog).getByRole('radio', { name: /^Release occupant/ });
    expect(radios[0]).toBe(swapRadio);
    expect(radios[1]).toBe(releaseRadio);
    expect(swapRadio).toBeChecked();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByText('Gwen Imaginary takes Second Counselor. Hana Madeup takes First Counselor.')).toBeInTheDocument();
    expect(within(dialog).getByText('Gwen Imaginary takes Second Counselor. Hana Madeup is released from it.')).toBeInTheDocument();
    expect(within(dialog).getByText('Applied as one change for everyone viewing.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Swap' })).toBeInTheDocument();

    fireEvent.click(releaseRadio);
    expect(within(dialog).queryByRole('button', { name: 'Swap' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Release occupant' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();

    drag(slot(gwenPos), slot(hanaPos));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();

    drag(slot(gwenPos), slot(hanaPos));
    const again = screen.getByRole('dialog', { name: 'Second Counselor is filled' });
    fireEvent.click(within(again).getByRole('radio', { name: /^Release occupant/ }));
    fireEvent.click(within(again).getByRole('button', { name: 'Release occupant' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([
      { kind: 'releaseOccupant', request: { memberId: gwen, from: gwenPos, to: hanaPos } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('second-calling dialog names outside callings and the Handbook', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const kai = memberId(f.ward, 'Kai Fictional');
    const rsTeacher = assignmentId(f.board, 'Relief Society Teachers', 'Relief Society Teacher');
    const kaiCard = card(`[aria-label="Out-of-Unit"] [data-member-id="${kai}"]`);

    drag(kaiCard, slot(vacancy(f.board, rsTeacher)));
    let dialog = screen.getByRole('dialog', { name: 'Give Kai Fictional a second calling?' });
    expect(within(dialog).getByText('Serves outside the ward as Stake Young Single Adult Adviser · Example Stake')).toBeInTheDocument();
    expect(within(dialog).getByText('Adding Relief Society Teachers · Relief Society Teacher')).toBeInTheDocument();
    expect(
      within(dialog).getByText('The General Handbook 30.1.1 says a member generally serves in only one calling at a time.'),
    ).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    drag(kaiCard, slot(vacancy(f.board, rsTeacher)));
    dialog = screen.getByRole('dialog', { name: 'Give Kai Fictional a second calling?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add second calling' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([
      { kind: 'addToList', request: { memberId: kai, from: null, assignmentId: rsTeacher } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('approval dialog requires the checkbox and appends approvePlacement', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const cy = memberId(f.ward, 'Cy Mockup');
    const cyPos = heldBy(f.board, assignmentId(f.board, 'Primary Teachers', 'Primary Teacher'), cy);
    const rsTeacher = assignmentId(f.board, 'Relief Society Teachers', 'Relief Society Teacher');
    const to = vacancy(f.board, rsTeacher);

    drag(slot(cyPos), slot(to));
    const dialog = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
    expect(within(dialog).getByText('Cy Mockup is marked Needs approval.')).toBeInTheDocument();
    expect(within(dialog).getByText('Member')).toBeInTheDocument();
    expect(within(dialog).getByText('Cy Mockup')).toBeInTheDocument();
    expect(within(dialog).getByText('Relief Society Teachers · Relief Society Teacher')).toBeInTheDocument();
    expect(within(dialog).getByText('Spring adjustments')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Approval applies only to this member, position and proposal. Moving them elsewhere will ask again. WardBoard does not certify eligibility — consult the Handbook and official records outside this app.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Recorded as Preview Editor · today')).toBeInTheDocument();
    const approve = within(dialog).getByRole('button', { name: 'Approve placement' });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: "I've reviewed this outside WardBoard and approve this placement for discussion.",
      }),
    );
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([
      { kind: 'addToList', request: { memberId: cy, from: cyPos, assignmentId: rsTeacher } },
      { kind: 'approvePlacement', request: { memberId: cy, positionId: to } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling the approval dialog commits nothing', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const cy = memberId(f.ward, 'Cy Mockup');
    const cyPos = heldBy(f.board, assignmentId(f.board, 'Primary Teachers', 'Primary Teacher'), cy);
    const to = vacancy(f.board, assignmentId(f.board, 'Relief Society Teachers', 'Relief Society Teacher'));
    drag(slot(cyPos), slot(to));
    const dialog = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('both dialogs appear in order: second calling, then approval', () => {
    const f = setup({ needsApproval: 'Jo Testwell', include: 'Jo Testwell' });
    const { onCommit } = renderSurface(f);
    const jo = memberId(f.ward, 'Jo Testwell');
    const primaryTeacher = assignmentId(f.board, 'Primary Teachers', 'Primary Teacher');
    const to = vacancy(f.board, primaryTeacher);

    drag(dugoutRow(jo), slot(to));
    const second = screen.getByRole('dialog', { name: 'Give Jo Testwell another calling?' });
    expect(screen.queryByRole('dialog', { name: 'Approval needed for this placement' })).toBeNull();
    expect(within(second).getByText('Already serves as Relief Society Teacher')).toBeInTheDocument();
    expect(within(second).getByText('Already serves as Nursery Leader')).toBeInTheDocument();
    expect(within(second).getByText('Adding Primary Teachers · Primary Teacher')).toBeInTheDocument();
    fireEvent.click(within(second).getByRole('button', { name: 'Add another calling' }));
    expect(onCommit).not.toHaveBeenCalled();

    const approval = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
    expect(within(approval).getByText('Jo Testwell is marked Needs approval.')).toBeInTheDocument();
    fireEvent.click(within(approval).getByRole('checkbox'));
    fireEvent.click(within(approval).getByRole('button', { name: 'Approve placement' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([
      { kind: 'addToList', request: { memberId: jo, from: null, assignmentId: primaryTeacher } },
      { kind: 'approvePlacement', request: { memberId: jo, positionId: to } },
    ]);
  });

  it('blocked drop shows an alert and commits nothing', () => {
    const f = setup({ include: 'Jo Testwell' });
    const { onCommit } = renderSurface(f);
    const jo = memberId(f.ward, 'Jo Testwell');
    const rsTeacher = assignmentId(f.board, 'Relief Society Teachers', 'Relief Society Teacher');

    drag(dugoutRow(jo), slot(vacancy(f.board, rsTeacher)));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Can't drop here: member ${jo} is already in list ${rsTeacher}`);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();

    drag(dugoutRow(jo), slot(vacancy(f.board, rsTeacher)));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The next drag clears it.
    press(dugoutRow(jo));
    moveOver(document.body, 200, 220);
    expect(screen.queryByRole('alert')).toBeNull();
    release(document.body, 200, 220);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('hovering a tile opens it after the delay, once', () => {
    vi.useFakeTimers();
    const f = setup();
    const { onHoverOpen } = renderSurface(f);
    const ivy = memberId(f.ward, 'Ivy Notreal');
    const tile = screen.getByText('Tile X');

    press(dugoutRow(ivy));
    moveOver(tile, 150, 150);
    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(onHoverOpen).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onHoverOpen).toHaveBeenCalledTimes(1);
    expect(onHoverOpen).toHaveBeenCalledWith('org:x');

    moveOver(tile, 152, 152);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onHoverOpen).toHaveBeenCalledTimes(1);

    // Leaving and returning restarts the timer.
    moveOver(document.body, 400, 400);
    moveOver(tile, 150, 150);
    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(onHoverOpen).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onHoverOpen).toHaveBeenCalledTimes(2);

    // Leaving before the delay cancels it.
    moveOver(document.body, 400, 400);
    moveOver(tile, 150, 150);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    moveOver(document.body, 400, 400);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onHoverOpen).toHaveBeenCalledTimes(2);
    release(document.body, 400, 400);
  });

  it('Escape cancels a drag', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const ivy = memberId(f.ward, 'Ivy Notreal');
    const target = slot(vacancy(f.board, assignmentId(f.board, 'Sunday School Presidency', 'Secretary')));
    press(dugoutRow(ivy));
    moveOver(target, 160, 180);
    expect(ghost()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ghost()).toBeNull();
    expect(target).not.toHaveAttribute('data-drop-active');
    release(target, 160, 180);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pointercancel ends a drag with no effect', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const ivy = memberId(f.ward, 'Ivy Notreal');
    const target = slot(vacancy(f.board, assignmentId(f.board, 'Sunday School Presidency', 'Secretary')));
    press(dugoutRow(ivy));
    moveOver(target, 160, 180);
    fireEvent.pointerCancel(target, { pointerId: 1 });
    expect(ghost()).toBeNull();
    release(target, 160, 180);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a drop on the dugout from a calling commits moveToDugout, and dugout to dugout does nothing', () => {
    const f = setup();
    const { onCommit } = renderSurface(f);
    const gwen = memberId(f.ward, 'Gwen Imaginary');
    const gwenPos = heldBy(f.board, assignmentId(f.board, 'Relief Society Presidency', 'First Counselor'), gwen);
    const panel = screen.getByRole('complementary', { name: 'Dugout' });

    const ivy = memberId(f.ward, 'Ivy Notreal');
    press(dugoutRow(ivy));
    moveOver(panel, 300, 300);
    expect(panel).not.toHaveAttribute('data-drop-active');
    release(panel, 300, 300);
    expect(onCommit).not.toHaveBeenCalled();

    press(slot(gwenPos));
    moveOver(panel, 300, 300);
    expect(panel).toHaveAttribute('data-drop-active', 'true');
    release(panel, 300, 300);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([{ kind: 'moveToDugout', request: { memberId: gwen, from: gwenPos } }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
