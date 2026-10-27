import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  BASE_URL,
  EDITOR,
  OVERSIZE_BYTES,
  Inbox,
  asRecord,
  cleanup,
  openSocket,
  startAdmin,
  startSession,
  upgradeStatus,
} from './helpers.ts';

afterEach(cleanup);

describe('operation channel connection', () => {
  it('unauthenticated upgrade to /api/ws is 401', async () => {
    const session = await startSession({ identity: null });

    const status = await upgradeStatus(session.server.port, 'https://evil.example');

    expect(status).toBe(401);
  });

  it('authenticated user without access is 403', async () => {
    const session = await startSession({
      identity: { login: 'stranger@example.test', displayName: 'Stranger' },
    });

    const status = await upgradeStatus(session.server.port, new URL(BASE_URL).origin);

    expect(status).toBe(403);
  });

  it('missing or foreign Origin is 403', async () => {
    const session = await startAdmin();

    expect(await upgradeStatus(session.server.port)).toBe(403);
    expect(await upgradeStatus(session.server.port, 'https://evil.example')).toBe(403);

    const fromBase = await openSocket(session, new URL(BASE_URL).origin, '?x=1');
    expect(fromBase.readyState).toBe(WebSocket.OPEN);
    const fromListen = await openSocket(session, session.server.url);
    expect(fromListen.readyState).toBe(WebSocket.OPEN);
  });

  it('revoked user is refused on the next message of every type', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    expect(admin).toBeDefined();
    if (admin === undefined) return;

    const messages = [
      { type: 'listBoards' },
      { type: 'subscribe', boardId: 'missing-board' },
      {
        type: 'op',
        requestId: 'revoke-op',
        boardId: 'missing-board',
        baseVersion: 0,
        op: { kind: 'addToDugout', request: { memberId: 'm-0001' } },
      },
    ];

    for (const message of messages) {
      expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
      const ws = await openSocket(session);
      const inbox = new Inbox(ws);
      const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
      expect(editor).toBeDefined();
      if (editor === undefined) return;
      expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });

      const closed = inbox.closed();
      const pending = inbox.next();
      ws.send(JSON.stringify(message));

      expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
      expect(await closed).toBe(4403);
    }
  });

  it('oversize and non-JSON frames get bad_message', async () => {
    const session = await startAdmin();
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);

    const badText = inbox.next();
    ws.send('nope');
    expect(asRecord(await badText)).toEqual({ type: 'error', code: 'bad_message' });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const binary = inbox.next();
    ws.send(Buffer.from(JSON.stringify({ type: 'listBoards' })), { binary: true });
    expect(asRecord(await binary)).toEqual({ type: 'error', code: 'bad_message' });
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const boards = inbox.next();
    ws.send(JSON.stringify({ type: 'listBoards' }));
    expect(asRecord(await boards).type).toBe('boards');

    const closed = inbox.closed();
    ws.send('x'.repeat(OVERSIZE_BYTES));
    expect(await closed).toBe(1009);
  });
});
