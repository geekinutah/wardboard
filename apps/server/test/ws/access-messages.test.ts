import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccessResult, Invitation, User } from '../../src/access/index.ts';
import type { Identity } from '../../src/identity/index.ts';
import {
  ADMIN,
  EDITOR,
  FIXED_TIME,
  Inbox,
  asRecord,
  cleanup,
  openActor,
  openSocket,
  startActorSession,
  startAdmin,
  startSession,
  type Session,
} from './helpers.ts';

afterEach(cleanup);

const SECOND: Identity = { login: 'second-admin@example.test', displayName: 'Second Admin' };
const MEMBER: Identity = { login: 'member@example.test', displayName: 'Member Example' };
const PENDING_LOGIN = 'pending@example.test';

function send(ws: WebSocket, message: unknown): void {
  ws.send(JSON.stringify(message));
}

function expectRejected(
  message: Record<string, unknown>,
  requestId: string,
  code: string,
  absent?: string,
): void {
  expect(message.type).toBe('rejected');
  expect(message.requestId).toBe(requestId);
  expect(message.code).toBe(code);
  expect(Object.keys(message).sort()).toEqual(['code', 'message', 'requestId', 'type']);
  const text = message.message;
  expect(typeof text).toBe('string');
  if (typeof text !== 'string') return;
  expect(text.length).toBeGreaterThan(0);
  if (absent !== undefined) expect(text).not.toContain(absent);
}

function requireUser(session: Session, login: string): User {
  const user = session.access.listUsers().find((candidate) => candidate.login === login);
  if (user === undefined) throw new Error(`missing user ${login}`);
  return user;
}

function requireOk<T>(result: AccessResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

function requireResolved(session: Session, identity: Identity): User {
  const result = session.access.resolve(identity);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`resolve failed for ${identity.login}`);
  return result.user;
}

function accessSnapshot(session: Session): { users: readonly User[]; invitations: readonly Invitation[] } {
  return {
    users: session.access.listUsers(),
    invitations: session.access.listInvitations(),
  };
}

async function openInbox(session: Session): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = await openSocket(session);
  return { ws, inbox: new Inbox(ws) };
}

async function openActorInbox(session: Session, identity: Identity): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = await openActor(session, identity);
  return { ws, inbox: new Inbox(ws) };
}

function nextOrClose(
  inbox: Inbox,
): Promise<{ kind: 'message'; message: unknown } | { kind: 'closed'; code: number }> {
  return Promise.race([
    inbox.next().then((message) => ({ kind: 'message' as const, message })),
    inbox.closed().then((code) => ({ kind: 'closed' as const, code })),
  ]);
}

function accessFrame(session: Session): Record<string, unknown> {
  return {
    type: 'access',
    requestId: '',
    users: session.access.listUsers(),
    invitations: session.access.listInvitations(),
  };
}

async function expectAccessBroadcast(inbox: Inbox, requestId: string, session: Session): Promise<void> {
  expect(asRecord(await inbox.next())).toEqual({ type: 'accessUpdated', requestId });
  expect(asRecord(await inbox.next())).toEqual(accessFrame(session));
}

const SIX = [
  'listAccess',
  'invite',
  'revokeInvitation',
  'revokeUser',
  'setRole',
  'transferAdmin',
] as const;

describe('access management messages', () => {
  it('admin listAccess returns users (including revoked) and pending invitations', async () => {
    const session = await startAdmin();
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, EDITOR.login));
    requireResolved(session, EDITOR);
    requireOk(session.access.revokeUser(admin.id, requireUser(session, EDITOR.login).id));
    requireOk(session.access.invite(admin.id, PENDING_LOGIN));
    const { ws, inbox } = await openInbox(session);

    const pending = inbox.next();
    send(ws, { type: 'listAccess', requestId: 'list-1' });
    const message = asRecord(await pending);

    expect(message).toEqual({
      type: 'access',
      requestId: 'list-1',
      users: session.access.listUsers(),
      invitations: session.access.listInvitations(),
    });
    expect(message.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ login: ADMIN.login, role: 'admin', revokedAt: null }),
        expect.objectContaining({ login: EDITOR.login, role: 'editor', revokedAt: FIXED_TIME }),
      ]),
    );
    expect(message.invitations).toEqual([
      expect.objectContaining({ login: PENDING_LOGIN, invitedBy: admin.id, createdAt: FIXED_TIME }),
    ]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('Editor gets forbidden for each of the six messages; connection stays open; nothing changes', async () => {
    const session = await startSession({ identity: EDITOR, initialAdminLogin: ADMIN.login });
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, EDITOR.login));
    requireOk(session.access.invite(admin.id, MEMBER.login));
    const member = requireResolved(session, MEMBER);
    const invitation = requireOk(session.access.invite(admin.id, PENDING_LOGIN));
    const { ws, inbox } = await openInbox(session);
    const before = accessSnapshot(session);
    const messages = [
      { type: 'listAccess', requestId: 'editor-list' },
      { type: 'invite', requestId: 'editor-invite', login: 'fresh@example.test' },
      { type: 'revokeInvitation', requestId: 'editor-invitation', invitationId: invitation.id },
      { type: 'revokeUser', requestId: 'editor-user', userId: member.id },
      { type: 'setRole', requestId: 'editor-role', userId: member.id, role: 'admin' },
      { type: 'transferAdmin', requestId: 'editor-transfer', toUserId: member.id },
    ];
    expect(messages.map((message) => message.type)).toEqual([...SIX]);

    for (const message of messages) {
      const pending = inbox.next();
      send(ws, message);
      const rejected = asRecord(await pending);
      expectRejected(rejected, message.requestId, 'forbidden');
      expect(JSON.stringify(rejected)).not.toContain(PENDING_LOGIN);
      expect(JSON.stringify(rejected)).not.toContain(MEMBER.login);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    expect(accessSnapshot(session)).toEqual(before);
    const me = inbox.next();
    send(ws, { type: 'whoami', requestId: 'editor-still' });
    expect(asRecord(await me)).toEqual({
      type: 'me',
      requestId: 'editor-still',
      user: { login: EDITOR.login, displayName: EDITOR.displayName, role: 'editor' },
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('revoked session sending each of the six messages → error forbidden, close 4403, no state change', async () => {
    const session = await startSession({ identity: EDITOR, initialAdminLogin: ADMIN.login });
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, MEMBER.login));
    const member = requireResolved(session, MEMBER);
    const invitation = requireOk(session.access.invite(admin.id, PENDING_LOGIN));
    const messages = [
      { type: 'listAccess', requestId: 'revoked-list' },
      { type: 'invite', requestId: 'revoked-invite', login: 'fresh@example.test' },
      { type: 'revokeInvitation', requestId: 'revoked-invitation', invitationId: invitation.id },
      { type: 'revokeUser', requestId: 'revoked-user', userId: admin.id },
      { type: 'setRole', requestId: 'revoked-role', userId: member.id, role: 'admin' },
      { type: 'transferAdmin', requestId: 'revoked-transfer', toUserId: member.id },
    ];
    expect(messages.map((message) => message.type)).toEqual([...SIX]);

    for (const message of messages) {
      requireOk(session.access.invite(admin.id, EDITOR.login));
      const { ws, inbox } = await openInbox(session);
      const editor = requireUser(session, EDITOR.login);
      expect(session.access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });
      const before = accessSnapshot(session);

      const closed = inbox.closed();
      const pending = inbox.next();
      send(ws, message);

      expect(asRecord(await pending)).toEqual({ type: 'error', code: 'forbidden' });
      expect(await closed).toBe(4403);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(accessSnapshot(session)).toEqual(before);
    }
  });

  it('admin demoted mid-connection is refused invite with forbidden', async () => {
    const session = await startAdmin();
    const admin = requireUser(session, ADMIN.login);
    const { ws, inbox } = await openInbox(session);
    requireOk(session.access.invite(admin.id, SECOND.login));
    const second = requireResolved(session, SECOND);
    requireOk(session.access.setRole(admin.id, second.id, 'admin'));
    requireOk(session.access.setRole(admin.id, admin.id, 'editor'));
    const before = accessSnapshot(session);

    const pending = inbox.next();
    send(ws, { type: 'invite', requestId: 'demoted-invite', login: 'fresh@example.test' });
    expectRejected(asRecord(await pending), 'demoted-invite', 'forbidden');
    expect(accessSnapshot(session)).toEqual(before);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const listed = inbox.next();
    send(ws, { type: 'listAccess', requestId: 'demoted-list' });
    expectRejected(asRecord(await listed), 'demoted-list', 'forbidden');
    expect(accessSnapshot(session)).toEqual(before);

    const me = inbox.next();
    send(ws, { type: 'whoami', requestId: 'demoted-me' });
    expect(asRecord(await me)).toEqual({
      type: 'me',
      requestId: 'demoted-me',
      user: { login: ADMIN.login, displayName: ADMIN.displayName, role: 'editor' },
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('invite: accessUpdated to sender; access list to every admin connection and to no editor connection', async () => {
    const session = await startActorSession();
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, EDITOR.login));
    requireResolved(session, EDITOR);
    requireOk(session.access.invite(admin.id, SECOND.login));
    const second = requireResolved(session, SECOND);
    requireOk(session.access.setRole(admin.id, second.id, 'admin'));
    const sender = await openActorInbox(session, ADMIN);
    const other = await openActorInbox(session, SECOND);
    const editor = await openActorInbox(session, EDITOR);

    const senderUpdated = sender.inbox.next();
    const senderAccess = sender.inbox.next();
    const otherAccess = other.inbox.next();
    send(sender.ws, { type: 'invite', requestId: 'invite-1', login: 'counselor@example.test' });

    expect(asRecord(await senderUpdated)).toEqual({ type: 'accessUpdated', requestId: 'invite-1' });
    const frame = accessFrame(session);
    expect(asRecord(await senderAccess)).toEqual(frame);
    expect(asRecord(await otherAccess)).toEqual(frame);
    expect(frame.invitations).toEqual([
      expect.objectContaining({ login: 'counselor@example.test', invitedBy: admin.id, createdAt: FIXED_TIME }),
    ]);

    const editorNext = editor.inbox.next();
    send(editor.ws, { type: 'whoami', requestId: 'editor-me' });
    expect(asRecord(await editorNext)).toEqual({
      type: 'me',
      requestId: 'editor-me',
      user: { login: EDITOR.login, displayName: EDITOR.displayName, role: 'editor' },
    });
    expect(editor.ws.readyState).toBe(WebSocket.OPEN);
    expect(other.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('invite errors pass through: invalid_login, already_user, already_invited', async () => {
    const session = await startAdmin();
    const { ws, inbox } = await openInbox(session);

    const invalid = inbox.next();
    send(ws, { type: 'invite', requestId: 'bad-login', login: 'bad login' });
    expectRejected(asRecord(await invalid), 'bad-login', 'invalid_login', 'bad login');

    const alreadyUser = inbox.next();
    send(ws, { type: 'invite', requestId: 'already-user', login: ADMIN.login });
    expectRejected(asRecord(await alreadyUser), 'already-user', 'already_user', ADMIN.login);

    send(ws, { type: 'invite', requestId: 'invite-new', login: 'fresh@example.test' });
    await expectAccessBroadcast(inbox, 'invite-new', session);
    expect(session.access.listInvitations().map((invitation) => invitation.login)).toEqual(['fresh@example.test']);

    const duplicate = inbox.next();
    send(ws, { type: 'invite', requestId: 'already-invited', login: 'fresh@example.test' });
    expectRejected(asRecord(await duplicate), 'already-invited', 'already_invited', 'fresh@example.test');
    expect(session.access.listInvitations()).toHaveLength(1);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('revokeInvitation then a second revoke → revoked; unknown id → not_found', async () => {
    const session = await startAdmin();
    const admin = requireUser(session, ADMIN.login);
    const invitation = requireOk(session.access.invite(admin.id, PENDING_LOGIN));
    const { ws, inbox } = await openInbox(session);

    send(ws, { type: 'revokeInvitation', requestId: 'revoke-1', invitationId: invitation.id });
    await expectAccessBroadcast(inbox, 'revoke-1', session);
    expect(session.access.listInvitations()).toEqual([]);

    const again = inbox.next();
    send(ws, { type: 'revokeInvitation', requestId: 'revoke-2', invitationId: invitation.id });
    expectRejected(asRecord(await again), 'revoke-2', 'revoked', PENDING_LOGIN);

    const missing = inbox.next();
    send(ws, { type: 'revokeInvitation', requestId: 'revoke-missing', invitationId: 'missing-invitation' });
    expectRejected(asRecord(await missing), 'revoke-missing', 'not_found', 'missing-invitation');
    expect(session.access.listInvitations()).toEqual([]);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('revokeUser closes every open connection of that user with 4403 immediately, without them sending a message', async () => {
    const session = await startActorSession();
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, EDITOR.login));
    const editor = requireResolved(session, EDITOR);
    const adminSock = await openActorInbox(session, ADMIN);
    const left = await openActorInbox(session, EDITOR);
    const right = await openActorInbox(session, EDITOR);

    const missing = adminSock.inbox.next();
    send(adminSock.ws, { type: 'revokeUser', requestId: 'missing-user', userId: 'missing-user' });
    expectRejected(asRecord(await missing), 'missing-user', 'not_found', 'missing-user');
    expect(left.ws.readyState).toBe(WebSocket.OPEN);
    expect(right.ws.readyState).toBe(WebSocket.OPEN);

    const updated = adminSock.inbox.next();
    const listed = adminSock.inbox.next();
    const leftEvent = nextOrClose(left.inbox);
    const rightEvent = nextOrClose(right.inbox);
    send(adminSock.ws, { type: 'revokeUser', requestId: 'revoke-editor', userId: editor.id });

    expect(asRecord(await updated)).toEqual({ type: 'accessUpdated', requestId: 'revoke-editor' });
    expect(await leftEvent).toEqual({ kind: 'message', message: { type: 'error', code: 'forbidden' } });
    expect(await rightEvent).toEqual({ kind: 'message', message: { type: 'error', code: 'forbidden' } });
    expect(await left.inbox.closed()).toBe(4403);
    expect(await right.inbox.closed()).toBe(4403);
    expect(asRecord(await listed)).toEqual(accessFrame(session));
    expect(requireUser(session, EDITOR.login).revokedAt).toBe(FIXED_TIME);
    expect(adminSock.ws.readyState).toBe(WebSocket.OPEN);
    expect(left.ws.readyState).toBe(WebSocket.CLOSED);
    expect(right.ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('revokeUser of the last active admin → last_admin and no connection closed', async () => {
    const session = await startAdmin();
    const admin = requireUser(session, ADMIN.login);
    const first = await openInbox(session);
    const second = await openInbox(session);
    const before = accessSnapshot(session);

    const pending = first.inbox.next();
    send(first.ws, { type: 'revokeUser', requestId: 'last-admin', userId: admin.id });
    expectRejected(asRecord(await pending), 'last-admin', 'last_admin');
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
    expect(accessSnapshot(session)).toEqual(before);

    const still = second.inbox.next();
    send(second.ws, { type: 'listAccess', requestId: 'still-admin' });
    expect(asRecord(await still)).toEqual({
      type: 'access',
      requestId: 'still-admin',
      users: session.access.listUsers(),
      invitations: session.access.listInvitations(),
    });
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
    expect(second.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("setRole admin→editor on the last admin → last_admin; with two admins it succeeds and the demoted user's next admin message is forbidden", async () => {
    const session = await startActorSession();
    const admin = requireUser(session, ADMIN.login);
    const actor = await openActorInbox(session, ADMIN);

    const denied = actor.inbox.next();
    send(actor.ws, { type: 'setRole', requestId: 'last-role', userId: admin.id, role: 'editor' });
    expectRejected(asRecord(await denied), 'last-role', 'last_admin');
    expect(requireUser(session, ADMIN.login).role).toBe('admin');
    expect(actor.ws.readyState).toBe(WebSocket.OPEN);

    requireOk(session.access.invite(admin.id, SECOND.login));
    const second = requireResolved(session, SECOND);
    requireOk(session.access.setRole(admin.id, second.id, 'admin'));
    const demoted = await openActorInbox(session, SECOND);

    const updated = actor.inbox.next();
    const listed = actor.inbox.next();
    send(actor.ws, { type: 'setRole', requestId: 'demote', userId: second.id, role: 'editor' });
    expect(asRecord(await updated)).toEqual({ type: 'accessUpdated', requestId: 'demote' });
    expect(asRecord(await listed)).toEqual(accessFrame(session));
    expect(requireUser(session, SECOND.login).role).toBe('editor');
    expect(requireUser(session, ADMIN.login).role).toBe('admin');
    expect(demoted.ws.readyState).toBe(WebSocket.OPEN);

    const forbidden = demoted.inbox.next();
    send(demoted.ws, { type: 'invite', requestId: 'after-demote', login: 'fresh@example.test' });
    expectRejected(asRecord(await forbidden), 'after-demote', 'forbidden');
    expect(session.access.listInvitations()).toEqual([]);
    expect(demoted.ws.readyState).toBe(WebSocket.OPEN);
    expect(actor.ws.readyState).toBe(WebSocket.OPEN);

    const me = demoted.inbox.next();
    send(demoted.ws, { type: 'whoami', requestId: 'still-here' });
    expect(asRecord(await me)).toEqual({
      type: 'me',
      requestId: 'still-here',
      user: { login: SECOND.login, displayName: SECOND.displayName, role: 'editor' },
    });
  });

  it("transferAdmin makes target admin and actor editor; actor's next listAccess → forbidden; transfer to self → invalid_login", async () => {
    const session = await startActorSession();
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, EDITOR.login));
    const editor = requireResolved(session, EDITOR);
    const actor = await openActorInbox(session, ADMIN);
    const target = await openActorInbox(session, EDITOR);

    const selfDenied = actor.inbox.next();
    send(actor.ws, { type: 'transferAdmin', requestId: 'to-self', toUserId: admin.id });
    expectRejected(asRecord(await selfDenied), 'to-self', 'invalid_login', ADMIN.login);
    expect(requireUser(session, ADMIN.login).role).toBe('admin');
    expect(requireUser(session, EDITOR.login).role).toBe('editor');
    expect(actor.ws.readyState).toBe(WebSocket.OPEN);
    expect(target.ws.readyState).toBe(WebSocket.OPEN);

    const targetStill = target.inbox.next();
    send(target.ws, { type: 'whoami', requestId: 'target-before' });
    expect(asRecord(await targetStill)).toEqual({
      type: 'me',
      requestId: 'target-before',
      user: { login: EDITOR.login, displayName: EDITOR.displayName, role: 'editor' },
    });

    const updated = actor.inbox.next();
    const targetAccess = target.inbox.next();
    send(actor.ws, { type: 'transferAdmin', requestId: 'transfer', toUserId: editor.id });
    expect(asRecord(await updated)).toEqual({ type: 'accessUpdated', requestId: 'transfer' });
    expect(asRecord(await targetAccess)).toEqual(accessFrame(session));
    expect(requireUser(session, ADMIN.login).role).toBe('editor');
    expect(requireUser(session, EDITOR.login).role).toBe('admin');

    const actorDenied = actor.inbox.next();
    send(actor.ws, { type: 'listAccess', requestId: 'actor-after' });
    expectRejected(asRecord(await actorDenied), 'actor-after', 'forbidden');
    expect(actor.ws.readyState).toBe(WebSocket.OPEN);
    expect(target.ws.readyState).toBe(WebSocket.OPEN);

    const targetList = target.inbox.next();
    send(target.ws, { type: 'listAccess', requestId: 'target-after' });
    expect(asRecord(await targetList)).toEqual({
      type: 'access',
      requestId: 'target-after',
      users: session.access.listUsers(),
      invitations: session.access.listInvitations(),
    });
  });

  it('an admin revoking themselves (not last) gets accessUpdated, then their connections close with 4403', async () => {
    const session = await startActorSession();
    const admin = requireUser(session, ADMIN.login);
    requireOk(session.access.invite(admin.id, SECOND.login));
    const second = requireResolved(session, SECOND);
    requireOk(session.access.setRole(admin.id, second.id, 'admin'));
    const actor1 = await openActorInbox(session, ADMIN);
    const actor2 = await openActorInbox(session, ADMIN);
    const survivor = await openActorInbox(session, SECOND);

    const first = nextOrClose(actor1.inbox);
    const secondMessage = nextOrClose(actor1.inbox);
    const otherError = nextOrClose(actor2.inbox);
    const survivorAccess = survivor.inbox.next();
    send(actor1.ws, { type: 'revokeUser', requestId: 'self-revoke', userId: admin.id });

    expect(await first).toEqual({
      kind: 'message',
      message: { type: 'accessUpdated', requestId: 'self-revoke' },
    });
    expect(await secondMessage).toEqual({
      kind: 'message',
      message: { type: 'error', code: 'forbidden' },
    });
    expect(await actor1.inbox.closed()).toBe(4403);
    expect(await otherError).toEqual({
      kind: 'message',
      message: { type: 'error', code: 'forbidden' },
    });
    expect(await actor2.inbox.closed()).toBe(4403);
    expect(asRecord(await survivorAccess)).toEqual(accessFrame(session));
    expect(requireUser(session, ADMIN.login).revokedAt).not.toBeNull();
    expect(requireUser(session, SECOND.login).role).toBe('admin');
    expect(requireUser(session, SECOND.login).revokedAt).toBeNull();
    expect(actor1.ws.readyState).toBe(WebSocket.CLOSED);
    expect(actor2.ws.readyState).toBe(WebSocket.CLOSED);
    expect(survivor.ws.readyState).toBe(WebSocket.OPEN);

    const survivorStill = survivor.inbox.next();
    send(survivor.ws, { type: 'listAccess', requestId: 'survivor' });
    expect(asRecord(await survivorStill)).toMatchObject({ type: 'access', requestId: 'survivor' });
  });

  it('extra keys, empty strings, bad role value → bad_request', async () => {
    const session = await startAdmin();
    const { ws, inbox } = await openInbox(session);
    const before = accessSnapshot(session);
    const longId = 'x'.repeat(65);
    const cases: { requestId: string; body: Record<string, unknown> }[] = [
      { requestId: 'extra-list', body: { type: 'listAccess', requestId: 'extra-list', extra: true } },
      {
        requestId: 'extra-invite',
        body: { type: 'invite', requestId: 'extra-invite', login: 'a@example.test', extra: true },
      },
      {
        requestId: 'extra-invitation',
        body: { type: 'revokeInvitation', requestId: 'extra-invitation', invitationId: 'inv', extra: true },
      },
      {
        requestId: 'extra-user',
        body: { type: 'revokeUser', requestId: 'extra-user', userId: 'user', extra: true },
      },
      {
        requestId: 'extra-role',
        body: { type: 'setRole', requestId: 'extra-role', userId: 'user', role: 'editor', extra: true },
      },
      {
        requestId: 'extra-transfer',
        body: { type: 'transferAdmin', requestId: 'extra-transfer', toUserId: 'user', extra: true },
      },
      { requestId: '', body: { type: 'listAccess', requestId: '' } },
      { requestId: 'empty-login', body: { type: 'invite', requestId: 'empty-login', login: '' } },
      {
        requestId: 'empty-invitation',
        body: { type: 'revokeInvitation', requestId: 'empty-invitation', invitationId: '' },
      },
      { requestId: 'empty-user', body: { type: 'revokeUser', requestId: 'empty-user', userId: '' } },
      {
        requestId: 'empty-role-user',
        body: { type: 'setRole', requestId: 'empty-role-user', userId: '', role: 'admin' },
      },
      { requestId: 'empty-target', body: { type: 'transferAdmin', requestId: 'empty-target', toUserId: '' } },
      { requestId: 'bad-role', body: { type: 'setRole', requestId: 'bad-role', userId: 'someone', role: 'owner' } },
      { requestId: 'empty-role', body: { type: 'setRole', requestId: 'empty-role', userId: 'someone', role: '' } },
      { requestId: '', body: { type: 'invite', requestId: longId, login: 'a@example.test' } },
    ];

    for (const spec of cases) {
      const pending = inbox.next();
      send(ws, spec.body);
      expectRejected(asRecord(await pending), spec.requestId, 'bad_request');
    }

    expect(accessSnapshot(session)).toEqual(before);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    const me = inbox.next();
    send(ws, { type: 'whoami', requestId: 'after-bad' });
    expect(asRecord(await me)).toMatchObject({ type: 'me', requestId: 'after-bad' });
  });
});
