import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type {
  Board,
  Proposal,
  Ward,
} from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { buildPreviewData } from '../preview/data.ts';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, ProposalView } from '../sync/protocol.ts';
import { SyncProvider, useSyncClient } from '../sync/react.tsx';
import { BoardShell } from './BoardShell.tsx';

const IMPORTED_AT = '2026-07-01T00:00:00.000Z';
const pendingHealth: HealthClient = () => new Promise<HealthResponse>(() => undefined);

const data = buildPreviewData();

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

const springSummary = proposalSummary(data.proposal);

async function openProposal(socket: FakeSocket, user: ReturnType<typeof userEvent.setup>): Promise<void> {
  showBoards(socket, [springSummary]);
  showSnapshot(socket, data.current, null);
  await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
  showSnapshot(socket, data.proposal.board, proposalView(data.proposal));
}

async function zoomToTeachers(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.dblClick(screen.getByRole('article', { name: 'Relief Society' }));
  const group = document.querySelector('[data-zoom-target^="group:"][aria-label="Relief Society Teachers"]');
  if (!(group instanceof HTMLElement)) throw new Error('missing Relief Society Teachers zoom target');
  await user.dblClick(group);
}

describe('person-panel', () => {
  it('useSyncClient returns the provider\'s client and throws outside SyncProvider', () => {
    expect(() => {
      renderHook(() => useSyncClient());
    }).toThrow('useSyncClient must be used within SyncProvider');

    const harness = mount();
    const { result } = renderHook(() => useSyncClient(), {
      wrapper: ({ children }) => <SyncProvider client={harness.client}>{children}</SyncProvider>,
    });
    expect(result.current).toBe(harness.client);
  });

  it('clicking a member card opens the inspector for that member', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    await openProposal(socket, user);
    await zoomToTeachers(user);

    // Ivy Notreal is placed in Relief Society Teachers
    const ivyCard = document.querySelector('[data-member-id="m-0035"]');
    if (!(ivyCard instanceof HTMLElement)) throw new Error('Ivy Notreal card missing');

    await user.click(ivyCard);

    expect(screen.getByRole('complementary', { name: 'Person: Ivy Notreal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Ivy Notreal' })).toBeInTheDocument();
  });

  it('double-click opens notes; save sends updateMember with the trimmed note', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    await openProposal(socket, user);
    await zoomToTeachers(user);

    const ivyCard = document.querySelector('[data-member-id="m-0035"]');
    if (!(ivyCard instanceof HTMLElement)) throw new Error('Ivy Notreal card missing');

    // Double-click opens notes
    await user.dblClick(ivyCard);

    expect(screen.getByRole('dialog', { name: 'Notes · Ivy Notreal' })).toBeInTheDocument();
    const textarea = screen.getByRole('textbox', { name: 'Note' });

    await user.clear(textarea);
    await user.type(textarea, '  Prefers mornings  ');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const updateFrames = typedFrames(harness.sockets, 'updateMember');
    expect(updateFrames).toHaveLength(1);
    const firstFrame = updateFrames[0];
    if (firstFrame === undefined) throw new Error('missing update frame');
    expect(firstFrame).toMatchObject({
      type: 'updateMember',
      memberId: 'm-0035',
      patch: { note: 'Prefers mornings' },
    });

    const requestId = String(firstFrame.requestId);
    act(() => {
      socket.receive({ type: 'memberUpdated', requestId });
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('a refused save shows the server message and keeps the dialog', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    await openProposal(socket, user);

    // Double-click on dugout row for Jay Storybook
    const jayRow = screen.getByText('Jay Storybook · Adult');
    await user.dblClick(jayRow);

    expect(screen.getByRole('dialog', { name: 'Notes · Jay Storybook' })).toBeInTheDocument();
    const textarea = screen.getByRole('textbox', { name: 'Note' });
    await user.type(textarea, ' extra note');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const updateFrames = typedFrames(harness.sockets, 'updateMember');
    expect(updateFrames).toHaveLength(1);
    const firstFrame = updateFrames[0];
    if (firstFrame === undefined) throw new Error('missing update frame');
    const requestId = String(firstFrame.requestId);

    act(() => {
      socket.receive({
        type: 'rejected',
        requestId,
        code: 'permission_denied',
        message: 'Editor cannot edit this note',
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save the note: Editor cannot edit this note');
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('inspector Add to dugout sends addToDugout; hidden on Current', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    const jay = Object.values(data.ward.members).find((m) => m.name === 'Jay Storybook');
    if (!jay) throw new Error('missing Jay Storybook in fixture');

    // On Current:
    showBoards(socket, [springSummary]);
    showSnapshot(socket, data.current, null);

    // Jay Storybook is in the dugout
    await user.click(screen.getByText('Jay Storybook · Adult'));

    expect(screen.getByRole('complementary', { name: 'Person: Jay Storybook' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to dugout' })).not.toBeInTheDocument();

    // Switch to proposal:
    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));

    // Open inspector on proposal:
    await user.click(screen.getByText('Jay Storybook · Adult'));

    const addBtn = screen.getByRole('button', { name: 'Add to dugout' });
    expect(addBtn).toBeInTheDocument();

    await user.click(addBtn);

    const opFrames = typedFrames(harness.sockets, 'op');
    const addOps = opFrames.filter((f) => isRecord(f.op) && f.op.kind === 'addToDugout');
    expect(addOps).toHaveLength(1);
    const firstOp = addOps[0];
    if (firstOp === undefined) throw new Error('missing addToDugout op');
    expect(firstOp.op).toMatchObject({
      kind: 'addToDugout',
      request: { memberId: jay.id },
    });
  });

  it('Escape and Close clear the inspector', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    await openProposal(socket, user);

    // Click dugout row for Jay Storybook
    await user.click(screen.getByText('Jay Storybook · Adult'));
    expect(screen.getByRole('complementary', { name: 'Person: Jay Storybook' })).toBeInTheDocument();

    // Close button clears inspector
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: /Person:/ })).not.toBeInTheDocument();

    // Reopen inspector
    await user.click(screen.getByText('Jay Storybook · Adult'));
    expect(screen.getByRole('complementary', { name: 'Person: Jay Storybook' })).toBeInTheDocument();

    // Escape clears inspector
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: /Person:/ })).not.toBeInTheDocument();
  });

  it('the note body never appears in the shell outside the dialog', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    await openProposal(socket, user);

    // Select Jay Storybook
    await user.click(screen.getByText('Jay Storybook · Adult'));
    expect(screen.getByRole('complementary', { name: 'Person: Jay Storybook' })).toBeInTheDocument();

    const noteText = 'Travels for work most weekdays in March.';
    expect(document.body.innerHTML).not.toContain(noteText);

    // Open notes from inspector
    await user.click(screen.getByRole('button', { name: 'Open notes' }));
    expect(screen.getByRole('dialog', { name: 'Notes · Jay Storybook' })).toBeInTheDocument();
    expect(document.body.innerHTML).toContain(noteText);
  });

  it('member removed from the ward while selected', async () => {
    const user = userEvent.setup();
    const harness = mount();
    renderShell(harness.client);
    const socket = goLive(harness);

    const jay = Object.values(data.ward.members).find((m) => m.name === 'Jay Storybook');
    if (!jay) throw new Error('missing Jay Storybook in fixture');

    await openProposal(socket, user);

    // Click dugout row for Jay Storybook
    await user.click(screen.getByText('Jay Storybook · Adult'));
    expect(screen.getByRole('complementary', { name: 'Person: Jay Storybook' })).toBeInTheDocument();

    // Ward push removing Jay Storybook
    const membersWithoutJay = Object.fromEntries(
      Object.entries(data.ward.members).filter(([id]) => id !== jay.id),
    );
    const wardWithoutJay: Ward = {
      ...data.ward,
      members: membersWithoutJay,
    };

    act(() => {
      socket.receive({ type: 'ward', ward: wardWithoutJay });
    });

    await waitFor(() => {
      expect(screen.getByText('This person is not in the ward.')).toBeInTheDocument();
    });
  });
});
