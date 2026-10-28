import {
  positionId,
  memberId,
  type Board,
  type Proposal,
} from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

async function answerBoardRequest(harness: Harness, socket: FakeSocket, boardId: string, board: Board): Promise<void> {
  const frame = typedFrames(harness.sockets, 'getBoard').find((f) => f.boardId === boardId);
  if (frame === undefined || typeof frame.requestId !== 'string') throw new Error(`no getBoard request for ${boardId}`);
  const requestId = frame.requestId;
  await act(async () => {
    socket.receive({ type: 'board', requestId, board });
    await Promise.resolve();
  });
}

describe('T-082 proposal summary in app', () => {
  it('Summary button appears on proposals only', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    // Initial load: Current board
    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);

    // On Current: Summary button does not appear
    expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument();

    // Switch to Proposal tab
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // On Proposal: Summary button appears
    expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
  });

  it("opens with the proposal's net changes and Exit returns", async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);

    // Switch to Proposal
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Respond to baseline and current board fetches
    await answerBoardRequest(harness, socket, data.proposal.baseline.id, data.proposal.baseline);
    await answerBoardRequest(harness, socket, data.current.id, data.current);

    // Click Summary
    await user.click(screen.getByRole('button', { name: 'Summary' }));

    // Proposal summary heading and known suggested calling (Ivy Notreal) are visible
    expect(screen.getByRole('heading', { level: 1, name: data.proposal.name })).toBeInTheDocument();
    expect(screen.getByText('Ivy Notreal')).toBeInTheDocument();
    expect(screen.getByText(/Relief Society · Relief Society Teacher/)).toBeInTheDocument();

    // Click Exit (Back to board)
    await user.click(screen.getByRole('button', { name: '← Back to board' }));

    // Back on the board canvas
    expect(screen.queryByRole('heading', { level: 1, name: data.proposal.name })).not.toBeInTheDocument();
    expect(document.querySelector('.wb-canvas-level')).toBeInTheDocument();
  });

  it('updates live when an op commits', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);

    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    await answerBoardRequest(harness, socket, data.proposal.baseline.id, data.proposal.baseline);
    await answerBoardRequest(harness, socket, data.current.id, data.current);

    // Open Summary
    await user.click(screen.getByRole('button', { name: 'Summary' }));

    expect(screen.getByRole('heading', { level: 2, name: /\+ Suggested callings · 1/ })).toBeInTheDocument();

    // Add a second calling by placing another member into a vacant position
    const updatedBoard: Board = {
      ...data.proposal.board,
      version: data.proposal.board.version + 1,
      placements: {
        ...data.proposal.board.placements,
        [positionId('p-0020')]: memberId('m-0002'),
      },
    };

    act(() => {
      socket.receive({
        type: 'committed',
        boardId: data.proposal.board.id,
        version: updatedBoard.version,
        board: updatedBoard,
        requestId: 'req-commit-1',
        by: 'bishopric@example.test',
      });
    });

    // Summary should update live to show 2 suggested callings
    expect(screen.getByRole('heading', { level: 2, name: /\+ Suggested callings · 2/ })).toBeInTheDocument();
    expect(screen.getByText('Ben Example')).toBeInTheDocument();
  });

  it('switching tabs closes the summary', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);

    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    await answerBoardRequest(harness, socket, data.proposal.baseline.id, data.proposal.baseline);
    await answerBoardRequest(harness, socket, data.current.id, data.current);

    // Open Summary
    await user.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByRole('heading', { level: 1, name: data.proposal.name })).toBeInTheDocument();

    // Switch to Current tab
    await user.click(screen.getByRole('tab', { name: /Current/ }));
    showSnapshot(socket, data.current, null);

    // Summary is closed and canvas is shown
    expect(screen.queryByRole('heading', { level: 1, name: data.proposal.name })).not.toBeInTheDocument();
    expect(document.querySelector('.wb-canvas-level')).toBeInTheDocument();
  });

  it('shows Loading summary… until Current arrives', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);

    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Answer baseline, but DO NOT answer Current board yet
    await answerBoardRequest(harness, socket, data.proposal.baseline.id, data.proposal.baseline);

    // Click Summary while Current is still loading
    await user.click(screen.getByRole('button', { name: 'Summary' }));

    // Shows loading summary
    expect(screen.getByText('Loading summary…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: data.proposal.name })).not.toBeInTheDocument();

    // Now Current arrives
    await answerBoardRequest(harness, socket, data.current.id, data.current);

    // Summary finishes loading and renders
    expect(screen.queryByText('Loading summary…')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: data.proposal.name })).toBeInTheDocument();
  });
});
