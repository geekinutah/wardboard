import {
  boardGroupId,
  proposalId,
  type Board,
  type MemberId,
  type Proposal,
  type Ward,
} from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { HealthClient, HealthResponse } from '../health.ts';
import { buildPreviewData } from '../preview/data.ts';
import { buildFixtureProposal } from '../preview/ward-fixture.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

const data = buildPreviewData();

const acceptedProposal = buildFixtureProposal(data.current, data.ward, {
  id: proposalId('pr-0002'),
  name: 'Youth focus',
  tabOrder: 1,
});

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

function showSnapshot(
  socket: FakeSocket,
  board: Board,
  proposal: ProposalView | null,
  ward: Ward = data.ward,
  version = board.version,
): void {
  act(() => {
    socket.receive({
      type: 'snapshot',
      boardId: board.id,
      version,
      board,
      ward,
      proposal,
    });
  });
}

function levelText(): string {
  const node = document.querySelector('.wb-canvas-level');
  if (node === null) throw new Error('missing canvas level');
  return node.textContent;
}

describe('board-levels and removed markers', () => {
  it('Aaronic board group renders AaronicView at level 2; others render OrganizationView', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Zoom into Aaronic Priesthood
    const aaronicTile = screen.getByRole('article', { name: 'Young Men / Aaronic Priesthood' });
    await user.dblClick(aaronicTile);
    expect(levelText()).toBe('Organization');

    // AaronicView has the bishop's fixed linked card
    expect(screen.getByText('Presides by office · linked from Bishopric')).toBeInTheDocument();
    expect(document.querySelector('.wb-aaronic')).toBeInTheDocument();

    // Zoom back out to Ward level
    await user.click(screen.getByRole('button', { name: 'Fit ward' }));
    expect(levelText()).toBe('Ward');

    // Zoom into Relief Society
    const rsTile = screen.getByRole('article', { name: 'Relief Society' });
    await user.dblClick(rsTile);
    expect(levelText()).toBe('Organization');

    // OrganizationView does not have the bishop's linked card
    expect(screen.queryByText('Presides by office · linked from Bishopric')).not.toBeInTheDocument();
    expect(document.querySelector('.wb-org-view')).toBeInTheDocument();
  });

  it("changing Overseen by sends setOversight once with the view's request", async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Zoom into Aaronic Priesthood
    await user.dblClick(screen.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }));
    expect(levelText()).toBe('Organization');

    // Find the "Change" button for an editable quorum (e.g. Teachers Quorum or Deacons Quorum)
    const firstChange = screen.getAllByRole('button', { name: 'Change' })[0];
    if (firstChange === undefined) throw new Error('missing Change button');
    await user.click(firstChange);

    // Change overseer option to Second Counselor (Teachers Quorum is initially First Counselor)
    const secondCounselorRadio = screen.getByRole('radio', { name: 'Second Counselor' });
    await user.click(secondCounselorRadio);

    // Click Confirm
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // Verify setOversight op was sent
    const opFrames = typedFrames(harness.sockets, 'op');
    const setOversightFrames = opFrames.filter(
      (f) => isRecord(f.op) && f.op.kind === 'setOversight',
    );
    expect(setOversightFrames).toHaveLength(1);
    const firstFrame = setOversightFrames[0];
    if (firstFrame === undefined || !isRecord(firstFrame.op) || !isRecord(firstFrame.op.request)) {
      throw new Error('missing setOversight op');
    }
    expect(firstFrame.op.request.overseer).toBe('second_counselor');
  });

  it('Accepted and Current render the Aaronic view read-only', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    // Current board
    showBoards(socket, [proposalSummary(acceptedProposal, 'accepted')]);
    showSnapshot(socket, data.current, null);

    // Zoom into Aaronic Priesthood on Current
    await user.dblClick(screen.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }));
    expect(levelText()).toBe('Organization');
    expect(document.querySelector('.wb-aaronic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();

    // Switch to Accepted proposal
    await user.click(screen.getByRole('tab', { name: /Youth focus Accepted/ }));
    showSnapshot(socket, acceptedProposal.board, proposalView(acceptedProposal, 'accepted'));

    // Zoom into Aaronic Priesthood on Accepted
    await user.dblClick(screen.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }));
    expect(levelText()).toBe('Organization');
    expect(document.querySelector('.wb-aaronic')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  it('a proposal with a removed member shows the summary and the marked card', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    // Place member 'm-0001' into proposal, but mark them removed in ward
    const placedMemberId = 'm-0001' as MemberId;
    const member1 = data.ward.members[placedMemberId];
    if (member1 === undefined) throw new Error('missing member m-0001');
    const removedWard: Ward = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [placedMemberId]: {
          ...member1,
          removedDate: '2026-10-24',
        },
      },
    };

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null, removedWard);
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal), removedWard);

    // Handle baseline fetch
    const getBoardFrames = typedFrames(harness.sockets, 'getBoard');
    for (const frame of getBoardFrames) {
      if (frame.boardId === data.proposal.baseline.id) {
        socket.receive({
          type: 'board',
          requestId: frame.requestId,
          board: data.proposal.baseline,
        });
      } else if (frame.boardId === data.current.id) {
        socket.receive({
          type: 'board',
          requestId: frame.requestId,
          board: data.current,
        });
      }
    }

    // Await state updates
    await act(async () => {
      await Promise.resolve();
    });

    // Check RemovedSummary above canvas
    const summaryHeading = await screen.findByRole('heading', {
      name: /Removed from Current since this baseline/,
    });
    expect(summaryHeading).toBeInTheDocument();
    expect(screen.getByText(/Ward member removed/)).toBeInTheDocument();

    // Zoom into the group where the member is placed to see REMOVED card treatment
    // Member m-0001 is John Sample, Bishop in Bishopric
    await user.dblClick(screen.getByRole('article', { name: 'Bishopric' }));
    expect(levelText()).toBe('Organization');
    expect(screen.getAllByText('REMOVED').length).toBeGreaterThan(0);
  });

  it('Current shows no removed summary', () => {
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    // Ward with a removed member
    const placedMemberId = 'm-0001' as MemberId;
    const member1 = data.ward.members[placedMemberId];
    if (member1 === undefined) throw new Error('missing member m-0001');
    const removedWard: Ward = {
      ...data.ward,
      members: {
        ...data.ward.members,
        [placedMemberId]: {
          ...member1,
          removedDate: '2026-10-24',
        },
      },
    };

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null, removedWard);

    expect(screen.queryByRole('heading', { name: /Removed from Current since this baseline/ })).not.toBeInTheDocument();
  });

  it('Current board is fetched once per Current id', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Expect getBoard for current board
    const currentFetches = () =>
      typedFrames(harness.sockets, 'getBoard').filter((f) => f.boardId === data.current.id);

    expect(currentFetches()).toHaveLength(1);
    const firstFetch = currentFetches()[0];
    if (firstFetch === undefined || typeof firstFetch.requestId !== 'string') {
      throw new Error('missing getBoard requestId');
    }
    const firstReqId = firstFetch.requestId;

    // Respond with current board
    act(() => {
      socket.receive({
        type: 'board',
        requestId: firstReqId,
        board: data.current,
      });
    });

    // Switch to Current tab
    const currentTab = screen.getByRole('tab', { name: /Current imported/ });
    await user.click(currentTab);
    showSnapshot(socket, data.current, null);

    // Switch back to Proposal tab
    const proposalTab = screen.getByRole('tab', { name: data.proposal.name });
    await user.click(proposalTab);
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Verify no additional getBoard was sent for the current board
    expect(currentFetches()).toHaveLength(1);
  });

  it('no Aaronic group present (renders like any org; add a test)', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    // Create board where Aaronic group has a generic key
    const customId = boardGroupId('bg-custom');
    const customBoard: Board = {
      ...data.proposal.board,
      boardGroups: {
        ...data.proposal.board.boardGroups,
        [customId]: {
          id: customId,
          name: 'Custom Group',
          order: 10,
          visible: true,
        },
      },
    };

    showBoards(socket, [proposalSummary({ ...data.proposal, board: customBoard })]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, customBoard, proposalView(data.proposal));

    // Zoom into Custom Group
    await user.dblClick(screen.getByRole('article', { name: 'Custom Group' }));
    expect(levelText()).toBe('Organization');

    // Renders OrganizationView, not AaronicView
    expect(document.querySelector('.wb-org-view')).toBeInTheDocument();
    expect(document.querySelector('.wb-aaronic')).not.toBeInTheDocument();
  });

  it('clicking the linked bishop in AaronicView zooms camera to Bishopric', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    showBoards(socket, [proposalSummary(data.proposal)]);
    showSnapshot(socket, data.current, null);
    await user.click(screen.getByRole('tab', { name: data.proposal.name }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Zoom into Aaronic Priesthood
    await user.dblClick(screen.getByRole('article', { name: 'Young Men / Aaronic Priesthood' }));
    expect(levelText()).toBe('Organization');

    // Click the linked bishop card
    const linkedBishop = screen.getByRole('button', {
      name: /Presides by office · linked from Bishopric/,
    });
    await user.click(linkedBishop);

    // Camera zooms to Bishopric board group
    expect(levelText()).toBe('Organization');
    expect(document.querySelector('.wb-org-view')).toBeInTheDocument();
    expect(screen.getByText('Bishopric')).toBeInTheDocument();
    expect(screen.getByText('Clerks and Secretaries (support roles)')).toBeInTheDocument();
  });
});
