import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Proposal, Ward } from '@wardboard/core';
import type { ProposalSummary } from '@wardboard/server';
import { buildPreviewData } from '../preview/data.ts';
import type { HealthClient, HealthResponse } from '../health.ts';
import { SyncClient, type SyncDeps, type WebSocketLike } from '../sync/client.ts';
import type { CurrentInfo, Me, ProposalView } from '../sync/protocol.ts';
import { SyncProvider } from '../sync/react.tsx';
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

const REF = `${'ab'.repeat(32)}.png`;
const NEW_REF = `${'cd'.repeat(32)}.png`;
const EDITOR: Me = { login: 'ben@example.test', displayName: 'Ben Editor', role: 'editor' };
const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

function png(): File {
  return new File([PNG_BYTES], 'jay.png', { type: 'image/png' });
}

function wardWithPhoto(photoRef: string | null): Ward {
  const jay = Object.values(data.ward.members).find((m) => m.name === 'Jay Storybook');
  if (jay === undefined) throw new Error('missing Jay Storybook');
  return { ...data.ward, members: { ...data.ward.members, [jay.id]: { ...jay, photoRef } } };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  });
}

async function start(ward: Ward = data.ward) {
  const user = userEvent.setup();
  const harness = mount();
  renderShell(harness.client);
  const socket = goLive(harness);
  const whoami = typedFrames(harness.sockets, 'whoami').at(-1);
  if (whoami === undefined) throw new Error('no whoami frame');
  await act(async () => {
    socket.receive({ type: 'me', requestId: String(whoami.requestId), user: EDITOR });
    await Promise.resolve();
  });
  showBoards(socket, [springSummary]);
  showSnapshot(socket, data.current, null, ward);
  await user.click(screen.getByText('Jay Storybook · Adult'));
  return { user, harness, socket };
}

function lastUpdate(harness: Harness): Record<string, unknown> {
  const frame = typedFrames(harness.sockets, 'updateMember').at(-1);
  if (frame === undefined) throw new Error('no updateMember frame');
  return frame;
}

describe('person panel photo upload', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ photoRef: NEW_REF }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:incoming', revokeObjectURL: () => undefined }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('panel offers upload for the selected member on Current and on a Draft', async () => {
    const { user, socket } = await start();
    expect(screen.getByLabelText('Upload photo for Jay Storybook')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Spring adjustments' }));
    showSnapshot(socket, data.proposal.board, proposalView(data.proposal));
    await user.click(screen.getByText('Jay Storybook · Adult'));
    expect(screen.getByLabelText('Upload photo for Jay Storybook')).toBeInTheDocument();
  });

  it('first photo uploads and assigns through the sync client', async () => {
    const { user, harness, socket } = await start();
    await user.upload(screen.getByLabelText('Upload photo for Jay Storybook'), png());
    await waitFor(() => {
      expect(typedFrames(harness.sockets, 'updateMember')).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const jay = Object.values(data.ward.members).find((m) => m.name === 'Jay Storybook');
    expect(lastUpdate(harness)).toMatchObject({ memberId: jay?.id, patch: { photoRef: NEW_REF } });
    expect(Object.keys((lastUpdate(harness).patch as object))).toEqual(['photoRef']);
    act(() => {
      socket.receive({ type: 'memberUpdated', requestId: String(lastUpdate(harness).requestId) });
    });
    expect(await screen.findByText('Photo added for Jay Storybook')).toBeInTheDocument();
  });

  it('replacement compares against the stored portrait', async () => {
    const { user } = await start(wardWithPhoto(REF));
    await user.upload(screen.getByLabelText('Upload photo for Jay Storybook'), png());
    const dialog = await screen.findByRole('dialog', { name: "Replace Jay Storybook's photo?" });
    expect(fetchMock).not.toHaveBeenCalled();
    const current = screen.getAllByRole('img', { name: 'Current portrait of Jay Storybook' });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('src', `/api/photos/${REF}`);
    expect(dialog).toBeInTheDocument();
  });

  it('a refused assign shows its message', async () => {
    const { user, harness, socket } = await start();
    await user.upload(screen.getByLabelText('Upload photo for Jay Storybook'), png());
    await waitFor(() => {
      expect(typedFrames(harness.sockets, 'updateMember')).toHaveLength(1);
    });
    act(() => {
      socket.receive({
        type: 'rejected',
        requestId: String(lastUpdate(harness).requestId),
        code: 'permission_denied',
        message: 'Not allowed',
      });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed');
  });

  it('a ward update shows the new portrait', async () => {
    const { socket } = await start(wardWithPhoto(REF));
    expect(screen.getByRole('img', { name: 'Portrait of Jay Storybook' })).toHaveAttribute('src', `/api/photos/${REF}`);
    act(() => {
      socket.receive({ type: 'ward', ward: wardWithPhoto(NEW_REF) });
    });
    await settle();
    expect(screen.getByRole('img', { name: 'Portrait of Jay Storybook' })).toHaveAttribute(
      'src',
      `/api/photos/${NEW_REF}`,
    );
  });
});
