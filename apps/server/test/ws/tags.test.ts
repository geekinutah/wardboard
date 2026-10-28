import { tagId, type Board, type Tag, type Ward } from '@wardboard/core';
import type { WebSocket } from 'ws';
import { WebSocket as Socket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  BASE_URL,
  EDITOR,
  Inbox,
  asRecord,
  cleanup,
  openSocket,
  seedDraftProposals,
  startSession,
  subscribe,
  upgradeStatus,
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

function tagNamed(ward: Ward, name: string): Tag {
  const tag = Object.values(ward.tags).find((item) => item.name === name);
  if (tag === undefined) throw new Error(`missing tag ${name}`);
  return tag;
}

function mentions(board: unknown, id: string): boolean {
  const assignments = asRecord(asRecord(board).assignments);
  return Object.values(assignments).some((value) => {
    const calling = asRecord(value);
    const tags = calling.callingTagIds;
    const preferred = calling.preferredMemberTagIds;
    return (
      (Array.isArray(tags) && tags.includes(id)) || (Array.isArray(preferred) && preferred.includes(id))
    );
  });
}

function storeSnapshot(session: Session): unknown {
  return {
    ward: session.store.loadWard(),
    current: session.store.loadCurrent(),
    list: session.store.listProposals(),
    proposals: session.store.listProposals().map((item) => session.store.loadProposal(item.id)),
  };
}

async function openInbox(session: Session): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = await openSocket(session);
  return { ws, inbox: new Inbox(ws) };
}

/** An Editor session with two Draft proposals copied from the fixture Current. */
async function startEditor(): Promise<Session> {
  const session = await startSession({
    identity: EDITOR,
    initialAdminLogin: ADMIN.login,
    seed: seedDraftProposals(2),
  });
  const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
  if (admin === undefined) throw new Error('missing admin');
  expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
  return session;
}

function editorRole(session: Session): string | undefined {
  return session.access.listUsers().find((user) => user.login === EDITOR.login)?.role;
}

describe('tag delete channel', () => {
  it('Editor deleteTag → tagDeleted to the requester, ward to all, committed to a Draft subscriber at version+1, then boards', async () => {
    const session = await startEditor();
    const [first] = session.store.listProposals();
    if (first === undefined) throw new Error('missing proposal');
    const musical = tagNamed(session.store.loadWard(), 'Musical');

    const sender = await openInbox(session);
    expect(editorRole(session)).toBe('editor');
    const watcher = await openInbox(session);
    const idle = await openInbox(session);
    const snapshot = await subscribe(watcher.ws, watcher.inbox, first.boardId);
    expect(snapshot.version).toBe(first.version);
    expect(mentions(snapshot.board, musical.id)).toBe(true);

    send(sender.ws, { type: 'deleteTag', requestId: 'delete-musical', tagId: musical.id });

    expect(asRecord(await sender.inbox.next())).toEqual({
      type: 'tagDeleted',
      requestId: 'delete-musical',
      tagId: musical.id,
    });
    const senderWard = asRecord(await sender.inbox.next());
    expect(senderWard.type).toBe('ward');
    expect(asRecord(asRecord(senderWard.ward).tags)[musical.id]).toBeUndefined();
    const senderBoards = asRecord(await sender.inbox.next());
    expect(senderBoards.type).toBe('boards');

    const watcherWard = asRecord(await watcher.inbox.next());
    expect(watcherWard).toEqual(senderWard);
    const committed = asRecord(await watcher.inbox.next());
    expect(committed).toMatchObject({
      type: 'committed',
      boardId: first.boardId,
      version: first.version + 1,
      requestId: 'delete-musical',
      by: EDITOR.login,
    });
    expect(asRecord(committed.board).version).toBe(first.version + 1);
    expect(mentions(committed.board, musical.id)).toBe(false);
    const watcherBoards = asRecord(await watcher.inbox.next());
    expect(watcherBoards).toEqual(senderBoards);

    expect(asRecord(await idle.inbox.next())).toEqual(senderWard);
    expect(asRecord(await idle.inbox.next())).toEqual(senderBoards);

    const proposals = senderBoards.proposals;
    if (!Array.isArray(proposals)) throw new Error('boards.proposals is not an array');
    const listed = asRecord(proposals.find((item) => asRecord(item).id === first.id));
    expect(listed).toMatchObject({ boardId: first.boardId, version: first.version + 1, acceptedAt: null });
    const current = asRecord(senderBoards.current);
    const stored = session.store.loadCurrent();
    expect(current.version).toBe(stored?.board.version);

    expect(session.store.loadWard().tags[musical.id]).toBeUndefined();
    const reloaded: Board | null = session.store.loadBoard(first.boardId);
    expect(reloaded?.version).toBe(first.version + 1);
    expect(reloaded).toEqual(committed.board);
  });

  it('getTagUsage returns the store counts', async () => {
    const session = await startEditor();
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const usage = session.store.tagUsage(musical.id);
    if (!usage.ok) throw new Error(usage.error.message);
    const { ws, inbox } = await openInbox(session);
    const before = storeSnapshot(session);

    send(ws, { type: 'getTagUsage', requestId: 'usage-musical', tagId: musical.id });

    // Current plus two Draft working boards, each with Organist (tag + preference) and Chorister (preference).
    expect(asRecord(await inbox.next())).toEqual({
      type: 'tagUsage',
      requestId: 'usage-musical',
      tagId: musical.id,
      members: 4,
      callingPreferences: 6,
      callingTags: 3,
    });
    expect(usage.value).toEqual({ members: 4, callingPreferences: 6, callingTags: 3 });
    expect(storeSnapshot(session)).toEqual(before);
  });

  it('deleteTag / getTagUsage with bad shape (extra key, empty tagId, bad requestId) → rejected bad_request', async () => {
    const session = await startEditor();
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const { ws, inbox } = await openInbox(session);
    const before = storeSnapshot(session);
    const cases: { message: Record<string, unknown>; requestId: string }[] = [];
    for (const type of ['deleteTag', 'getTagUsage']) {
      cases.push(
        { message: { type, requestId: `${type}-extra`, tagId: musical.id, extra: true }, requestId: `${type}-extra` },
        { message: { type, requestId: `${type}-missing` }, requestId: `${type}-missing` },
        { message: { type, requestId: `${type}-empty`, tagId: '' }, requestId: `${type}-empty` },
        { message: { type, requestId: `${type}-number`, tagId: 7 }, requestId: `${type}-number` },
        { message: { type, requestId: 'r'.repeat(65), tagId: musical.id }, requestId: '' },
        { message: { type, requestId: '', tagId: musical.id }, requestId: '' },
        { message: { type, requestId: 12, tagId: musical.id }, requestId: '' },
      );
    }

    for (const item of cases) {
      const pending = inbox.next();
      send(ws, item.message);
      expectRejected(asRecord(await pending), item.requestId, 'bad_request');
    }

    expect(storeSnapshot(session)).toEqual(before);
    expect(ws.readyState).toBe(Socket.OPEN);
  });

  it('unknown tag → rejected not_found for both', async () => {
    const session = await startEditor();
    const { ws, inbox } = await openInbox(session);
    const before = storeSnapshot(session);

    const deleted = inbox.next();
    send(ws, { type: 'deleteTag', requestId: 'delete-missing', tagId: 'missing-tag' });
    expectRejected(asRecord(await deleted), 'delete-missing', 'not_found');

    const usage = inbox.next();
    send(ws, { type: 'getTagUsage', requestId: 'usage-missing', tagId: 'missing-tag' });
    expectRejected(asRecord(await usage), 'usage-missing', 'not_found');

    expect(storeSnapshot(session)).toEqual(before);
    expect(ws.readyState).toBe(Socket.OPEN);
  });

  it('revoked user sending deleteTag or getTagUsage → error forbidden and close 4403, nothing deleted', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const messages = [
      { type: 'deleteTag', requestId: 'revoked-delete', tagId: musical.id },
      { type: 'getTagUsage', requestId: 'revoked-usage', tagId: musical.id },
    ];

    for (const message of messages) {
      expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);
      const { ws, inbox } = await openInbox(session);
      const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
      if (editor === undefined) throw new Error('missing editor');
      expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });
      const before = storeSnapshot(session);

      const closed = inbox.closed();
      const pending = inbox.next();
      send(ws, message);

      expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
      expect(await closed).toBe(4403);
      expect(storeSnapshot(session)).toEqual(before);
    }
    expect(session.store.loadWard().tags[musical.id]).toEqual(musical);
  });

  it('unauthenticated upgrade cannot send deleteTag', async () => {
    const session = await startSession({ identity: null, seed: seedDraftProposals(1) });
    const musical = tagNamed(session.store.loadWard(), 'Musical');
    const before = storeSnapshot(session);

    expect(await upgradeStatus(session.server.port, new URL(BASE_URL).origin)).toBe(401);
    await expect(openSocket(session)).rejects.toThrow('unexpected 401');

    expect(storeSnapshot(session)).toEqual(before);
    expect(session.store.loadWard().tags[tagId(musical.id)]).toEqual(musical);
  });
});
