import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  EDITOR,
  FIXED_TIME,
  Inbox,
  asRecord,
  cleanup,
  memberNamed,
  openSocket,
  opMessage,
  requireBoard,
  seedDraftProposals,
  startAdmin,
  startSession,
  subscribe,
  vacantPosition,
  type Session,
} from './helpers.ts';

afterEach(cleanup);

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

function expectRejected(message: Record<string, unknown>, requestId: string, code: string): void {
  expect(message).toMatchObject({ type: 'rejected', requestId, code });
  expect(typeof message.message).toBe('string');
  expect(message.message).not.toBe('');
}

async function editorSession(seed?: (store: Session['store'], db: Session['db']) => void): Promise<Session> {
  const session = await startSession({
    identity: EDITOR,
    initialAdminLogin: ADMIN.login,
    ...(seed !== undefined ? { seed } : {}),
  });
  const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
  if (admin === undefined) throw new Error('missing admin');
  expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
  return session;
}

describe('session and board reads', () => {
  it('whoami returns the resolved login, display name and role for an Editor and an Admin', async () => {
    const adminSession = await startAdmin();
    const adminSocket = await openSocket(adminSession);
    const adminInbox = new Inbox(adminSocket);
    const adminPending = adminInbox.next();
    send(adminSocket, { type: 'whoami', requestId: 'admin-me' });
    expect(asRecord(await adminPending)).toEqual({
      type: 'me',
      requestId: 'admin-me',
      user: { login: ADMIN.login, displayName: ADMIN.displayName, role: 'admin' },
    });
    expect(adminSocket.readyState).toBe(WebSocket.OPEN);

    const editor = await editorSession();
    const editorSocket = await openSocket(editor);
    const editorInbox = new Inbox(editorSocket);
    const editorPending = editorInbox.next();
    send(editorSocket, { type: 'whoami', requestId: 'editor-me' });
    expect(asRecord(await editorPending)).toEqual({
      type: 'me',
      requestId: 'editor-me',
      user: { login: EDITOR.login, displayName: EDITOR.displayName, role: 'editor' },
    });

    const editorBoard = editorInbox.next();
    send(editorSocket, { type: 'getBoard', requestId: 'editor-board', boardId: 'missing-board' });
    expectRejected(asRecord(await editorBoard), 'editor-board', 'not_found');
    expect(editorSocket.readyState).toBe(WebSocket.OPEN);
  });

  it('whoami after mid-connection demotion reports editor', async () => {
    const session = await startAdmin();
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);

    const before = inbox.next();
    send(ws, { type: 'whoami', requestId: 'before-demotion' });
    expect(asRecord(await before)).toEqual({
      type: 'me',
      requestId: 'before-demotion',
      user: { login: ADMIN.login, displayName: ADMIN.displayName, role: 'admin' },
    });

    session.db
      .prepare(
        `INSERT INTO users (id, login, display_name, role, created_at)
         VALUES ('admin-2', 'second-admin@example.test', 'Second Admin', 'admin', ?)`,
      )
      .run(FIXED_TIME);
    expect(session.access.setRole(admin.id, admin.id, 'editor').ok).toBe(true);

    const after = inbox.next();
    send(ws, { type: 'whoami', requestId: 'after-demotion' });
    expect(asRecord(await after)).toEqual({
      type: 'me',
      requestId: 'after-demotion',
      user: { login: ADMIN.login, displayName: ADMIN.displayName, role: 'editor' },
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('getBoard returns a baseline without changing the subscription; a later commit on the subscribed board still arrives', async () => {
    const session = await startAdmin(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const proposal = session.store.loadProposal(summary.id);
    if (proposal === null) throw new Error('missing proposal');
    const current = session.store.loadCurrent();
    if (current === null) throw new Error('missing current');

    const reader = await openSocket(session);
    const inbox = new Inbox(reader);
    await subscribe(reader, inbox, summary.boardId);

    const baselinePending = inbox.next();
    send(reader, { type: 'getBoard', requestId: 'read-baseline', boardId: proposal.baseline.id });
    const baselineMessage = asRecord(await baselinePending);
    expect(baselineMessage).toEqual({
      type: 'board',
      requestId: 'read-baseline',
      board: session.store.loadBoard(proposal.baseline.id),
    });
    expect(asRecord(baselineMessage.board).kind).toBe('baseline');

    const currentPending = inbox.next();
    send(reader, { type: 'getBoard', requestId: 'read-current', boardId: current.board.id });
    expect(asRecord(await currentPending)).toEqual({
      type: 'board',
      requestId: 'read-current',
      board: session.store.loadBoard(current.board.id),
    });

    const proposalPending = inbox.next();
    send(reader, { type: 'getBoard', requestId: 'read-proposal', boardId: proposal.board.id });
    expect(asRecord(await proposalPending)).toEqual({
      type: 'board',
      requestId: 'read-proposal',
      board: session.store.loadBoard(proposal.board.id),
    });

    const writer = await openSocket(session);
    const writerInbox = new Inbox(writer);
    await subscribe(writer, writerInbox, summary.boardId);
    const board = requireBoard(session.store, summary.boardId);
    const mover = memberNamed(session.store.loadWard(), 'Liv Example');
    const chorister = vacantPosition(board, 'Chorister');

    const readerCommitted = inbox.next();
    const writerCommitted = writerInbox.next();
    writer.send(
      opMessage({
        requestId: 'move-1',
        boardId: summary.boardId,
        baseVersion: board.version,
        kind: 'placeInPosition',
        request: { memberId: mover.id, from: null, to: chorister.id },
      }),
    );

    expect(asRecord(await readerCommitted)).toMatchObject({
      type: 'committed',
      boardId: summary.boardId,
      version: board.version + 1,
      requestId: 'move-1',
      by: ADMIN.login,
    });
    expect(asRecord(await writerCommitted).type).toBe('committed');
    expect(reader.readyState).toBe(WebSocket.OPEN);
    expect(session.store.loadBoard(proposal.baseline.id)).toEqual(proposal.baseline);
  });

  it('getBoard unknown id → not_found; extra keys → bad_request', async () => {
    const session = await editorSession(seedDraftProposals(1));
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    const before = session.store.loadBoard(summary.boardId);

    const missing = inbox.next();
    send(ws, { type: 'getBoard', requestId: 'missing-board', boardId: 'missing-board' });
    expectRejected(asRecord(await missing), 'missing-board', 'not_found');

    const extra = inbox.next();
    send(ws, { type: 'getBoard', requestId: 'extra-board', boardId: summary.boardId, extra: true });
    expectRejected(asRecord(await extra), 'extra-board', 'bad_request');

    const missingBoardId = inbox.next();
    send(ws, { type: 'getBoard', requestId: 'no-board' });
    expectRejected(asRecord(await missingBoardId), 'no-board', 'bad_request');

    const emptyBoardId = inbox.next();
    send(ws, { type: 'getBoard', requestId: 'empty-board', boardId: '' });
    expectRejected(asRecord(await emptyBoardId), 'empty-board', 'bad_request');

    const whoamiExtra = inbox.next();
    send(ws, { type: 'whoami', requestId: 'extra-me', extra: true });
    expectRejected(asRecord(await whoamiExtra), 'extra-me', 'bad_request');

    const whoamiMissing = inbox.next();
    send(ws, { type: 'whoami', displayName: 'Spoofed' });
    expectRejected(asRecord(await whoamiMissing), '', 'bad_request');

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(session.store.loadBoard(summary.boardId)).toEqual(before);
  });

  it('revoked user whoami and getBoard → forbidden, close 4403', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const summary = session.store.listProposals()[0];
    if (summary === undefined) throw new Error('missing proposal');
    const messages = [
      { type: 'whoami', requestId: 'revoked-me' },
      { type: 'getBoard', requestId: 'revoked-board', boardId: summary.boardId },
    ];

    for (const message of messages) {
      expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
      const ws = await openSocket(session);
      const inbox = new Inbox(ws);
      const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
      if (editor === undefined) throw new Error('missing editor');
      expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });
      const before = session.store.loadBoard(summary.boardId);

      const closed = inbox.closed();
      const pending = inbox.next();
      send(ws, message);

      expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
      expect(await closed).toBe(4403);
      expect(session.store.loadBoard(summary.boardId)).toEqual(before);
    }
  });
});
