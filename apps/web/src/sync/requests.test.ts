import { createElement, type ReactElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REPLY_MS, SyncClient, type SyncDeps, type WebSocketLike } from './client.ts';
import * as syncReact from './react.tsx';

const OFFLINE = { ok: false, code: 'offline', message: 'offline' };

const USERS = [
  {
    id: 'user-1',
    login: 'admin@example.test',
    displayName: 'Admin Example',
    role: 'admin' as const,
    createdAt: '2026-07-01T00:00:00.000Z',
    revokedAt: null,
  },
];

const INVITATIONS = [
  {
    id: 'inv-1',
    login: 'editor@example.test',
    invitedBy: 'user-1',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
];

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

function frames(socket: FakeSocket): unknown[] {
  return socket.sent.map((frame) => JSON.parse(frame) as unknown);
}

function lastFrame(socket: FakeSocket): unknown {
  const frame = frames(socket).at(-1);
  if (frame === undefined) throw new Error('no frame sent');
  return frame;
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

function live(): ReturnType<typeof harness> & { socket: FakeSocket } {
  const mounted = harness();
  mounted.client.start();
  const socket = requireSocket(mounted.sockets);
  socket.open();
  return { ...mounted, socket };
}

function AccessLabel(): ReactElement {
  const access = syncReact.useAccess();
  const text = access === null ? 'none' : access.users.map((user) => user.login).join(',');
  return createElement('p', null, text);
}

async function expectOffline(client: SyncClient): Promise<void> {
  await expect(
    client.createProposal({ name: 'Fall plan', rationale: null, source: { kind: 'current' } }),
  ).resolves.toEqual(OFFLINE);
  await expect(
    client.createProposal({
      name: 'Copy',
      rationale: 'Because',
      source: { kind: 'proposal', proposalId: 'pr-1' },
    }),
  ).resolves.toEqual(OFFLINE);
  await expect(client.updateMember('member-1', { note: 'Hello' })).resolves.toEqual(OFFLINE);
  await expect(client.setShowNeedsApproval(true)).resolves.toEqual(OFFLINE);
  await expect(client.listAccess()).resolves.toEqual(OFFLINE);
  await expect(client.invite('editor@example.test')).resolves.toEqual(OFFLINE);
  await expect(client.revokeInvitation('inv-1')).resolves.toEqual(OFFLINE);
  await expect(client.revokeUser('user-2')).resolves.toEqual(OFFLINE);
  await expect(client.setRole('user-2', 'editor')).resolves.toEqual(OFFLINE);
  await expect(client.transferAdmin('user-2')).resolves.toEqual(OFFLINE);
}

describe('sync request methods', () => {
  it('createProposal sends the frame and resolves proposalCreated or rejected', async () => {
    const { client, socket } = live();
    const pending = client.createProposal({
      name: 'Fall plan',
      rationale: null,
      source: { kind: 'current' },
    });
    expect(lastFrame(socket)).toEqual({
      type: 'createProposal',
      requestId: 'req-1',
      name: 'Fall plan',
      rationale: null,
      source: { kind: 'current' },
    });
    socket.receive({
      type: 'proposalCreated',
      requestId: 'req-1',
      proposalId: 'pr-9',
      boardId: 'board-9',
    });
    await expect(pending).resolves.toEqual({ ok: true, proposalId: 'pr-9', boardId: 'board-9' });

    const copied = client.createProposal({
      name: 'Copy',
      rationale: 'Because',
      source: { kind: 'proposal', proposalId: 'pr-9' },
    });
    expect(lastFrame(socket)).toEqual({
      type: 'createProposal',
      requestId: 'req-2',
      name: 'Copy',
      rationale: 'Because',
      source: { kind: 'proposal', proposalId: 'pr-9' },
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'not_found',
      message: 'proposal pr-9 does not exist',
    });
    await expect(copied).resolves.toEqual({
      ok: false,
      code: 'not_found',
      message: 'proposal pr-9 does not exist',
    });
    expect(client.getState().notice).toBeNull();
    expect(client.getState().status).toBe('live');
  });

  it('updateMember sends the patch and resolves memberUpdated or rejected', async () => {
    const { client, socket } = live();
    const patch = { name: 'Ada Example', note: 'Fictional note', tagIds: ['tag-1'] };
    const pending = client.updateMember('member-1', patch);
    expect(lastFrame(socket)).toEqual({
      type: 'updateMember',
      requestId: 'req-1',
      memberId: 'member-1',
      patch,
    });
    socket.receive({ type: 'memberUpdated', requestId: 'req-1' });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(client.getState().ward).toBeNull();

    const tooLong = 'a'.repeat(281);
    const refused = client.updateMember('member-1', { note: tooLong });
    expect(lastFrame(socket)).toEqual({
      type: 'updateMember',
      requestId: 'req-2',
      memberId: 'member-1',
      patch: { note: tooLong },
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'bad_request',
      message: 'note must be at most 280 characters',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'bad_request',
      message: 'note must be at most 280 characters',
    });
    expect(client.getState().notice).toBeNull();
  });

  it('setShowNeedsApproval resolves the settings broadcast and a rejected refusal', async () => {
    const { client, socket } = live();
    const reading = client.loadSettings();
    const pending = client.setShowNeedsApproval(true);
    expect(frames(socket)).toEqual([
      { type: 'listBoards' },
      { type: 'getSettings', requestId: 'req-1' },
      { type: 'setShowNeedsApproval', requestId: 'req-2', value: true },
    ]);
    socket.receive({ type: 'settings', requestId: 'req-1', showNeedsApproval: false });
    await expect(reading).resolves.toEqual({ showNeedsApproval: false });
    let settled = false;
    const done = pending.then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    socket.receive({ type: 'settings', requestId: '', showNeedsApproval: true });
    await expect(done).resolves.toEqual({ ok: true });
    expect(client.getState().settings).toEqual({ showNeedsApproval: true });
    expect(client.getState().notice).toBeNull();

    const refused = client.setShowNeedsApproval(false);
    expect(lastFrame(socket)).toEqual({
      type: 'setShowNeedsApproval',
      requestId: 'req-3',
      value: false,
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-3',
      code: 'forbidden',
      message: 'only an admin can change show needs approval',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can change show needs approval',
    });
    expect(client.getState().settings).toEqual({ showNeedsApproval: true });
    expect(client.getState().notice).toBeNull();
    expect(client.getState().status).toBe('live');
  });

  it('listAccess sends the frame and resolves the access reply or rejected', async () => {
    const { client, socket } = live();
    const pending = client.listAccess();
    expect(lastFrame(socket)).toEqual({ type: 'listAccess', requestId: 'req-1' });
    socket.receive({
      type: 'access',
      requestId: 'req-1',
      users: USERS,
      invitations: INVITATIONS,
    });
    await expect(pending).resolves.toEqual({ ok: true, users: USERS, invitations: INVITATIONS });
    expect(client.getState().access).toEqual({ users: USERS, invitations: INVITATIONS });

    const refused = client.listAccess();
    expect(lastFrame(socket)).toEqual({ type: 'listAccess', requestId: 'req-2' });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'forbidden',
      message: 'only an admin can list access',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can list access',
    });
    expect(client.getState().access).toEqual({ users: USERS, invitations: INVITATIONS });
    expect(client.getState().notice).toBeNull();
    expect(client.getState().status).toBe('live');
  });

  it('invite sends the frame and resolves accessUpdated or rejected', async () => {
    const { client, socket } = live();
    const pending = client.invite('editor@example.test');
    expect(lastFrame(socket)).toEqual({
      type: 'invite',
      requestId: 'req-1',
      login: 'editor@example.test',
    });
    socket.receive({ type: 'accessUpdated', requestId: 'req-1' });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(client.getState().access).toBeNull();

    const refused = client.invite('editor@example.test');
    expect(lastFrame(socket)).toEqual({
      type: 'invite',
      requestId: 'req-2',
      login: 'editor@example.test',
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'already_invited',
      message: 'already invited',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'already_invited',
      message: 'already invited',
    });
    expect(client.getState().notice).toBeNull();
    expect(client.getState().status).toBe('live');
  });

  it('revokeInvitation sends the frame and resolves accessUpdated or rejected', async () => {
    const { client, socket } = live();
    const pending = client.revokeInvitation('inv-1');
    expect(lastFrame(socket)).toEqual({
      type: 'revokeInvitation',
      requestId: 'req-1',
      invitationId: 'inv-1',
    });
    socket.receive({ type: 'accessUpdated', requestId: 'req-1' });
    await expect(pending).resolves.toEqual({ ok: true });

    const refused = client.revokeInvitation('missing');
    expect(lastFrame(socket)).toEqual({
      type: 'revokeInvitation',
      requestId: 'req-2',
      invitationId: 'missing',
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'not_found',
      message: 'not found',
    });
    await expect(refused).resolves.toEqual({ ok: false, code: 'not_found', message: 'not found' });
    expect(client.getState().notice).toBeNull();
  });

  it('revokeUser sends the frame and resolves accessUpdated or rejected', async () => {
    const { client, socket } = live();
    const pending = client.revokeUser('user-2');
    expect(lastFrame(socket)).toEqual({
      type: 'revokeUser',
      requestId: 'req-1',
      userId: 'user-2',
    });
    socket.receive({ type: 'accessUpdated', requestId: 'req-1' });
    await expect(pending).resolves.toEqual({ ok: true });

    const refused = client.revokeUser('user-1');
    expect(lastFrame(socket)).toEqual({
      type: 'revokeUser',
      requestId: 'req-2',
      userId: 'user-1',
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'last_admin',
      message: 'cannot change the last admin',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'last_admin',
      message: 'cannot change the last admin',
    });
    expect(client.getState().notice).toBeNull();
  });

  it('setRole sends the frame and resolves accessUpdated or rejected', async () => {
    const { client, socket } = live();
    const pending = client.setRole('user-2', 'admin');
    expect(lastFrame(socket)).toEqual({
      type: 'setRole',
      requestId: 'req-1',
      userId: 'user-2',
      role: 'admin',
    });
    socket.receive({ type: 'accessUpdated', requestId: 'req-1' });
    await expect(pending).resolves.toEqual({ ok: true });

    const refused = client.setRole('user-2', 'editor');
    expect(lastFrame(socket)).toEqual({
      type: 'setRole',
      requestId: 'req-2',
      userId: 'user-2',
      role: 'editor',
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'forbidden',
      message: 'only an admin can set a role',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can set a role',
    });
    expect(client.getState().notice).toBeNull();
    expect(client.getState().status).toBe('live');
  });

  it('transferAdmin sends the frame and resolves accessUpdated or rejected', async () => {
    const { client, socket } = live();
    const pending = client.transferAdmin('user-2');
    expect(lastFrame(socket)).toEqual({
      type: 'transferAdmin',
      requestId: 'req-1',
      toUserId: 'user-2',
    });
    socket.receive({ type: 'accessUpdated', requestId: 'req-1' });
    await expect(pending).resolves.toEqual({ ok: true });

    const refused = client.transferAdmin('user-1');
    expect(lastFrame(socket)).toEqual({
      type: 'transferAdmin',
      requestId: 'req-2',
      toUserId: 'user-1',
    });
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'invalid_login',
      message: 'invalid login',
    });
    await expect(refused).resolves.toEqual({
      ok: false,
      code: 'invalid_login',
      message: 'invalid login',
    });
    expect(client.getState().notice).toBeNull();
  });

  it('offline before send resolves offline and sends nothing', async () => {
    const { client, sockets } = harness();
    await expectOffline(client);
    expect(sockets).toHaveLength(0);

    client.start();
    const socket = requireSocket(sockets);
    await expectOffline(client);
    expect(frames(socket)).toEqual([]);

    socket.open();
    socket.close(1006);
    const sent = socket.sent.length;
    await expectOffline(client);
    expect(socket.sent).toHaveLength(sent);
    expect(client.getState().status).toBe('offline');
  });

  it('a pending request resolves offline when the socket closes', async () => {
    const { client, socket } = live();
    const invite = client.invite('editor@example.test');
    const role = client.setRole('user-2', 'admin');
    expect(frames(socket)).toEqual([
      { type: 'listBoards' },
      { type: 'invite', requestId: 'req-1', login: 'editor@example.test' },
      { type: 'setRole', requestId: 'req-2', userId: 'user-2', role: 'admin' },
    ]);
    socket.close(1006);
    await expect(invite).resolves.toEqual(OFFLINE);
    await expect(role).resolves.toEqual(OFFLINE);
    expect(client.getState().status).toBe('offline');
    expect(client.getState().notice).toBeNull();
  });

  it('a missing reply resolves offline at REPLY_MS', async () => {
    const { client, socket, advance } = live();
    let settled = false;
    const pending = client
      .createProposal({ name: 'Fall plan', rationale: null, source: { kind: 'current' } })
      .then((result) => {
        settled = true;
        return result;
      });
    expect(lastFrame(socket)).toEqual({
      type: 'createProposal',
      requestId: 'req-1',
      name: 'Fall plan',
      rationale: null,
      source: { kind: 'current' },
    });
    advance(REPLY_MS - 1);
    expect(settled).toBe(false);
    expect(socket.readyState).toBe(1);
    advance(1);
    await expect(pending).resolves.toEqual(OFFLINE);
    expect(client.getState().notice).toBeNull();
    socket.receive({
      type: 'proposalCreated',
      requestId: 'req-1',
      proposalId: 'pr-late',
      boardId: 'board-late',
    });
    expect(client.getState().boards).toBeNull();
  });

  it('an access push updates state and disconnect resets it to null', async () => {
    const { client, socket } = live();
    const pending = client.listAccess();
    let settled = false;
    const done = pending.then((result) => {
      settled = true;
      return result;
    });
    socket.receive({ type: 'access', requestId: '', users: USERS, invitations: INVITATIONS });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(client.getState().access).toEqual({ users: USERS, invitations: INVITATIONS });

    socket.receive({ type: 'access', requestId: 'req-1', users: USERS, invitations: [] });
    await expect(done).resolves.toEqual({ ok: true, users: USERS, invitations: [] });
    expect(client.getState().access).toEqual({ users: USERS, invitations: [] });

    socket.close(1006);
    expect(client.getState().access).toBeNull();
    expect(client.getState().status).toBe('offline');
  });

  it('useAccess re-renders when an access push arrives', () => {
    const { client, socket } = live();
    render(createElement(syncReact.SyncProvider, { client, children: createElement(AccessLabel) }));
    expect(screen.getByText('none')).toBeInTheDocument();

    act(() => {
      socket.receive({ type: 'access', requestId: '', users: USERS, invitations: INVITATIONS });
    });
    expect(screen.getByText('admin@example.test')).toBeInTheDocument();
    expect(screen.queryByText('none')).not.toBeInTheDocument();

    act(() => {
      socket.close(1006);
    });
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(client.getState().access).toBeNull();
  });

  it('a rejected request does not raise a notice or resolve another read', async () => {
    const { client, socket } = live();
    const who = client.whoami();
    const invited = client.invite('editor@example.test');
    socket.receive({
      type: 'rejected',
      requestId: 'req-2',
      code: 'forbidden',
      message: 'only an admin can invite',
    });
    await expect(invited).resolves.toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can invite',
    });
    expect(client.getState().notice).toBeNull();
    expect(client.getState().status).toBe('live');
    let whoSettled = false;
    const whoDone = who.then((value) => {
      whoSettled = true;
      return value;
    });
    await Promise.resolve();
    expect(whoSettled).toBe(false);
    const me = { login: 'admin@example.test', displayName: 'Admin Example', role: 'admin' as const };
    socket.receive({ type: 'me', requestId: 'req-1', user: me });
    await expect(whoDone).resolves.toEqual(me);
    expect(client.getState().me).toEqual(me);

    client.open('board-1');
    socket.receive({
      type: 'snapshot',
      boardId: 'board-1',
      version: 1,
      board: { id: 'board-1', version: 1, placements: { 'p-1': 'm-1' } },
      ward: { id: 'ward-1' },
      proposal: null,
    });
    const op = client.send('moveToDugout', { memberId: 'm-1', from: 'p-1' });
    socket.receive({
      type: 'rejected',
      requestId: 'req-3',
      code: 'not_editable',
      message: 'cannot edit',
    });
    await expect(op).resolves.toEqual({ ok: false, code: 'not_editable', message: 'cannot edit' });
    expect(client.getState().notice).toEqual({
      kind: 'rejected',
      requestId: 'req-3',
      code: 'not_editable',
      message: 'cannot edit',
    });
  });
});
