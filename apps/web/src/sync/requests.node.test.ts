// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

const ADMIN = { login: 'requests-admin@example.test', displayName: 'Requests Admin' };
const EDITOR = { login: 'requests-editor@example.test', displayName: 'Requests Editor' };

const running: RunningServer[] = [];
const directories: string[] = [];
const clients: SyncClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const server of running.splice(0)) await server.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function boot(
  port: number,
  identity: { login: string; displayName: string },
  existingDir?: string,
): Promise<{ server: RunningServer; dataDir: string }> {
  const dataDir = existingDir ?? (await mkdtemp(path.join(tmpdir(), 'wardboard-t075-')));
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
      initialAdminLogin: ADMIN.login,
    },
    { identityProvider: fixtureIdentityProvider(identity) },
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

async function openCurrent(client: SyncClient): Promise<SyncState> {
  const listed = await waitFor(client, (state) => {
    const current = state.boards?.current;
    return state.status === 'live' && current !== null && current !== undefined;
  });
  const boardId = listed.boards?.current?.boardId;
  if (boardId === undefined) throw new Error('missing current board');
  client.open(boardId);
  return waitFor(client, (state) => state.subscribedBoardId === boardId && state.ward !== null);
}

describe('sync request methods against a real server', () => {
  it('createProposal from Current returns ids and the new tab appears in boards', async () => {
    expect(typeof document).toBe('undefined');
    const { server } = await boot(0, ADMIN);
    const client = connect(server);
    const listed = await waitFor(client, (state) => state.status === 'live' && state.boards !== null);
    const before = listed.boards?.proposals.length ?? 0;

    const created = await client.createProposal({
      name: 'Fall plan',
      rationale: 'A fictional rationale.',
      source: { kind: 'current' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);

    const appeared = await waitFor(client, (state) =>
      (state.boards?.proposals ?? []).some(
        (item) => item.id === created.proposalId && item.boardId === created.boardId,
      ),
    );
    expect(appeared.boards?.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.proposalId,
          boardId: created.boardId,
          name: 'Fall plan',
          status: 'draft',
        }),
      ]),
    );
    expect(appeared.boards?.proposals.length).toBe(before + 1);
  }, 15_000);

  it('updateMember saves a note that a fresh fetch returns', async () => {
    const { server } = await boot(0, ADMIN);
    const client = connect(server);
    const snapped = await openCurrent(client);
    const ward = snapped.ward;
    if (ward === null) throw new Error('missing ward');
    const member = Object.values(ward.members)[0];
    if (member === undefined) throw new Error('ward has no members');

    const note = 'Fictional weekday travel note.';
    const saved = await client.updateMember(member.id, { note });
    expect(saved).toEqual({ ok: true });

    const fresh = connect(server);
    const fetched = await openCurrent(fresh);
    expect(fetched.ward?.members[member.id]?.note).toBe(note);

    const tooLong = 'a'.repeat(281);
    expect(Array.from(tooLong)).toHaveLength(281);
    const refused = await client.updateMember(member.id, { note: tooLong });
    expect(refused).toEqual({
      ok: false,
      code: 'bad_request',
      message: 'note must be at most 280 characters',
    });

    const again = connect(server);
    const still = await openCurrent(again);
    expect(still.ward?.members[member.id]?.note).toBe(note);
  }, 15_000);

  it('admin invite, setRole, revokeUser round-trip and push access', async () => {
    const started = await boot(0, ADMIN);
    const admin = connect(started.server);
    await waitFor(admin, (state) => state.status === 'live');

    const invited = await admin.invite(EDITOR.login);
    expect(invited).toEqual({ ok: true });
    await waitFor(
      admin,
      (state) => state.access?.invitations.some((invitation) => invitation.login === EDITOR.login) === true,
    );

    admin.stop();
    await started.server.close();
    const asEditor = await boot(0, EDITOR, started.dataDir);
    const editor = connect(asEditor.server);
    await waitFor(editor, (state) => state.status === 'live', 12_000);
    editor.stop();
    await asEditor.server.close();

    const asAdmin = await boot(0, ADMIN, started.dataDir);
    const again = connect(asAdmin.server);
    await waitFor(again, (state) => state.status === 'live', 12_000);
    const listed = await again.listAccess();
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.message);
    const editorUser = listed.users.find((user) => user.login === EDITOR.login);
    if (editorUser === undefined) throw new Error('editor did not become a user');
    expect(editorUser.role).toBe('editor');
    expect(editorUser.revokedAt).toBeNull();
    expect(listed.invitations.some((invitation) => invitation.login === EDITOR.login)).toBe(false);
    expect(again.getState().access?.users).toEqual(expect.arrayContaining([expect.objectContaining(editorUser)]));

    const promoted = await again.setRole(editorUser.id, 'admin');
    expect(promoted).toEqual({ ok: true });
    await waitFor(
      again,
      (state) =>
        state.access?.users.some(
          (user) => user.id === editorUser.id && user.role === 'admin' && user.revokedAt === null,
        ) === true,
    );

    const revoked = await again.revokeUser(editorUser.id);
    expect(revoked).toEqual({ ok: true });
    await waitFor(
      again,
      (state) =>
        state.access?.users.some(
          (user) => user.id === editorUser.id && typeof user.revokedAt === 'string' && user.revokedAt.length > 0,
        ) === true,
    );
  }, 20_000);

  it("an editor's invite is refused with forbidden", async () => {
    const started = await boot(0, ADMIN);
    const admin = connect(started.server);
    await waitFor(admin, (state) => state.status === 'live');
    const invited = await admin.invite(EDITOR.login);
    expect(invited).toEqual({ ok: true });
    await waitFor(
      admin,
      (state) => state.access?.invitations.some((invitation) => invitation.login === EDITOR.login) === true,
    );
    admin.stop();
    await started.server.close();

    const asEditor = await boot(0, EDITOR, started.dataDir);
    const editor = connect(asEditor.server);
    await waitFor(editor, (state) => state.status === 'live', 12_000);
    const refused = await editor.invite('outsider@example.test');
    expect(refused).toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can invite',
    });
    expect(editor.getState().status).toBe('live');
    expect(editor.getState().notice).toBeNull();
  }, 20_000);

  it('setShowNeedsApproval by admin updates settings; by editor is refused', async () => {
    const started = await boot(0, ADMIN);
    const admin = connect(started.server);
    await waitFor(admin, (state) => state.status === 'live');
    const updated = await admin.setShowNeedsApproval(true);
    expect(updated).toEqual({ ok: true });
    expect(admin.getState().settings).toEqual({ showNeedsApproval: true });

    const invited = await admin.invite(EDITOR.login);
    expect(invited).toEqual({ ok: true });
    await waitFor(
      admin,
      (state) => state.access?.invitations.some((invitation) => invitation.login === EDITOR.login) === true,
    );
    admin.stop();
    await started.server.close();

    const asEditor = await boot(0, EDITOR, started.dataDir);
    const editor = connect(asEditor.server);
    await waitFor(editor, (state) => state.status === 'live', 12_000);
    const refused = await editor.setShowNeedsApproval(false);
    expect(refused).toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can change show needs approval',
    });
    expect(editor.getState().status).toBe('live');
    expect(editor.getState().notice).toBeNull();
    editor.stop();
    await asEditor.server.close();

    const asAdmin = await boot(0, ADMIN, started.dataDir);
    const again = connect(asAdmin.server);
    await waitFor(again, (state) => state.status === 'live', 12_000);
    await expect(again.loadSettings()).resolves.toEqual({ showNeedsApproval: true });
  }, 20_000);
});
