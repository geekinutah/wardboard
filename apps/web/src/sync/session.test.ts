import type { Board, Ward } from '@wardboard/core';
import { describe, expect, it } from 'vitest';
import { REPLY_MS, SyncClient, type SyncDeps, type SyncState, type WebSocketLike } from './client.ts';
import type { ProposalView } from './protocol.ts';

const WARD = { id: 'ward-1' } as unknown as Ward;
const OTHER_WARD = { id: 'ward-2' } as unknown as Ward;
const PROPOSAL: ProposalView = {
  id: 'pr-1' as ProposalView['id'],
  name: 'Spring plan',
  status: 'draft',
  rationale: null,
  baselineBoardId: 'base-1' as ProposalView['baselineBoardId'],
};

class FakeSocket implements WebSocketLike {
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(data);
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

function board(id: string, kind: 'current' | 'proposal' | 'baseline', version: number): Board {
  return { id, kind, version } as unknown as Board;
}

function frames(socket: FakeSocket): unknown[] {
  return socket.sent.map((frame) => JSON.parse(frame) as unknown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function harness(): {
  sockets: FakeSocket[];
  advance: (ms: number) => void;
  client: SyncClient;
} {
  const sockets: FakeSocket[] = [];
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let request = 0;
  const deps: SyncDeps = {
    url: 'ws://example.test/api/ws',
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout(fn, ms) {
        const id = nextId;
        nextId += 1;
        pending.set(id, { at: now + ms, fn });
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
  return {
    sockets,
    advance(ms) {
      now += ms;
      for (let guard = 0; guard < 100; guard += 1) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
        const next = due[0];
        if (next === undefined) return;
        pending.delete(next[0]);
        next[1].fn();
      }
      throw new Error('timer loop did not settle');
    },
    client: new SyncClient(deps),
  };
}

function requireSocket(sockets: readonly FakeSocket[], index = sockets.length - 1): FakeSocket {
  const socket = sockets[index];
  if (socket === undefined) throw new Error(`expected socket ${String(index)}`);
  return socket;
}

function snapshot(value: Board, proposal: ProposalView | null = PROPOSAL): unknown {
  return {
    type: 'snapshot',
    boardId: value.id,
    version: value.version,
    board: value,
    ward: WARD,
    proposal,
  };
}

function liveClient(): ReturnType<typeof harness> & { socket: FakeSocket } {
  const mounted = harness();
  mounted.client.start();
  const socket = requireSocket(mounted.sockets);
  socket.open();
  return { ...mounted, socket };
}

function copyState(state: SyncState): SyncState {
  return structuredClone(state);
}

describe('session sync', () => {
  it('whoami stores me; offline → null and nothing sent', async () => {
    const { client, sockets } = harness();
    await expect(client.whoami()).resolves.toBeNull();
    await expect(client.fetchBoard('base-1')).resolves.toBeNull();
    await expect(client.loadSettings()).resolves.toBeNull();
    expect(sockets).toHaveLength(0);

    client.start();
    const socket = requireSocket(sockets);
    await expect(client.whoami()).resolves.toBeNull();
    await expect(client.fetchBoard('base-1')).resolves.toBeNull();
    await expect(client.loadSettings()).resolves.toBeNull();
    expect(frames(socket)).toEqual([]);

    socket.open();
    const pending = client.whoami();
    expect(typedFrames(sockets, 'whoami')).toEqual([{ type: 'whoami', requestId: 'req-1' }]);
    const me = { login: 'editor@example.test', displayName: 'Editor Example', role: 'editor' as const };
    socket.receive({ type: 'me', requestId: 'req-1', user: me });
    await expect(pending).resolves.toEqual(me);
    expect(client.getState().me).toEqual(me);

    const settings = client.loadSettings();
    expect(typedFrames(sockets, 'getSettings')).toEqual([{ type: 'getSettings', requestId: 'req-2' }]);
    socket.receive({ type: 'settings', requestId: 'req-2', showNeedsApproval: false });
    await expect(settings).resolves.toEqual({ showNeedsApproval: false });
    expect(client.getState().settings).toEqual({ showNeedsApproval: false });

    socket.close(1006);
    expect(client.getState().status).toBe('offline');
    const sent = socket.sent.length;
    await expect(client.whoami()).resolves.toBeNull();
    await expect(client.fetchBoard('base-1')).resolves.toBeNull();
    await expect(client.loadSettings()).resolves.toBeNull();
    expect(socket.sent).toHaveLength(sent);
    expect(client.getState().me).toEqual(me);
    expect(client.getState().settings).toEqual({ showNeedsApproval: false });
  });

  it('fetchBoard caches baselines but not proposal boards', async () => {
    const { client, sockets, socket } = liveClient();
    const baseline = board('base-1', 'baseline', 4);
    const first = client.fetchBoard('base-1');
    expect(typedFrames(sockets, 'getBoard')).toEqual([{ type: 'getBoard', requestId: 'req-1', boardId: 'base-1' }]);
    socket.receive({ type: 'board', requestId: 'req-1', board: baseline });
    await expect(first).resolves.toEqual(baseline);

    const second = client.fetchBoard('base-1');
    await expect(second).resolves.toEqual(baseline);
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(1);

    const proposal = board('prop-1', 'proposal', 2);
    const proposalRead = client.fetchBoard('prop-1');
    socket.receive({ type: 'board', requestId: 'req-2', board: proposal });
    await expect(proposalRead).resolves.toEqual(proposal);
    const proposalAgain = client.fetchBoard('prop-1');
    expect(typedFrames(sockets, 'getBoard')).toEqual([
      { type: 'getBoard', requestId: 'req-1', boardId: 'base-1' },
      { type: 'getBoard', requestId: 'req-2', boardId: 'prop-1' },
      { type: 'getBoard', requestId: 'req-3', boardId: 'prop-1' },
    ]);
    const revised = board('prop-1', 'proposal', 3);
    socket.receive({ type: 'board', requestId: 'req-3', board: revised });
    await expect(proposalAgain).resolves.toEqual(revised);

    const current = board('cur-1', 'current', 1);
    const currentRead = client.fetchBoard('cur-1');
    socket.receive({ type: 'board', requestId: 'req-4', board: current });
    await expect(currentRead).resolves.toEqual(current);
    const currentAgain = client.fetchBoard('cur-1');
    expect(typedFrames(sockets, 'getBoard').at(-1)).toEqual({
      type: 'getBoard',
      requestId: 'req-5',
      boardId: 'cur-1',
    });
    socket.receive({ type: 'board', requestId: 'req-5', board: current });
    await expect(currentAgain).resolves.toEqual(current);
    expect(client.getState().board).toBeNull();
    expect(client.getState().subscribedBoardId).toBeNull();
  });

  it('fetchBoard times out to null after REPLY_MS', async () => {
    const { client, sockets, socket, advance } = liveClient();
    const before = copyState(client.getState());
    let settled = false;
    const pending = client.fetchBoard('base-1').then((value) => {
      settled = true;
      return value;
    });
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(1);
    advance(REPLY_MS - 1);
    expect(settled).toBe(false);
    expect(socket.readyState).toBe(1);
    advance(1);
    await expect(pending).resolves.toBeNull();
    expect(settled).toBe(true);
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(1);
    expect(client.getState()).toEqual(before);

    const again = client.fetchBoard('base-1');
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(2);
    socket.receive({ type: 'board', requestId: 'req-2', board: board('base-1', 'baseline', 1) });
    await expect(again).resolves.toEqual(board('base-1', 'baseline', 1));
  });

  it('getBoard rejection resolves null and leaves state unchanged', async () => {
    const { client, sockets, socket } = liveClient();
    client.open('board-1');
    const current = board('board-1', 'proposal', 3);
    socket.receive(snapshot(current));
    const pendingMe = client.whoami();
    socket.receive({
      type: 'me',
      requestId: 'req-1',
      user: { login: 'ada@example.test', displayName: 'Ada', role: 'admin' },
    });
    await pendingMe;
    const before = copyState(client.getState());

    const pending = client.fetchBoard('missing');
    expect(typedFrames(sockets, 'getBoard')).toEqual([
      { type: 'getBoard', requestId: 'req-2', boardId: 'missing' },
    ]);
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'not_found',
      message: 'board missing does not exist',
    });
    await expect(pending).resolves.toBeNull();
    expect(client.getState()).toEqual(before);

    const again = client.fetchBoard('missing');
    expect(typedFrames(sockets, 'getBoard')).toHaveLength(2);
    socket.receive({
      type: 'rejected',
      requestId: 'req-3',
      code: 'bad_request',
      message: 'getBoard must have requestId and boardId',
    });
    await expect(again).resolves.toBeNull();
    expect(client.getState()).toEqual(before);
  });

  it("ward push replaces ward; proposalChanged updates only the subscribed board's proposal; settings push stored", () => {
    const { client, socket } = liveClient();
    client.open('board-1');
    const current = board('board-1', 'proposal', 3);
    socket.receive(snapshot(current));

    socket.receive({ type: 'ward', ward: OTHER_WARD });
    expect(client.getState().ward).toEqual(OTHER_WARD);
    expect(client.getState().board).toEqual(current);
    expect(client.getState().proposal).toEqual(PROPOSAL);

    socket.receive({
      type: 'proposalChanged',
      boardId: 'board-1',
      proposal: {
        id: 'pr-other',
        name: 'Updated plan',
        status: 'accepted',
        rationale: 'Because',
        baselineBoardId: 'base-9',
        boardId: 'board-1',
      },
    });
    expect(client.getState().proposal).toEqual({
      ...PROPOSAL,
      name: 'Updated plan',
      status: 'accepted',
      rationale: 'Because',
    });
    expect(client.getState().board).toEqual(current);

    socket.receive({
      type: 'proposalChanged',
      boardId: 'other-board',
      proposal: { name: 'Nope', status: 'draft', rationale: 'Ignored' },
    });
    expect(client.getState().proposal).toEqual({
      ...PROPOSAL,
      name: 'Updated plan',
      status: 'accepted',
      rationale: 'Because',
    });

    socket.receive({ type: 'settings', requestId: '', showNeedsApproval: true });
    expect(client.getState().settings).toEqual({ showNeedsApproval: true });

    socket.receive({
      type: 'boards',
      current: {
        boardId: 'cur-1',
        version: 2,
        importVersion: 'fixture',
        importedAt: '2026-07-01T00:00:00.000Z',
      },
      proposals: [
        {
          id: 'pr-1',
          name: 'Spring plan',
          status: 'draft',
          tabOrder: 0,
          boardId: 'board-1',
          version: 3,
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });
    expect(client.getState().boards).toEqual({
      current: {
        boardId: 'cur-1',
        version: 2,
        importVersion: 'fixture',
        importedAt: '2026-07-01T00:00:00.000Z',
      },
      proposals: [
        {
          id: 'pr-1',
          name: 'Spring plan',
          status: 'draft',
          tabOrder: 0,
          boardId: 'board-1',
          version: 3,
          updatedAt: '2026-07-01T00:00:00.000Z',
          acceptedAt: null,
        },
      ],
    });
    expect(client.getState().ward).toEqual(OTHER_WARD);
  });

  it('proposalChanged while unsubscribed is ignored', () => {
    const { client, socket } = liveClient();
    socket.receive({ type: 'ward', ward: WARD });
    const before = client.getState();
    socket.receive({
      type: 'proposalChanged',
      boardId: 'board-1',
      proposal: { name: 'Changed', status: 'accepted', rationale: 'Because' },
    });
    expect(client.getState()).toBe(before);
    expect(client.getState().proposal).toBeNull();
    expect(client.getState().subscribedBoardId).toBeNull();
    expect(client.getState().ward).toEqual(WARD);
  });

  it('connecting and subscribing still send exactly the T-029 frames', () => {
    const { client, sockets } = harness();
    expect(client.getState().me).toBeNull();
    expect(client.getState().settings).toBeNull();
    client.start();
    const socket = requireSocket(sockets);
    expect(frames(socket)).toEqual([]);
    socket.open();
    expect(frames(socket)).toEqual([{ type: 'listBoards' }]);
    client.open('board-1');
    expect(frames(socket)).toEqual([
      { type: 'listBoards' },
      { type: 'subscribe', boardId: 'board-1' },
    ]);
    socket.receive(snapshot(board('board-1', 'proposal', 3)));
    expect(frames(socket)).toEqual([
      { type: 'listBoards' },
      { type: 'subscribe', boardId: 'board-1' },
    ]);
    expect(client.getState().me).toBeNull();
    expect(client.getState().settings).toBeNull();
  });
});
