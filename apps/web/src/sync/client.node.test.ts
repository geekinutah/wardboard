// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Board } from '@wardboard/core';
import { fixtureIdentityProvider, openStore, startServer, type RunningServer } from '@wardboard/server';
import { seedFixture } from '@wardboard/server/dev';
import { afterEach, describe, expect, it } from 'vitest';
import { databasePath, migrate, openDatabase } from '../../../../apps/server/src/db/index.ts';
import { SyncClient, type SyncState, type WebSocketLike } from './client.ts';

const require = createRequire(new URL('../../../../apps/server/package.json', import.meta.url));
const WebSocketImpl = require('ws') as new (
  url: string,
  options?: { origin?: string },
) => WebSocketLike & { on(event: 'error', listener: () => void): void };

const IDENTITY = { login: 'sync-admin@example.test', displayName: 'Sync Admin' };

const running: RunningServer[] = [];
const directories: string[] = [];
const clients: SyncClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const server of running.splice(0)) await server.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function boot(port: number, existingDir?: string): Promise<{ server: RunningServer; dataDir: string }> {
  const dataDir = existingDir ?? (await mkdtemp(path.join(tmpdir(), 'wardboard-t029-')));
  if (existingDir === undefined) {
    directories.push(dataDir);
    const db = openDatabase(databasePath(dataDir));
    try {
      migrate(db);
      seedFixture(openStore(db, () => new Date('2026-07-01T15:04:05.000Z')));
    } finally {
      db.close();
    }
  }
  const server = await startServer(
    {
      dataDir,
      baseUrl: 'http://127.0.0.1',
      port,
      host: '127.0.0.1',
      initialAdminLogin: IDENTITY.login,
    },
    { identityProvider: fixtureIdentityProvider(IDENTITY) },
  );
  running.push(server);
  return { server, dataDir };
}

function connect(server: RunningServer): SyncClient {
  let next = 0;
  const origin = server.url;
  const client = new SyncClient({
    url: `ws://127.0.0.1:${String(server.port)}/api/ws`,
    createSocket: (url) => {
      const socket = new WebSocketImpl(url, { origin });
      socket.on('error', () => undefined);
      return socket;
    },
    timers: {
      setTimeout(fn, ms) {
        return setTimeout(fn, ms);
      },
      clearTimeout(handle) {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    },
    requestIds: () => {
      next += 1;
      return `req-${String(next)}`;
    },
  });
  clients.push(client);
  client.start();
  return client;
}

function waitFor(client: SyncClient, predicate: (state: SyncState) => boolean, timeoutMs = 8000): Promise<SyncState> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (state: SyncState, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error !== undefined) reject(error);
      else resolve(state);
    };
    const timer = setTimeout(() => {
      finish(client.getState(), new Error(`timed out waiting for sync state: ${JSON.stringify(client.getState())}`));
    }, timeoutMs);
    const unsubscribe = client.subscribe((state) => {
      if (predicate(state)) finish(state);
    });
    const current = client.getState();
    if (predicate(current)) finish(current);
  });
}

function placed(board: Board): { memberId: string; from: string } {
  for (const [from, memberId] of Object.entries(board.placements)) {
    return { from, memberId };
  }
  throw new Error('snapshot board has no placement');
}

async function subscribeProposal(client: SyncClient): Promise<{ boardId: string; from: string; memberId: string }> {
  const listed = await waitFor(
    client,
    (state) => state.status === 'live' && (state.boards?.proposals.length ?? 0) > 0,
  );
  const summary = listed.boards?.proposals[0];
  if (summary === undefined) throw new Error('missing proposal');
  client.open(summary.boardId);
  const snapped = await waitFor(client, (state) => state.board !== null && state.subscribedBoardId === summary.boardId);
  if (snapped.board === null) throw new Error('missing board');
  return { boardId: summary.boardId, ...placed(snapped.board) };
}

describe('SyncClient against a real server', () => {
  it('two clients on one proposal see each other\'s commit', async () => {
    expect(typeof document).toBe('undefined');
    const { server } = await boot(0);
    const first = connect(server);
    const second = connect(server);
    const seat = await subscribeProposal(first);
    await subscribeProposal(second);
    const before = first.getState().board?.version;
    if (before === undefined) throw new Error('missing version');

    const outcome = await first.send('moveToDugout', { memberId: seat.memberId, from: seat.from });
    expect(outcome).toMatchObject({ ok: true, version: before + 1 });
    await waitFor(second, (state) => state.board?.version === before + 1);
    expect(second.getState().board).toEqual(first.getState().board);
    const placements = second.getState().board?.placements;
    expect(placements !== undefined && Object.hasOwn(placements, seat.from)).toBe(false);
  }, 15_000);

  it('stale op from a lagging client is reported and refreshed', async () => {
    const { server } = await boot(0);
    const origin = server.url;
    const url = `ws://127.0.0.1:${String(server.port)}/api/ws`;
    let held = false;
    const queued: { data: unknown }[] = [];
    let handler: ((event: { data: unknown }) => void) | null = null;
    const release = (): void => {
      held = false;
      const batch = queued.splice(0);
      for (const event of batch) handler?.(event);
    };
    let next = 0;
    const lagging = new SyncClient({
      url,
      createSocket: (socketUrl) => {
        const raw = new WebSocketImpl(socketUrl, { origin });
        raw.on('error', () => undefined);
        raw.onmessage = (event) => {
          if (held) queued.push({ data: event.data });
          else handler?.({ data: event.data });
        };
        return {
          get readyState() {
            return raw.readyState;
          },
          send(data: string) {
            raw.send(data);
          },
          close(code?: number, reason?: string) {
            raw.close(code, reason);
          },
          set onopen(fn) {
            raw.onopen = fn;
          },
          get onopen() {
            return raw.onopen;
          },
          set onmessage(fn) {
            handler = fn;
          },
          get onmessage() {
            return handler;
          },
          set onclose(fn) {
            raw.onclose = fn;
          },
          get onclose() {
            return raw.onclose;
          },
          set onerror(fn) {
            raw.onerror = fn;
          },
          get onerror() {
            return raw.onerror;
          },
        };
      },
      timers: {
        setTimeout(fn, ms) {
          return setTimeout(fn, ms);
        },
        clearTimeout(handle) {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        },
      },
      requestIds: () => {
        next += 1;
        return `lag-${String(next)}`;
      },
    });
    clients.push(lagging);
    const leader = connect(server);
    lagging.start();
    const seat = await subscribeProposal(leader);
    await subscribeProposal(lagging);
    const version = leader.getState().board?.version;
    if (version === undefined) throw new Error('missing version');

    held = true;
    const committed = await leader.send('moveToDugout', { memberId: seat.memberId, from: seat.from });
    expect(committed).toMatchObject({ ok: true, version: version + 1 });
    expect(lagging.getState().board?.version).toBe(version);

    const stale = lagging.send('moveToDugout', { memberId: seat.memberId, from: seat.from });
    release();
    await expect(stale).resolves.toMatchObject({ ok: false, code: 'stale' });
    await waitFor(
      lagging,
      (state) => state.notice?.kind === 'stale' && state.board?.version === leader.getState().board?.version,
    );
    expect(lagging.getState().notice?.kind).toBe('stale');
    expect(lagging.getState().board).toEqual(leader.getState().board);
  }, 15_000);

  it('server restart: client goes offline, reconnects and resyncs', async () => {
    const first = await boot(0);
    const client = connect(first.server);
    await subscribeProposal(client);

    await first.server.close();
    await waitFor(client, (state) => state.status === 'offline');
    await boot(first.server.port, first.dataDir);
    const resynced = await waitFor(
      client,
      (state) => state.status === 'live' && state.notice?.kind === 'resynced',
      12_000,
    );
    expect(resynced.status).toBe('live');
    expect(resynced.notice).toEqual({ kind: 'resynced' });
    expect(resynced.board).not.toBeNull();
  }, 20_000);
});
