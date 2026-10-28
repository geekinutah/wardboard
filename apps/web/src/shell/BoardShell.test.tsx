import {
  boardId,
  diffBoards,
  proposalId,
  vacancies,
  type Board,
  type CallingGroupId,
  type Proposal,
} from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildPreviewData } from '../preview/data.ts';
import { buildFixtureProposal } from '../preview/ward-fixture.ts';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, Me, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const MINUS = '\u2212';

const data = buildPreviewData();
const acceptedProposal = buildFixtureProposal(data.current, data.ward, {
  id: proposalId('pr-0002'),
  name: 'Youth focus',
  tabOrder: 1,
});
function requireTeachersGroup(): (typeof data.proposal.board.callingGroups)[CallingGroupId] {
  const group = Object.values(data.proposal.board.callingGroups).find(
    (item) => item.name === 'Relief Society Teachers',
  );
  if (group === undefined) throw new Error('fixture is missing Relief Society Teachers');
  return group;
}

const teachersGroup = requireTeachersGroup();

const proposalDiff = diffBoards(data.proposal.baseline, data.proposal.board);
const proposalVacant = vacancies(data.proposal.board).length;
const currentVacant = vacancies(data.current).length;

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

type Harness = {
  client: SyncClient;
  sockets: FakeSocket[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function frames(socket: FakeSocket): unknown[] {
  return socket.sent.map((frame) => JSON.parse(frame) as unknown);
}

function typedFrames(sockets: readonly FakeSocket[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const frame of frames(socket)) {
      if (isRecord(frame) && frame.type === type) found.push(frame);
    }
  }
  return found;
}

function mount(): Harness {
  const sockets: FakeSocket[] = [];
  let nextId = 1;
  let request = 0;
  const pending = new Map<number, () => void>();
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout(fn) {
        const id = nextId;
        nextId += 1;
        pending.set(id, fn);
        return id;
      },
      clearTimeout(handle) {
        if (typeof handle === 'number') pending.delete(handle);
      },
    },
    requestIds: () => {
      request += 1;
      return `req-${String(request)}`;
    },
  };
  return { client: new SyncClient(deps), sockets };
}

function requireSocket(sockets: readonly FakeSocket[]): FakeSocket {
  const socket = sockets[sockets.length - 1];
  if (socket === undefined) throw new Error('expected a socket');
  return socket;
}

function renderShell(client: SyncClient): ReturnType<typeof render> {
  return render(
    <SyncProvider client={client}>
      <BoardShell healthClient={pendingHealth} />
    </SyncProvider>,
  );
}

function goLive(harness: Harness): FakeSocket {
  act(() => {
    harness.client.start();
    requireSocket(harness.sockets).open();
  });
  return requireSocket(harness.sockets);
}

function currentInfo(board: Board = data.current): CurrentInfo {
  return {
    boardId: board.id,
    version: board.version,
    importVersion: 'fixture',
    importedAt: IMPORTED_AT,
  };
}

function proposalView(proposal: Proposal, status: Proposal['status'] = proposal.status): ProposalView {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
  };
}

function proposalSummary(
  proposal: Proposal,
  status: Proposal['status'] = proposal.status,
  tabOrder = proposal.tabOrder,
): ProposalSummary {
  return {
    id: proposal.id,
    name: proposal.name,
    status,
    tabOrder,
    boardId: proposal.board.id,
    version: proposal.board.version,
    updatedAt: proposal.updatedAt,
  };
}

function fakeSummary(id: string, name: string, status: 'draft' | 'accepted', tabOrder: number): ProposalSummary {
  return {
    id: proposalId(id),
    name,
    status,
    tabOrder,
    boardId: boardId(`${id}-board`),
    version: 0,
    updatedAt: IMPORTED_AT,
  };
}

function showBoards(
  socket: FakeSocket,
  proposals: readonly ProposalSummary[],
  current: CurrentInfo | null = currentInfo(),
): void {
  act(() => {
    socket.receive({ type: 'boards', current, proposals });
  });
}

function showSnapshot(socket: FakeSocket, board: Board, proposal: ProposalView | null, version = board.version): void {
  act(() => {
    socket.receive({
      type: 'snapshot',
      boardId: board.id,
      version,
      board,
      ward: data.ward,
      proposal,
    });
  });
}

function tabLabels(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent.replace(/\s+/g, ' ').trim());
}

function levelText(): string {
  const node = document.querySelector('.wb-canvas-level');
  if (node === null) throw new Error('missing canvas level');
  return node.textContent;
}

function layerTransform(): string {
  const layer = document.querySelector('.wb-canvas-layer');
  if (!(layer instanceof HTMLElement)) throw new Error('missing canvas layer');
  return layer.style.transform;
}

function lastRequestId(sockets: readonly FakeSocket[], type: string): string {
  const frame = typedFrames(sockets, type).at(-1);
  if (frame === undefined || typeof frame.requestId !== 'string') {
    throw new Error(`missing ${type} requestId`);
  }
  return frame.requestId;
}

async function receiveMe(socket: FakeSocket, sockets: readonly FakeSocket[], role: Me['role'], displayName: string): Promise<void> {
  const requestId = lastRequestId(sockets, 'whoami');
  await act(async () => {
    socket.receive({
      type: 'me',
      requestId,
      user: { login: 'ada@example.test', displayName, role },
    });
    await Promise.resolve();
  });
}

async function zoomToTeachers(user: UserEvent): Promise<void> {
  await user.dblClick(screen.getByRole('article', { name: 'Relief Society' }));
  expect(levelText()).toBe('Organization');
  const group = document.querySelector('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]');
  if (!(group instanceof HTMLElement)) throw new Error('missing Relief Society Teachers zoom target');
  await user.dblClick(group);
  expect(levelText()).toBe('Group');
}

function openSpring(socket: FakeSocket): void {
  showSnapshot(socket, data.proposal.board, proposalView(data.proposal));
}

function renameTeachers(board: Board, name: string): Board {
  const group = board.callingGroups[teachersGroup.id];
  if (group === undefined) throw new Error('missing teachers group on the committed board');
  return {
    ...board,
    callingGroups: {
      ...board.callingGroups,
      [teachersGroup.id]: { ...group, name },
    },
  };
}

function copyRecord<V>(
  record: Readonly<Record<string, V>>,
  drop: (key: string, value: V) => boolean,
): Record<string, V> {
  const next: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && !drop(key, value)) next[key] = value;
  }
  return next;
}

function withoutCallingGroup(board: Board, groupId: CallingGroupId): Board {
  const callingGroups = copyRecord(board.callingGroups, (key) => key === groupId);
  const removedAssignments = new Set<string>();
  const assignments = copyRecord(board.assignments, (key, assignment) => {
    if (assignment.groupId !== groupId) return false;
    removedAssignments.add(key);
    return true;
  });
  const removedPositions = new Set<string>();
  const positions = copyRecord(board.positions, (key, position) => {
    if (!removedAssignments.has(position.assignmentId)) return false;
    removedPositions.add(key);
    return true;
  });
  const placements = copyRecord(board.placements, (key) => removedPositions.has(key));
  return { ...board, callingGroups, assignments, positions, placements };
}

const springSummary = proposalSummary(data.proposal);
const acceptedSummary = proposalSummary(acceptedProposal, 'accepted');

describe('BoardShell', () => {
  it('tabs list Current first then proposals in tabOrder; Accepted shows its text', () => {
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [
      fakeSummary('pr-later', 'Later plan', 'draft', 5),
      fakeSummary('pr-spring', 'Spring adjustments', 'accepted', 0),
      fakeSummary('pr-middle', 'Middle draft', 'draft', 2),
    ]);

    expect(tabLabels()).toEqual([
      'Current imported Jul 1',
      'Spring adjustments Accepted',
      'Middle draft',
      'Later plan',
    ]);
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it('opens Current automatically on first boards message', () => {
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    expect(typedFrames(harness.sockets, 'subscribe')).toEqual([]);

    showBoards(socket, [springSummary]);
    expect(typedFrames(harness.sockets, 'subscribe')).toEqual([{ type: 'subscribe', boardId: data.current.id }]);

    showBoards(socket, [springSummary]);
    expect(typedFrames(harness.sockets, 'subscribe')).toHaveLength(1);

    showSnapshot(socket, data.current, null);
    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.queryByText('Loading board…')).not.toBeInTheDocument();
    expect(levelText()).toBe('Ward');
  });

  it('selecting a proposal tab calls open with its boardId and marks it aria-selected', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary, acceptedSummary]);
    showSnapshot(socket, data.current, null);

    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));

    expect(typedFrames(harness.sockets, 'subscribe').at(-1)).toEqual({
      type: 'subscribe',
      boardId: data.proposal.board.id,
    });
    expect(typedFrames(harness.sockets, 'op')).toEqual([]);
    expect(screen.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Current/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('status strip: CURRENT + Imported date + vacant count; no callings/releases', () => {
    expect(currentVacant).toBeGreaterThan(0);
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);

    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.getByText('Imported Jul 1, 2026')).toBeInTheDocument();
    expect(screen.getByText(`${String(currentVacant)} vacant positions`)).toBeInTheDocument();
    expect(screen.queryByText(/suggested callings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/suggested releases/)).not.toBeInTheDocument();
  });

  it('status strip: PROPOSED with +callings/−releases from diffBoards once baseline loads', async () => {
    expect(proposalDiff.callings.length).toBeGreaterThan(0);
    expect(proposalDiff.releases.length).toBeGreaterThan(0);
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    openSpring(socket);

    expect(screen.getByText('PROPOSED')).toBeInTheDocument();
    expect(screen.getByText('Compared with its baseline')).toBeInTheDocument();
    expect(screen.getByText(`${String(proposalVacant)} vacant positions`)).toBeInTheDocument();
    expect(screen.queryByText(/suggested callings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/suggested releases/)).not.toBeInTheDocument();

    await act(async () => {
      socket.receive({
        type: 'board',
        requestId: lastRequestId(harness.sockets, 'getBoard'),
        board: data.proposal.baseline,
      });
      await Promise.resolve();
    });

    expect(screen.getByText(`+ ${String(proposalDiff.callings.length)} suggested callings`)).toBeInTheDocument();
    expect(
      screen.getByText(`${MINUS} ${String(proposalDiff.releases.length)} suggested releases`),
    ).toBeInTheDocument();
  });

  it('account shows displayName and role text; nothing while me is null', async () => {
    const first = mount();
    const firstView = renderShell(first.client);
    const firstSocket = goLive(first);
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByText('Ada Example')).not.toBeInTheDocument();
    expect(within(banner).queryByText('Admin')).not.toBeInTheDocument();
    expect(within(banner).queryByText('Editor')).not.toBeInTheDocument();

    await receiveMe(firstSocket, first.sockets, 'admin', 'Ada Example');
    expect(within(screen.getByRole('banner')).getByText('Ada Example')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Admin')).toBeInTheDocument();
    firstView.unmount();

    const second = mount();
    const view = render(
      <SyncProvider client={second.client}>
        <BoardShell healthClient={pendingHealth} />
      </SyncProvider>,
    );
    const secondSocket = goLive(second);
    await receiveMe(secondSocket, second.sockets, 'editor', 'Ben Editor');
    expect(within(screen.getByRole('banner')).getByText('Ben Editor')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Editor')).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByText('Admin')).not.toBeInTheDocument();
    view.unmount();
  });

  it('search input is present with its label on every level', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);

    const expectSearch = (): void => {
      expect(screen.getByRole('searchbox', { name: 'Search people, callings, tags' })).toHaveAttribute(
        'placeholder',
        'Search people, callings, tags',
      );
    };

    expectSearch();
    expect(levelText()).toBe('Ward');
    await zoomToTeachers(user);
    expectSearch();
    expect(levelText()).toBe('Group');
  });

  it('level 3 on Current and on Accepted is readOnly (no add controls)', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary, acceptedSummary]);
    showSnapshot(socket, data.current, null);

    await zoomToTeachers(user);
    expect(screen.queryByRole('button', { name: /Add position/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add group/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Youth focus Accepted' }));
    showSnapshot(socket, acceptedProposal.board, proposalView(acceptedProposal, 'accepted'));
    expect(levelText()).toBe('Ward');
    await zoomToTeachers(user);
    expect(screen.queryByRole('button', { name: /Add position/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add group/ })).not.toBeInTheDocument();
  });

  it('add position on a Draft proposal sends addAssignment with the emitted request', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    openSpring(socket);
    await zoomToTeachers(user);

    await user.click(screen.getByRole('button', { name: 'Add position to Relief Society Teachers' }));
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Fictional Chorister');
    await user.click(screen.getByRole('button', { name: /^Add position$/ }));

    expect(typedFrames(harness.sockets, 'op')).toEqual([
      {
        type: 'op',
        requestId: lastRequestId(harness.sockets, 'op'),
        boardId: data.proposal.board.id,
        baseVersion: data.proposal.board.version,
        op: {
          kind: 'addAssignment',
          request: {
            groupId: teachersGroup.id,
            title: 'Fictional Chorister',
            type: 'single',
            positionCount: 1,
          },
        },
      },
    ]);
  });

  it('a committed update keeps camera level, org, group and scale', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    openSpring(socket);
    await zoomToTeachers(user);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    const heading = screen.getByRole('heading', { level: 1 });
    await user.pointer([
      { keys: '[MouseLeft>]', target: heading, coords: { x: 8, y: 8 } },
      { coords: { x: 48, y: 28 } },
      { keys: '[/MouseLeft]' },
    ]);

    const before = layerTransform();
    expect(levelText()).toBe('Group');
    expect(before).toMatch(/scale\(1\.25\)/);
    expect(before).not.toMatch(/translate\(0px, 0px\)/);
    expect(heading).toHaveTextContent('Relief Society Teachers');

    act(() => {
      socket.receive({
        type: 'committed',
        boardId: data.proposal.board.id,
        version: data.proposal.board.version + 1,
        board: renameTeachers(data.proposal.board, 'Relief Society Teachers renamed'),
        requestId: 'ext-1',
        by: 'other@example.test',
      });
    });

    expect(levelText()).toBe('Group');
    expect(layerTransform()).toBe(before);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Relief Society · Relief Society Teachers renamed');
  });

  it('switching tabs resets camera to level 1; deleted open group falls back one level', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    openSpring(socket);
    await zoomToTeachers(user);

    await user.click(screen.getByRole('tab', { name: /Current/ }));
    showSnapshot(socket, data.current, null);
    expect(levelText()).toBe('Ward');

    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    openSpring(socket);
    await zoomToTeachers(user);
    expect(levelText()).toBe('Group');

    act(() => {
      socket.receive({
        type: 'committed',
        boardId: data.proposal.board.id,
        version: data.proposal.board.version + 1,
        board: withoutCallingGroup(data.proposal.board, teachersGroup.id),
        requestId: 'ext-2',
        by: 'other@example.test',
      });
    });

    expect(levelText()).toBe('Organization');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Relief Society');
    expect(screen.queryByRole('heading', { level: 1, name: /Relief Society Teachers/ })).not.toBeInTheDocument();
  });

  it('Loading board… before snapshot', () => {
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    expect(screen.getByText('Loading board…')).toBeInTheDocument();
    showBoards(socket, [springSummary]);
    expect(screen.getByText('Loading board…')).toBeInTheDocument();
    showSnapshot(socket, data.current, null);
    expect(screen.queryByText('Loading board…')).not.toBeInTheDocument();
  });

  it('no proposals lists only the Current tab', () => {
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, []);

    expect(tabLabels()).toEqual(['Current imported Jul 1']);
    expect(screen.queryByRole('tab', { name: 'Spring adjustments' })).not.toBeInTheDocument();
  });

  it('no Current lists only proposals and does not open a board', () => {
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [acceptedSummary, springSummary], null);

    expect(screen.queryByRole('tab', { name: /Current/ })).not.toBeInTheDocument();
    expect(tabLabels()).toEqual(['Spring adjustments', 'Youth focus Accepted']);
    expect(typedFrames(harness.sockets, 'subscribe')).toEqual([]);
    expect(screen.getByText('Loading board…')).toBeInTheDocument();
  });

  it('an add rejected by the server shows the existing notice', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    openSpring(socket);
    await zoomToTeachers(user);
    await user.click(screen.getByRole('button', { name: 'Add position to Relief Society Teachers' }));
    await user.type(screen.getByRole('textbox', { name: 'Calling title' }), 'Fictional Chorister');
    await user.click(screen.getByRole('button', { name: /^Add position$/ }));

    const requestId = lastRequestId(harness.sockets, 'op');
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId,
        code: 'invalid_operation',
        message: 'Title is not allowed',
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Your change was not applied: Title is not allowed');
  });
});
