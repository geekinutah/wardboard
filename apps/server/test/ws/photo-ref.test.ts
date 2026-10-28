import type { WebSocket } from 'ws';
import { WebSocket as Socket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  EDITOR,
  Inbox,
  asRecord,
  cleanup,
  memberNamed,
  openSocket,
  restart,
  seedDraftProposals,
  startSession,
  subscribe,
  type Session,
} from './helpers.ts';

afterEach(cleanup);

const REF = `${'ab'.repeat(32)}.jpg`;
const STORED = `${'cd'.repeat(32)}.png`;
const OTHER = `${'ef'.repeat(32)}.jpg`;
const PHOTO_MESSAGE =
  'photoRef must be a 64-character lowercase sha256 hex with a jpg or png extension';

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

function wardMember(message: Record<string, unknown>, id: string): Record<string, unknown> {
  return asRecord(asRecord(asRecord(message.ward).members)[id]);
}

async function openInbox(session: Session): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = await openSocket(session);
  return { ws, inbox: new Inbox(ws) };
}

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

describe('photoRef channel', () => {
  it('updateMember sets photoRef for an Editor and broadcasts the ward', async () => {
    const session = await startEditor();
    const [first, second] = session.store.listProposals();
    if (first === undefined || second === undefined) throw new Error('missing proposals');
    const ada = memberNamed(session.store.loadWard(), 'Ada Fictional');
    const before = ada;

    const sender = await openInbox(session);
    const other = await openInbox(session);
    await subscribe(sender.ws, sender.inbox, first.boardId);
    await subscribe(other.ws, other.inbox, second.boardId);
    expect(editorRole(session)).toBe('editor');

    const ack = sender.inbox.next();
    const senderWard = sender.inbox.next();
    const otherWard = other.inbox.next();
    send(sender.ws, {
      type: 'updateMember',
      requestId: 'set-photo',
      memberId: ada.id,
      patch: { photoRef: REF },
    });

    expect(asRecord(await ack)).toEqual({ type: 'memberUpdated', requestId: 'set-photo' });
    const senderBody = asRecord(await senderWard);
    const otherBody = asRecord(await otherWard);
    expect(senderBody.type).toBe('ward');
    expect(otherBody.type).toBe('ward');
    expect(wardMember(senderBody, ada.id).photoRef).toBe(REF);
    expect(wardMember(otherBody, ada.id).photoRef).toBe(REF);
    expect(wardMember(otherBody, ada.id).name).toBe(before.name);
    expect(wardMember(otherBody, ada.id).note).toBe(before.note);
    expect(wardMember(otherBody, ada.id).tagIds).toEqual([...before.tagIds]);

    sender.ws.close();
    other.ws.close();
    await sender.inbox.closed();
    await other.inbox.closed();
    await restart(session);
    const reloaded = memberNamed(session.store.loadWard(), 'Ada Fictional');
    expect(reloaded.photoRef).toBe(REF);
    expect(reloaded.name).toBe(before.name);
    expect(reloaded.note).toBe(before.note);
    expect(reloaded.tagIds).toEqual([...before.tagIds]);
  });

  it('invalid photoRef and unknown member do not write', async () => {
    const session = await startEditor();
    const ada = memberNamed(session.store.loadWard(), 'Ada Fictional');
    session.db.prepare('UPDATE members SET photo_ref = ? WHERE id = ?').run(STORED, ada.id);
    expect(session.store.loadWard().members[ada.id]?.photoRef).toBe(STORED);
    const { ws, inbox } = await openInbox(session);

    const bad = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'bad-photo',
      memberId: ada.id,
      patch: { photoRef: '../x' },
    });
    expect(asRecord(await bad)).toMatchObject({
      type: 'rejected',
      requestId: 'bad-photo',
      code: 'bad_request',
      message: PHOTO_MESSAGE,
    });
    expect(session.store.loadWard().members[ada.id]?.photoRef).toBe(STORED);

    const missing = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'missing-member',
      memberId: 'missing-member',
      patch: { photoRef: OTHER },
    });
    expect(asRecord(await missing)).toMatchObject({
      type: 'rejected',
      requestId: 'missing-member',
      code: 'not_found',
    });
    expect(session.store.loadWard().members[ada.id]?.photoRef).toBe(STORED);
    expect(ws.readyState).toBe(Socket.OPEN);
  });

  it('revoked session cannot set photoRef', async () => {
    const session = await startSession({
      identity: EDITOR,
      initialAdminLogin: ADMIN.login,
      seed: seedDraftProposals(1),
    });
    const admin = session.access.listUsers().find((user) => user.login === ADMIN.login);
    if (admin === undefined) throw new Error('missing admin');
    const ada = memberNamed(session.store.loadWard(), 'Ada Fictional');
    session.db.prepare('UPDATE members SET photo_ref = ? WHERE id = ?').run(STORED, ada.id);
    expect(session.access.invite(admin.id, EDITOR.login).ok).toBe(true);

    const { ws, inbox } = await openInbox(session);
    const editor = session.access.listUsers().find((user) => user.login === EDITOR.login);
    if (editor === undefined) throw new Error('missing editor');
    expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });

    const closed = inbox.closed();
    const pending = inbox.next();
    send(ws, {
      type: 'updateMember',
      requestId: 'revoked-photo',
      memberId: ada.id,
      patch: { photoRef: OTHER },
    });

    expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
    expect(await closed).toBe(4403);
    expect(session.store.loadWard().members[ada.id]?.photoRef).toBe(STORED);
  });
});
