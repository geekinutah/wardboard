import type { Board, Ward } from '@wardboard/core';
import { describe, expect, it } from 'vitest';
import { SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';
import type { ProposalView } from './protocol.ts';

const WARD = { id: 'ward-1' } as unknown as Ward;
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

function board(id: string, version: number, placements: Record<string, string> = { 'p-1': 'm-1' }): Board {
  return { id, version, placements } as unknown as Board;
}

function frames(socket: FakeSocket): unknown[] {
  return socket.sent.map((frame) => JSON.parse(frame) as unknown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function opFrames(sockets: readonly FakeSocket[]): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const socket of sockets) {
    for (const frame of frames(socket)) {
      if (isRecord(frame) && frame.type === 'op') found.push(frame);
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

function committed(value: Board, requestId: string): unknown {
  return {
    type: 'committed',
    boardId: value.id,
    version: value.version,
    board: value,
    requestId,
    by: 'ada@example.test',
  };
}

describe('SyncClient', () => {
  it('start connects, goes live, lists boards', () => {
    const { client, sockets } = harness();
    const seen: string[] = [];
    const previous = client.getState();
    client.subscribe((state) => {
      seen.push(state.status);
    });

    client.start();
    expect(client.getState().status).toBe('connecting');
    expect(seen).toEqual(['connecting']);
    expect(client.getState()).not.toBe(previous);

    const socket = requireSocket(sockets);
    expect(socket.url).toBe('ws://example.test/api/ws');
    expect(frames(socket)).toEqual([]);

    socket.open();
    expect(client.getState().status).toBe('live');
    expect(seen).toEqual(['connecting', 'live']);
    expect(frames(socket)).toEqual([{ type: 'listBoards' }]);
  });

  it('open sends subscribe and snapshot fills state', () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();

    client.open('board-1');
    expect(frames(socket)).toEqual([
      { type: 'listBoards' },
      { type: 'subscribe', boardId: 'board-1' },
    ]);

    const current = board('board-1', 3);
    socket.receive(snapshot(current));
    expect(client.getState().subscribedBoardId).toBe('board-1');
    expect(client.getState().board).toEqual(current);
    expect(client.getState().ward).toEqual(WARD);
    expect(client.getState().proposal).toEqual(PROPOSAL);

    const kept = client.getState().board;
    socket.receive(snapshot(board('board-2', 1)));
    expect(client.getState().board).toBe(kept);
    expect(client.getState().subscribedBoardId).toBe('board-1');
  });

  it('send uses the current version as baseVersion and does not change the board', async () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    const current = board('board-1', 3);
    socket.receive(snapshot(current));
    const before = client.getState().board;

    let settled = false;
    const pending = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(client.getState().board).toBe(before);
    expect(opFrames(sockets)).toEqual([
      {
        type: 'op',
        requestId: 'req-1',
        boardId: 'board-1',
        baseVersion: 3,
        op: { kind: 'moveToDugout', request: { memberId: 'm-1', from: 'p-1' } },
      },
    ]);
  });

  it('committed next version applies and resolves the pending op', async () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    socket.receive(snapshot(board('board-1', 3)));
    const pending = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    const next = board('board-1', 4, {});

    socket.receive(committed(next, 'req-1'));

    await expect(pending).resolves.toEqual({ ok: true, version: 4 });
    expect(client.getState().board).toEqual(next);
  });

  it('committed from another client applies', () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    socket.receive(snapshot(board('board-1', 3)));
    const next = board('board-1', 4, { 'p-2': 'm-2' });

    socket.receive(committed(next, 'someone-else'));

    expect(client.getState().board).toEqual(next);
    expect(opFrames(sockets)).toEqual([]);
  });

  it('old or duplicate committed is ignored', () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    socket.receive(snapshot(board('board-1', 2)));
    const next = board('board-1', 3, { 'p-2': 'm-2' });
    socket.receive(committed(next, 'someone-else'));
    const applied = client.getState().board;

    socket.receive(committed(next, 'someone-else'));
    socket.receive(committed(board('board-1', 2, { 'p-9': 'm-9' }), 'older'));

    expect(client.getState().board).toBe(applied);
    expect(client.getState().board).toEqual(next);
  });

  it('version gap resubscribes and reports resynced', () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    const initial = board('board-1', 1, { 'p-1': 'm-1' });
    socket.receive(snapshot(initial));
    const kept = client.getState().board;

    socket.receive(committed(board('board-1', 4, { 'p-9': 'm-9' }), 'someone-else'));

    expect(client.getState().board).toBe(kept);
    expect(frames(socket).at(-1)).toEqual({ type: 'subscribe', boardId: 'board-1' });
    expect(client.getState().notice).toBeNull();

    const refreshed = board('board-1', 4, { 'p-2': 'm-2' });
    socket.receive(snapshot(refreshed));
    expect(client.getState().notice).toEqual({ kind: 'resynced' });
    expect(client.getState().board).toEqual(refreshed);
  });

  it('committed for another board is ignored', () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    socket.receive(snapshot(board('board-1', 2)));
    const kept = client.getState().board;
    const sentBefore = socket.sent.length;

    socket.receive(committed(board('board-2', 3, { 'p-9': 'm-9' }), 'someone-else'));

    expect(client.getState().board).toBe(kept);
    expect(client.getState().subscribedBoardId).toBe('board-1');
    expect(socket.sent).toHaveLength(sentBefore);
  });

  it('stale rejection resubscribes, notices stale, never retries', async () => {
    const { client, sockets, advance } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    socket.receive(snapshot(board('board-1', 1)));

    const pending = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    expect(opFrames(sockets)).toHaveLength(1);

    socket.receive({
      type: 'rejected',
      requestId: 'req-1',
      code: 'stale',
      message: 'board board-1 version is 2, expected 1',
      currentVersion: 2,
    });

    await expect(pending).resolves.toEqual({
      ok: false,
      code: 'stale',
      message: 'board board-1 version is 2, expected 1',
    });
    expect(client.getState().notice).toEqual({ kind: 'stale', requestId: 'req-1' });
    expect(frames(socket).filter((frame) => isRecord(frame) && frame.type === 'subscribe')).toHaveLength(2);
    advance(120_000);
    expect(opFrames(sockets)).toHaveLength(1);
  });

  it('other rejection resolves and notices with the server message', async () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    client.open('board-1');
    socket.receive(snapshot(board('board-1', 1)));
    const subscribes = frames(socket).filter((frame) => isRecord(frame) && frame.type === 'subscribe').length;

    const pending = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    socket.receive({
      type: 'rejected',
      requestId: 'req-1',
      code: 'not_editable',
      message: 'accepted proposals cannot be edited',
    });

    await expect(pending).resolves.toEqual({
      ok: false,
      code: 'not_editable',
      message: 'accepted proposals cannot be edited',
    });
    expect(client.getState().notice).toEqual({
      kind: 'rejected',
      requestId: 'req-1',
      code: 'not_editable',
      message: 'accepted proposals cannot be edited',
    });
    expect(frames(socket).filter((frame) => isRecord(frame) && frame.type === 'subscribe')).toHaveLength(subscribes);
    expect(opFrames(sockets)).toHaveLength(1);
  });

  it('send while offline resolves offline and sends nothing', async () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);

    const whileConnecting = await client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    expect(whileConnecting).toEqual({ ok: false, code: 'offline', message: 'offline' });
    expect(opFrames(sockets)).toEqual([]);

    socket.open();
    const sentAfterList = socket.sent.length;
    const withoutBoard = await client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    expect(withoutBoard).toEqual({ ok: false, code: 'offline', message: 'offline' });
    expect(socket.sent).toHaveLength(sentAfterList);

    client.open('board-1');
    socket.receive(snapshot(board('board-1', 1)));
    socket.close(1006);
    const afterClose = await client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    expect(afterClose).toEqual({ ok: false, code: 'offline', message: 'offline' });
    expect(opFrames(sockets)).toEqual([]);
  });

  it('close resolves pending ops offline and keeps stale data', async () => {
    const { client, sockets } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    socket.receive({
      type: 'boards',
      current: null,
      proposals: [
        {
          id: 'pr-1',
          name: 'Spring plan',
          status: 'draft',
          tabOrder: 0,
          boardId: 'board-1',
          version: 1,
          updatedAt: '2026-07-01T15:04:05.000Z',
        },
      ],
    });
    client.open('board-1');
    const current = board('board-1', 1);
    socket.receive(snapshot(current));
    const pending = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    const before = client.getState();

    socket.close(1006);

    await expect(pending).resolves.toEqual({ ok: false, code: 'offline', message: 'offline' });
    expect(client.getState().status).toBe('offline');
    expect(client.getState().board).toEqual(before.board);
    expect(client.getState().ward).toEqual(before.ward);
    expect(client.getState().boards).toEqual(before.boards);
    expect(client.getState().proposal).toEqual(before.proposal);
  });

  it('reconnect backoff 1,2,4,8,16,30,30 and reset after open', () => {
    const { client, sockets, advance } = harness();
    client.start();
    const first = requireSocket(sockets);
    first.open();
    first.close(1006);
    expect(client.getState().status).toBe('offline');

    for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000]) {
      const before = sockets.length;
      advance(delay - 1);
      expect(sockets).toHaveLength(before);
      advance(1);
      expect(sockets).toHaveLength(before + 1);
      requireSocket(sockets).close(1006);
      expect(client.getState().status).toBe('offline');
    }

    const beforeReset = sockets.length;
    advance(29_999);
    expect(sockets).toHaveLength(beforeReset);
    advance(1);
    expect(sockets).toHaveLength(beforeReset + 1);
    const recovered = requireSocket(sockets);
    recovered.open();
    expect(client.getState().status).toBe('live');
    recovered.close(1006);

    const beforeNext = sockets.length;
    advance(999);
    expect(sockets).toHaveLength(beforeNext);
    advance(1);
    expect(sockets).toHaveLength(beforeNext + 1);
  });

  it('reconnect resubscribes and notices resynced', () => {
    const { client, sockets, advance } = harness();
    client.start();
    const first = requireSocket(sockets);
    first.open();
    client.open('board-1');
    const initial = board('board-1', 1, { 'p-1': 'm-1' });
    first.receive(snapshot(initial));
    first.close(1006);
    expect(client.getState().status).toBe('offline');
    expect(client.getState().board).toEqual(initial);

    advance(1000);
    const second = requireSocket(sockets);
    second.open();
    expect(frames(second)).toEqual([
      { type: 'listBoards' },
      { type: 'subscribe', boardId: 'board-1' },
    ]);

    const refreshed = board('board-1', 2, { 'p-2': 'm-2' });
    second.receive(snapshot(refreshed));
    expect(client.getState().status).toBe('live');
    expect(client.getState().notice).toEqual({ kind: 'resynced' });
    expect(client.getState().board).toEqual(refreshed);
  });

  it('4403 and forbidden error stop reconnecting', () => {
    const closed = harness();
    closed.client.start();
    const closedSocket = requireSocket(closed.sockets);
    closedSocket.open();
    closedSocket.close(4403);
    expect(closed.client.getState().status).toBe('forbidden');
    closed.advance(120_000);
    expect(closed.sockets).toHaveLength(1);

    const denied = harness();
    denied.client.start();
    const deniedSocket = requireSocket(denied.sockets);
    deniedSocket.open();
    deniedSocket.receive({ type: 'error', code: 'forbidden' });
    expect(denied.client.getState().status).toBe('forbidden');
    denied.advance(120_000);
    expect(denied.sockets).toHaveLength(1);
    expect(denied.client.getState().status).toBe('forbidden');
  });

  it('silent connection is detected', () => {
    const { client, sockets, advance } = harness();
    client.start();
    const socket = requireSocket(sockets);
    socket.open();
    expect(frames(socket)).toEqual([{ type: 'listBoards' }]);

    advance(20_000);
    socket.receive({ type: 'boards', current: null, proposals: [] });
    advance(24_999);
    expect(frames(socket).filter((frame) => isRecord(frame) && frame.type === 'listBoards')).toHaveLength(1);
    advance(1);
    expect(frames(socket).filter((frame) => isRecord(frame) && frame.type === 'listBoards')).toHaveLength(2);
    expect(frames(socket).at(-1)).toEqual({ type: 'listBoards' });

    advance(9999);
    expect(client.getState().status).toBe('live');
    expect(socket.readyState).toBe(1);
    advance(1);
    expect(socket.readyState).toBe(3);
    expect(client.getState().status).toBe('offline');
  });

  it('stop clears timers and never reconnects', () => {
    const live = harness();
    live.client.start();
    const liveSocket = requireSocket(live.sockets);
    liveSocket.open();
    const sent = liveSocket.sent.length;
    live.client.stop();
    live.advance(120_000);
    expect(live.sockets).toHaveLength(1);
    expect(liveSocket.sent).toHaveLength(sent);
    expect(liveSocket.readyState).toBe(3);

    const waiting = harness();
    waiting.client.start();
    const waitingSocket = requireSocket(waiting.sockets);
    waitingSocket.open();
    waitingSocket.close(1006);
    waiting.client.stop();
    waiting.advance(120_000);
    expect(waiting.sockets).toHaveLength(1);
    expect(waiting.client.getState().status).not.toBe('live');
  });
});
