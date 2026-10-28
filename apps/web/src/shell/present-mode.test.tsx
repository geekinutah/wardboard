import { diffBoards, wardOverview, type Board, type Member, type Ward } from '@wardboard/core';
import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildPreviewData } from '../preview/data.ts';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';

const data = buildPreviewData();

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

function lastRequestId(sockets: readonly FakeSocket[], type: string): string {
  const frame = typedFrames(sockets, type).at(-1);
  if (frame === undefined || typeof frame.requestId !== 'string') {
    throw new Error(`missing ${type} requestId`);
  }
  return frame.requestId;
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

function proposalView(proposal: (typeof data.proposal)): ProposalView {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    rationale: proposal.rationale,
    baselineBoardId: proposal.baseline.id,
  };
}

function proposalSummary(proposal: (typeof data.proposal)): {
  id: (typeof data.proposal)['id'];
  name: string;
  status: 'draft' | 'accepted';
  tabOrder: number;
  boardId: Board['id'];
  version: number;
  updatedAt: string;
} {
  return {
    id: proposal.id,
    name: proposal.name,
    status: proposal.status,
    tabOrder: proposal.tabOrder,
    boardId: proposal.board.id,
    version: proposal.board.version,
    updatedAt: proposal.updatedAt,
  };
}

const springSummary = proposalSummary(data.proposal);

function showBoards(socket: FakeSocket): void {
  act(() => {
    socket.receive({ type: 'boards', current: currentInfo(), proposals: [springSummary] });
  });
}

function openSpring(socket: FakeSocket): void {
  act(() => {
    socket.receive({
      type: 'snapshot',
      boardId: data.proposal.board.id,
      version: data.proposal.board.version,
      board: data.proposal.board,
      ward: data.ward,
      proposal: proposalView(data.proposal),
    });
  });
}

function levelText(): string {
  const node = document.querySelector('.wb-canvas-level');
  if (node === null) throw new Error('missing canvas level');
  return node.textContent;
}

/** Reply to the `getSettings` request the shell makes when it goes live. */
function respondToSettings(socket: FakeSocket, harness: Harness, showNeedsApproval: boolean): void {
  act(() => {
    socket.receive({ type: 'settings', requestId: lastRequestId(harness.sockets, 'getSettings'), showNeedsApproval });
  });
}

/** Reply to the baseline `getBoard` fetch so the presentation gets its baseline. */
async function respondToBaseline(socket: FakeSocket, harness: Harness): Promise<void> {
  await act(async () => {
    socket.receive({
      type: 'board',
      requestId: lastRequestId(harness.sockets, 'getBoard'),
      board: data.proposal.baseline,
    });
    await Promise.resolve();
  });
}

/** Open the fixture proposal, wait for the board, and click Present. */
async function presentProposal(user: UserEvent, harness: Harness): Promise<FakeSocket> {
  const socket = goLive(harness);
  showBoards(socket);
  act(() => {
    socket.receive({
      type: 'snapshot',
      boardId: data.current.id,
      version: data.current.version,
      board: data.current,
      ward: data.ward,
      proposal: null,
    });
  });
  await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
  openSpring(socket);
  respondToSettings(socket, harness, false);
  await respondToBaseline(socket, harness);
  await user.click(screen.getByRole('button', { name: 'Present' }));
  return socket;
}

function expectPresented(): void {
  expect(screen.getByRole('heading', { level: 1, name: 'Spring adjustments' })).toBeInTheDocument();
  expect(screen.getByText('PROPOSED', { exact: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Exit presentation' })).toBeInTheDocument();
}

function expectChromeHidden(): void {
  expect(screen.queryByRole('searchbox', { name: 'Search people, callings, tags' })).not.toBeInTheDocument();
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(document.querySelector('.shell-header')).toBeNull();
  expect(document.querySelector('.shell-status-strip')).toBeNull();
  expect(document.querySelector('.wb-canvas')).toBeNull();
}

function expectShellRestored(): void {
  expect(screen.getByRole('searchbox', { name: 'Search people, callings, tags' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Spring adjustments' })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('.shell-header')).not.toBeNull();
}

/** Stub the Fullscreen API on the document. `granted` resolves, `refused` rejects. */
function stubFullscreen(granted: boolean): { request: ReturnType<typeof vi.fn>; exit: ReturnType<typeof vi.fn> } {
  const request = vi.fn(() =>
    granted ? Promise.resolve() : Promise.reject(new Error('NotAllowedError: fullscreen refused')),
  );
  const exit = vi.fn(() => Promise.resolve());
  const element = document.documentElement;
  Object.defineProperty(element, 'requestFullscreen', { value: request, writable: true, configurable: true });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => (granted ? element : null),
  });
  Object.defineProperty(document, 'exitFullscreen', { value: exit, writable: true, configurable: true });
  return { request, exit };
}

function restoreFullscreen(): void {
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  delete (document as unknown as Record<string, unknown>).exitFullscreen;
}

describe('Present mode', () => {
  it('Present hides the header and shows the presentation of the active board', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    await presentProposal(user, harness);

    expectPresented();
    expectChromeHidden();
    // The active board's leaders are presented.
    expect(screen.getByText('Ada Fictional')).toBeInTheDocument();
  });

  it('Exit and Escape return with the same tab and camera', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    await presentProposal(user, harness);

    // Exit first so the camera can be changed on the board.
    await user.keyboard('{Escape}');
    expectShellRestored();

    // Zoom to a group and change the scale so the camera is non-initial.
    await user.dblClick(screen.getByRole('article', { name: 'Relief Society' }));
    expect(levelText()).toBe('Organization');
    const group = document.querySelector('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]');
    if (!(group instanceof HTMLElement)) throw new Error('missing Relief Society Teachers zoom target');
    await user.dblClick(group);
    expect(levelText()).toBe('Group');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    const layer = document.querySelector('.wb-canvas-layer');
    if (!(layer instanceof HTMLElement)) throw new Error('missing canvas layer');
    const before = layer.style.transform;
    expect(before).toMatch(/scale\(1\.25\)/);

    await user.click(screen.getByRole('button', { name: 'Present' }));
    expectPresented();

    await user.keyboard('{Escape}');
    expectShellRestored();
    expect(levelText()).toBe('Group');
    const after = (document.querySelector('.wb-canvas-layer') as HTMLElement).style.transform;
    expect(after).toBe(before);

    // The footer Exit button returns the same way.
    await user.click(screen.getByRole('button', { name: 'Present' }));
    expectPresented();
    await user.click(screen.getByRole('button', { name: 'Exit presentation' }));
    expectShellRestored();
    expect(levelText()).toBe('Group');
    expect((document.querySelector('.wb-canvas-layer') as HTMLElement).style.transform).toBe(before);
  });

  it('Show Needs approval follows the server setting live', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = await presentProposal(user, harness);

    expectPresented();
    const ada = Object.values(data.ward.members).find((member) => member.name === 'Ada Fictional');
    if (ada === undefined) throw new Error('missing Ada Fictional in fixture ward');
    expect(screen.getByText('Ada Fictional')).toBeInTheDocument();
    expect(screen.queryByText('Needs approval')).not.toBeInTheDocument();

    // Another admin turns the setting on: the presentation updates while presenting.
    const ward: Ward = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [ada.id]: { ...ada, needsApproval: true },
      },
    };
    act(() => {
      socket.receive({ type: 'ward', ward });
      socket.receive({ type: 'settings', requestId: '', showNeedsApproval: true });
    });

    const leaderNode = screen.getByText('Ada Fictional').closest('.wb-presentation-leader');
    if (!(leaderNode instanceof HTMLElement)) throw new Error('missing Ada leader slot');
    expect(within(leaderNode).getByText('Needs approval')).toBeInTheDocument();
  });

  it('a committed op from another client appears while presenting', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = await presentProposal(user, harness);

    expectPresented();
    const board = data.proposal.board;
    const baseline = data.proposal.baseline;
    const vacantNow = new Set(
      Object.values(board.positions)
        .filter((position) => board.placements[position.id] === undefined)
        .map((position) => position.id),
    );
    const vacantLeader = wardOverview(board, baseline)
      .flatMap((tile) => tile.leaders)
      .find((leader) => leader.memberId === null && vacantNow.has(leader.positionId));
    if (vacantLeader === undefined) throw new Error('expected a leader slot vacant on board and baseline');
    const liv = Object.values(data.ward.members).find((member: Member) => member.name === 'Liv Example');
    if (liv === undefined) throw new Error('missing Liv Example in fixture ward');

    const callingsBefore = diffBoards(baseline, board).callings.length;
    const updated: Board = {
      ...board,
      placements: { ...board.placements, [vacantLeader.positionId]: liv.id },
    };
    const callingsAfter = diffBoards(baseline, updated).callings.length;
    expect(callingsAfter).toBe(callingsBefore + 1);

    act(() => {
      socket.receive({
        type: 'committed',
        boardId: board.id,
        version: board.version + 1,
        board: updated,
        requestId: 'ext-1',
        by: 'other@example.test',
      });
    });

    expectPresented();
    expect(screen.getByText('Liv Example')).toBeInTheDocument();
    expect(screen.getByText('Proposed')).toBeInTheDocument();
    expect(screen.getByText(`+${String(callingsAfter)} callings`)).toBeInTheDocument();
  });

  it('no note text renders while presenting', async () => {
    const user = userEvent.setup();
    const harness = mount();
    const view = renderShell(harness.client);
    await presentProposal(user, harness);

    expectPresented();
    // Sanity: the presentation is actually rendering leader slots.
    expect(screen.getByText('Ada Fictional')).toBeInTheDocument();
    const jay = Object.values(data.ward.members).find((member: Member) => member.name === 'Jay Storybook');
    if (jay?.note === null) throw new Error('fixture Jay Storybook no longer has a note');
    expect(jay?.note).toBe('Travels for work most weekdays in March.');
    expect(view.container.textContent).not.toContain(jay?.note ?? '');
    expect(view.container.innerHTML).not.toContain(jay?.note ?? '');
  });

  it('fullscreen refused keeps the presentation windowed', async () => {
    const { request } = stubFullscreen(false);
    try {
      const user = userEvent.setup();
      const harness = mount();
      renderShell(harness.client);
      await presentProposal(user, harness);

      expect(request).toHaveBeenCalledTimes(1);
      expectPresented();
      // Still exits cleanly.
      await user.keyboard('{Escape}');
      expectShellRestored();
    } finally {
      restoreFullscreen();
    }
  });

  it('requests fullscreen when presenting and releases it on exit', async () => {
    const { request, exit } = stubFullscreen(true);
    try {
      const user = userEvent.setup();
      const harness = mount();
      renderShell(harness.client);
      await presentProposal(user, harness);

      expect(request).toHaveBeenCalledTimes(1);
      expectPresented();
      await user.keyboard('{Escape}');
      expectShellRestored();
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      restoreFullscreen();
    }
  });
});
