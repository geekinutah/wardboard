import {
  addToList,
  createWard,
  dugout,
  placeInPosition,
  proposalId,
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
import type { ProposalSummary } from '@wardboard/server';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

/*
 * The integrated desktop editing layer: dugout panel, drag and drop sent to the
 * server one operation at a time, and the header search. Same fake socket and
 * real SyncClient as BoardShell.test.tsx; the "server" is this file.
 */

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const APPROVAL_CHECKBOX = "I've reviewed this outside WardBoard and approve this placement for discussion.";

const fixture = buildFixtureWard();
const current = fixture.current;

function expectOk(result: OperationResult): Board {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.board;
}

function memberNamed(ward: Ward, name: string): MemberId {
  const found = Object.values(ward.members).find((member) => member.name === name);
  if (found === undefined) throw new Error(`member ${name} not found`);
  return found.id;
}

function groupNamed(board: Board, name: string): CallingGroupId {
  const found = Object.values(board.callingGroups).find((group) => group.name === name);
  if (found === undefined) throw new Error(`group ${name} not found`);
  return found.id;
}

function assignmentIn(board: Board, groupName: string, title: string): AssignmentId {
  const group = groupNamed(board, groupName);
  const found = Object.values(board.assignments).find((item) => item.groupId === group && item.title === title);
  if (found === undefined) throw new Error(`assignment ${title} not found`);
  return found.id;
}

function positionsOf(board: Board, assignment: AssignmentId): PositionId[] {
  return Object.values(board.positions)
    .filter((position) => position.assignmentId === assignment)
    .sort((left, right) => left.order - right.order)
    .map((position) => position.id);
}

function vacancyIn(board: Board, assignment: AssignmentId): PositionId {
  const found = positionsOf(board, assignment).find((id) => board.placements[id] === undefined);
  if (found === undefined) throw new Error('no vacancy');
  return found;
}

function heldBy(board: Board, assignment: AssignmentId, member: MemberId): PositionId {
  const found = positionsOf(board, assignment).find((id) => board.placements[id] === member);
  if (found === undefined) throw new Error('not held');
  return found;
}

function wardNeedingApproval(ward: Ward, name: string): Ward {
  const id = memberNamed(ward, name);
  const member = ward.members[id];
  if (member === undefined) throw new Error('missing member');
  const result = createWard({ members: { ...ward.members, [id]: { ...member, needsApproval: true } }, tags: ward.tags });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function withAssignmentTitle(board: Board, assignment: AssignmentId, title: string): Board {
  const found = board.assignments[assignment];
  if (found === undefined) throw new Error('missing assignment');
  return { ...board, assignments: { ...board.assignments, [assignment]: { ...found, title } } };
}

const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(frame: string): void {
    this.sent.push(frame);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

type Harness = { client: SyncClient; sockets: FakeSocket[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedFrames(sockets: readonly FakeSocket[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const frame of socket.sent) {
      const parsed = JSON.parse(frame) as unknown;
      if (isRecord(parsed) && parsed.type === type) found.push(parsed);
    }
  }
  return found;
}

function opFrames(harness: Harness): { requestId: string; baseVersion: unknown; kind: unknown; request: unknown }[] {
  return typedFrames(harness.sockets, 'op').map((frame) => {
    const op = isRecord(frame.op) ? frame.op : {};
    return {
      requestId: typeof frame.requestId === 'string' ? frame.requestId : '',
      baseVersion: frame.baseVersion,
      kind: op.kind,
      request: op.request,
    };
  });
}

function mount(): Harness {
  const sockets: FakeSocket[] = [];
  let nextTimer = 1;
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout() {
        const id = nextTimer;
        nextTimer += 1;
        return id;
      },
      clearTimeout() {
        // Timers never fire in these tests.
      },
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function lastSocket(harness: Harness): FakeSocket {
  const socket = harness.sockets[harness.sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function renderShell(harness: Harness): FakeSocket {
  render(
    <SyncProvider client={harness.client}>
      <BoardShell healthClient={pendingHealth} />
    </SyncProvider>,
  );
  act(() => {
    harness.client.start();
    lastSocket(harness).open();
  });
  return lastSocket(harness);
}

function currentInfo(): CurrentInfo {
  return { boardId: current.id, version: current.version, importVersion: 'fixture', importedAt: IMPORTED_AT };
}

function summaryOf(proposal: Proposal, status: Proposal['status'] = proposal.status): ProposalSummary {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    tabOrder: proposal.tabOrder,
    boardId: proposal.board.id,
    version: proposal.board.version,
    updatedAt: proposal.updatedAt,
  };
}

function viewOf(proposal: Proposal, status: Proposal['status'] = proposal.status): ProposalView {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
  };
}

function showBoards(socket: FakeSocket, proposals: readonly ProposalSummary[]): void {
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals });
  });
}

function showSnapshot(socket: FakeSocket, board: Board, ward: Ward, proposal: ProposalView | null): void {
  act(() => {
    socket.receive({ type: 'snapshot', boardId: board.id, version: board.version, board, ward, proposal });
  });
}

/** Lets awaited sends, outcomes and React effects run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve();
    }
  });
}

async function answerBaseline(harness: Harness, socket: FakeSocket, baseline: Board): Promise<void> {
  const frame = typedFrames(harness.sockets, 'getBoard').at(-1);
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error('no getBoard request');
  const requestId = frame.requestId;
  await act(async () => {
    socket.receive({ type: 'board', requestId, board: baseline });
    await Promise.resolve();
  });
  await settle();
}

type Opened = { harness: Harness; socket: FakeSocket; user: UserEvent };

/** Opens Current, then the proposal tab with `board` and `ward`, and loads the baseline. */
async function openProposal(proposal: Proposal, ward: Ward, board: Board = proposal.board): Promise<Opened> {
  const user = userEvent.setup();
  const harness = mount();
  const socket = renderShell(harness);
  showBoards(socket, [summaryOf(proposal)]);
  showSnapshot(socket, current, ward, null);
  await user.click(screen.getByRole('tab', { name: proposal.name }));
  showSnapshot(socket, board, ward, viewOf(proposal));
  await answerBaseline(harness, socket, proposal.baseline);
  return { harness, socket, user };
}

function levelText(): string {
  return document.querySelector('.wb-canvas-level')?.textContent ?? '';
}

async function zoomToOrg(user: UserEvent, org: string): Promise<void> {
  await user.dblClick(screen.getByRole('article', { name: org }));
  expect(levelText()).toBe('Organization');
}

async function zoomTo(user: UserEvent, org: string, group: string): Promise<void> {
  await zoomToOrg(user, org);
  const row = document.querySelector(`[data-zoom-target^="group:"][aria-label="${group}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`missing ${group} zoom target`);
  await user.dblClick(row);
  expect(levelText()).toBe('Group');
}

function dugoutPanel(): HTMLElement {
  return screen.getByRole('complementary', { name: /^Dugout/ });
}

async function dugoutRow(user: UserEvent, member: MemberId): Promise<HTMLElement> {
  const find = (): HTMLElement | null =>
    dugoutPanel().querySelector<HTMLElement>(`article[data-member-id="${member}"]`);
  const shown = find();
  if (shown !== null) return shown;
  await user.click(within(dugoutPanel()).getByRole('button', { name: /^Show \d+ more$/ }));
  const more = find();
  if (more === null) throw new Error(`${member} is not in the dugout`);
  return more;
}

function slot(id: PositionId): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-position-id="${id}"]`);
  if (found === null) throw new Error(`position ${id} not rendered`);
  return found;
}

let underPointer: Element | null = null;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(Document.prototype, 'elementFromPoint');

beforeEach(() => {
  underPointer = null;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => underPointer });
});

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
  if (originalElementFromPoint !== undefined) {
    Object.defineProperty(Document.prototype, 'elementFromPoint', originalElementFromPoint);
  }
  vi.useRealTimers();
});

function press(from: Element): void {
  fireEvent.pointerDown(from, { clientX: 100, clientY: 100, button: 0, pointerId: 1, pointerType: 'mouse' });
}

function moveOver(over: Element, x = 140, y = 160): void {
  underPointer = over;
  fireEvent.pointerMove(over, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
}

function releaseOver(over: Element, x = 140, y = 160): void {
  underPointer = over;
  fireEvent.pointerUp(over, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
}

function drag(from: Element, to: Element): void {
  press(from);
  moveOver(to);
  releaseOver(to);
}

function ghost(): Element | null {
  return document.querySelector('[data-dnd-ghost]');
}

async function approve(user: UserEvent): Promise<void> {
  const dialog = screen.getByRole('dialog', { name: 'Approval needed for this placement' });
  await user.click(within(dialog).getByRole('checkbox', { name: APPROVAL_CHECKBOX }));
  await user.click(within(dialog).getByRole('button', { name: 'Approve placement' }));
}

function commitFrame(socket: FakeSocket, requestId: string, board: Board): void {
  act(() => {
    socket.receive({ type: 'committed', boardId: board.id, version: board.version, board, requestId, by: 'e2e@example.test' });
  });
}

/** Ivy Notreal (dugout, Needs approval) dropped on the Sunday School Presidency Secretary vacancy. */
async function dropIvyOnSecretary(): Promise<
  Opened & { ward: Ward; proposal: Proposal; ivy: MemberId; secretary: PositionId }
> {
  const ward = wardNeedingApproval(fixture.ward, 'Ivy Notreal');
  const proposal = buildFixtureProposal(current, ward);
  const opened = await openProposal(proposal, ward);
  const ivy = memberNamed(ward, 'Ivy Notreal');
  const secretary = vacancyIn(proposal.board, assignmentIn(proposal.board, 'Sunday School Presidency', 'Secretary'));
  // Presidency positions are leadership cards on the organization level.
  await zoomToOrg(opened.user, 'Sunday School');
  drag(await dugoutRow(opened.user, ivy), slot(secretary));
  await approve(opened.user);
  await settle();
  return { ...opened, ward, proposal, ivy, secretary };
}

describe('desktop editing layer', () => {
  it("dugout panel renders beside the canvas with the active board's dugout", async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    await openProposal(proposal, fixture.ward);

    const panel = dugoutPanel();
    const entries = dugout(proposal.board, fixture.ward);
    expect(entries.length).toBeGreaterThan(0);
    expect(within(panel).getByRole('heading', { name: `Dugout · ${String(entries.length)}` })).toBeInTheDocument();
    const rows = [...panel.querySelectorAll('article[data-member-id]')].map((row) => row.getAttribute('data-member-id'));
    expect(rows).toEqual(entries.slice(0, 6).map((entry) => entry.memberId));

    // The panel and the canvas share one drag-and-drop surface.
    const canvas = screen.getByRole('region', { name: 'Board canvas' });
    const surface = canvas.closest('.wb-dnd-surface');
    expect(surface).not.toBeNull();
    expect(surface).toContainElement(panel);
    expect(surface).toHaveAttribute('data-dnd-enabled', 'true');
  });

  it('a committed drop sends its ops in order and waits for each', async () => {
    const { harness, socket, proposal, ivy, secretary } = await dropIvyOnSecretary();

    const first = opFrames(harness);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: 'placeInPosition',
      baseVersion: proposal.board.version,
      request: { memberId: ivy, from: null, to: secretary },
    });

    const placed = expectOk(
      placeInPosition(proposal.board, { ward: fixture.ward, ids: sequentialIds('srv') }, { memberId: ivy, from: null, to: secretary }),
    );
    commitFrame(socket, first[0]?.requestId ?? '', { ...placed, version: proposal.board.version + 1 });
    await settle();

    const frames = opFrames(harness);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      kind: 'approvePlacement',
      baseVersion: proposal.board.version + 1,
      request: { memberId: ivy, positionId: secretary },
    });
    expect(screen.queryByText(/Couldn't apply the change/)).toBeNull();
  });

  it('a refused op stops the sequence and shows the alert', async () => {
    const { harness, socket } = await dropIvyOnSecretary();
    const first = opFrames(harness);
    expect(first).toHaveLength(1);

    act(() => {
      socket.receive({ type: 'rejected', requestId: first[0]?.requestId, code: 'invalid_operation', message: 'Fictional refusal' });
    });
    await settle();

    expect(opFrames(harness)).toHaveLength(1);
    const alert = screen.getAllByRole('alert').find((node) => node.textContent.includes("Couldn't apply the change"));
    expect(alert).toHaveTextContent("Couldn't apply the change: Fictional refusal");
  });

  it('an offline failure stops the sequence and leaves the message to the sync banner', async () => {
    const { harness, socket } = await dropIvyOnSecretary();
    expect(opFrames(harness)).toHaveLength(1);

    act(() => {
      socket.close(1006);
    });
    await settle();

    expect(opFrames(harness)).toHaveLength(1);
    expect(screen.getByText("Offline. Changes can't be saved until the connection returns.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't apply the change/)).toBeNull();
  });

  describe('approval after addToList uses the server-committed position id (B-031)', () => {
    async function dropIvyOnFullTeachers(): Promise<
      Opened & { ward: Ward; board: Board; ivy: MemberId; teachers: AssignmentId; proposal: Proposal }
    > {
      const ward = wardNeedingApproval(fixture.ward, 'Ivy Notreal');
      const proposal = buildFixtureProposal(current, ward);
      const ivy = memberNamed(ward, 'Ivy Notreal');
      const teachers = assignmentIn(proposal.board, 'Relief Society Teachers', 'Relief Society Teacher');
      // Fill the list's last vacancy so the drop has to create a new position.
      const filler = dugout(proposal.board, ward).find((entry) => entry.memberId !== ivy);
      if (filler === undefined) throw new Error('no second dugout member');
      const board = expectOk(
        addToList(proposal.board, { ward, ids: sequentialIds('fill') }, { memberId: filler.memberId, from: null, assignmentId: teachers }),
      );
      expect(positionsOf(board, teachers).every((id) => board.placements[id] !== undefined)).toBe(true);

      const opened = await openProposal(proposal, ward, board);
      await zoomTo(opened.user, 'Relief Society', 'Relief Society Teachers');
      const jo = heldBy(board, teachers, memberNamed(ward, 'Jo Testwell'));
      drag(await dugoutRow(opened.user, ivy), slot(jo));
      await approve(opened.user);
      await settle();
      return { ...opened, ward, board, ivy, teachers, proposal };
    }

    it('sends approvePlacement with the position the server created', async () => {
      const { harness, socket, ward, board, ivy, teachers } = await dropIvyOnFullTeachers();
      const first = opFrames(harness);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ kind: 'addToList', request: { memberId: ivy, from: null, assignmentId: teachers } });

      // The server's id generator differs from the client's trial run.
      const committed = expectOk(addToList(board, { ward, ids: sequentialIds('server') }, { memberId: ivy, from: null, assignmentId: teachers }));
      const serverPosition = positionsOf(committed, teachers).find((id) => committed.placements[id] === ivy);
      if (serverPosition === undefined) throw new Error('server did not place Ivy');
      expect(Object.hasOwn(board.positions, serverPosition)).toBe(false);
      commitFrame(socket, first[0]?.requestId ?? '', { ...committed, version: board.version + 1 });
      await settle();

      const frames = opFrames(harness);
      expect(frames).toHaveLength(2);
      expect(frames[1]).toMatchObject({
        kind: 'approvePlacement',
        baseVersion: board.version + 1,
        request: { memberId: ivy, positionId: serverPosition },
      });
      expect(screen.queryByText(/Couldn't apply the change/)).toBeNull();
    });

    it('sends nothing and shows the alert when the committed board has no unapproved position for the member', async () => {
      const { harness, socket, board } = await dropIvyOnFullTeachers();
      const first = opFrames(harness);
      expect(first).toHaveLength(1);

      // Someone else's change wins: the committed board does not hold Ivy in the list.
      commitFrame(socket, first[0]?.requestId ?? '', { ...board, version: board.version + 1 });
      await settle();

      expect(opFrames(harness)).toHaveLength(1);
      const alert = screen.getAllByRole('alert').find((node) => node.textContent.includes("Couldn't apply the change"));
      expect(alert).toBeDefined();
    });
  });

  it('no drag on Current or Accepted', async () => {
    const user = userEvent.setup();
    const harness = mount();
    const socket = renderShell(harness);
    const accepted = buildFixtureProposal(current, fixture.ward, { id: proposalId('pr-0002'), name: 'Youth focus', tabOrder: 1 });
    showBoards(socket, [summaryOf(accepted, 'accepted')]);
    showSnapshot(socket, current, fixture.ward, null);

    const tryDrag = async (board: Board): Promise<void> => {
      await zoomToOrg(user, 'Relief Society');
      const gwen = heldBy(board, assignmentIn(board, 'Relief Society Presidency', 'First Counselor'), memberNamed(fixture.ward, 'Gwen Imaginary'));
      const hana = heldBy(board, assignmentIn(board, 'Relief Society Presidency', 'Second Counselor'), memberNamed(fixture.ward, 'Hana Madeup'));
      press(slot(gwen));
      moveOver(slot(hana));
      expect(ghost()).toBeNull();
      releaseOver(slot(hana));
      const ivy = await dugoutRow(user, memberNamed(fixture.ward, 'Ivy Notreal'));
      drag(ivy, slot(hana));
      expect(ghost()).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.querySelector('.wb-dnd-surface')).toHaveAttribute('data-dnd-enabled', 'false');
    };

    await tryDrag(current);
    await user.click(screen.getByRole('button', { name: 'Fit ward' }));
    await user.click(screen.getByRole('tab', { name: /Youth focus/ }));
    showSnapshot(socket, accepted.board, fixture.ward, viewOf(accepted, 'accepted'));
    await answerBaseline(harness, socket, accepted.baseline);
    await tryDrag(accepted.board);

    expect(opFrames(harness)).toEqual([]);
  });

  it('hover-open zooms the camera like a double-click', async () => {
    const proposal = buildFixtureProposal(current, fixture.ward);
    const { user } = await openProposal(proposal, fixture.ward);
    await user.dblClick(screen.getByRole('article', { name: 'Relief Society' }));
    expect(levelText()).toBe('Organization');
    const teachers = groupNamed(proposal.board, 'Relief Society Teachers');
    const row = document.querySelector(`[data-zoom-target="group:${teachers}"]`);
    if (row === null) throw new Error('missing Relief Society Teachers row');
    const ivy = await dugoutRow(user, memberNamed(fixture.ward, 'Ivy Notreal'));

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    press(ivy);
    moveOver(row);
    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(levelText()).toBe('Organization');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(levelText()).toBe('Group');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Relief Society Teachers');
    fireEvent.keyDown(window, { key: 'Escape' });
  });

  describe('search', () => {
    it('search navigates to a calling on another board', async () => {
      const proposal = buildFixtureProposal(current, fixture.ward);
      const livestream = assignmentIn(current, 'Other Ward Callings', 'Livestream Coordinator');
      // Only Current still has this title, so the one result belongs to Current.
      const renamed = withAssignmentTitle(proposal.board, livestream, 'Fictional Broadcast Lead');
      const { harness, socket, user } = await openProposal(proposal, fixture.ward, renamed);
      expect(screen.getByRole('tab', { name: proposal.name })).toHaveAttribute('aria-selected', 'true');

      await user.type(screen.getByRole('searchbox', { name: 'Search people, callings, tags' }), 'Livestream');
      await user.click(screen.getByRole('button', { name: 'All proposals & Current' }));
      const option = within(screen.getByRole('listbox', { name: 'Search results' })).getByRole('option', {
        name: /Livestream Coordinator/,
      });
      await user.click(option);

      expect(typedFrames(harness.sockets, 'subscribe').at(-1)).toEqual({ type: 'subscribe', boardId: current.id });
      expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'true');
      showSnapshot(socket, current, fixture.ward, null);
      expect(levelText()).toBe('Group');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Other Ward Callings');
    });

    it("a person result zooms to their first calling's group on the active board", async () => {
      const proposal = buildFixtureProposal(current, fixture.ward);
      const { harness, user } = await openProposal(proposal, fixture.ward);
      const search = screen.getByRole('searchbox', { name: 'Search people, callings, tags' });
      await user.type(search, 'Hal Testwell{Enter}');

      expect(levelText()).toBe('Group');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Temple and Family History');
      expect(screen.getByRole('tab', { name: proposal.name })).toHaveAttribute('aria-selected', 'true');
      expect(typedFrames(harness.sockets, 'subscribe').at(-1)).toEqual({ type: 'subscribe', boardId: proposal.board.id });
    });

    it('a person with no calling opens the dugout', async () => {
      const proposal = buildFixtureProposal(current, fixture.ward);
      const { user } = await openProposal(proposal, fixture.ward);
      await user.type(screen.getByRole('searchbox', { name: 'Search people, callings, tags' }), 'Ivy Notreal{Enter}');

      expect(levelText()).toBe('Ward');
      expect(dugoutPanel().closest('[data-editing-dugout]')).toBe(document.activeElement);
    });

    it('search Add to dugout sends addToDugout', async () => {
      const proposal = buildFixtureProposal(current, fixture.ward);
      const { harness, user } = await openProposal(proposal, fixture.ward);
      await user.type(screen.getByRole('searchbox', { name: 'Search people, callings, tags' }), 'Gwen Imaginary');
      const option = within(screen.getByRole('listbox', { name: 'Search results' })).getByRole('option', {
        name: /Gwen Imaginary/,
      });
      await user.click(within(option).getByRole('button', { name: 'Add to dugout' }));

      const frames = opFrames(harness);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        baseVersion: proposal.board.version,
        kind: 'addToDugout',
        request: { memberId: memberNamed(fixture.ward, 'Gwen Imaginary') },
      });
    });

    it('the header search keeps its accessible name before a board loads', () => {
      const harness = mount();
      renderShell(harness);
      expect(screen.getByRole('searchbox', { name: 'Search people, callings, tags' })).toBeInTheDocument();
    });
  });
});
