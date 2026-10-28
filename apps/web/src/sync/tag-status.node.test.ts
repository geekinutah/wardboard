// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TagId } from '@wardboard/core';
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

const ADMIN = { login: 'tagstatus-admin@example.test', displayName: 'Tag Admin' };
const EDITOR = { login: 'tagstatus-editor@example.test', displayName: 'Tag Editor' };

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
  const dataDir = existingDir ?? (await mkdtemp(path.join(tmpdir(), 'wardboard-t087-')));
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

describe('tag and proposal-status methods against a real server', () => {
  it('createTag then deleteTag: the ward push loses the tag; getTagUsage before delete reports the seeded member count', async () => {
    expect(typeof document).toBe('undefined');
    const { server } = await boot(0, ADMIN);
    const client = connect(server);
    const snapped = await openCurrent(client);
    const ward = snapped.ward;
    if (ward === null) throw new Error('missing ward');
    const seeded = Object.values(ward.tags).find((tag) => tag.name === 'Teaches well');
    if (seeded === undefined) throw new Error('missing seeded tag');
    const seededCount = Object.values(ward.members).filter((member) => member.tagIds.includes(seeded.id)).length;
    expect(seededCount).toBeGreaterThan(0);
    const seededUsage = await client.getTagUsage(seeded.id);
    expect(seededUsage).toMatchObject({ ok: true, members: seededCount });

    const created = await client.createTag('Choir director');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    const tagKey = created.tagId as TagId;
    await waitFor(client, (state) => state.ward?.tags[tagKey]?.name === 'Choir director');

    const renamed = await client.renameTag(created.tagId, 'Choir leader');
    expect(renamed).toEqual({ ok: true });
    await waitFor(client, (state) => state.ward?.tags[tagKey]?.name === 'Choir leader');

    const member = Object.values(ward.members)[0];
    if (member === undefined) throw new Error('ward has no members');
    expect(await client.updateMember(member.id, { tagIds: [...member.tagIds, created.tagId] })).toEqual({ ok: true });
    expect(await client.getTagUsage(created.tagId)).toEqual({
      ok: true,
      members: 1,
      callingPreferences: 0,
      callingTags: 0,
    });

    expect(await client.deleteTag(created.tagId)).toEqual({ ok: true });
    const after = await waitFor(
      client,
      (state) => state.ward !== null && state.ward.tags[tagKey] === undefined,
    );
    expect(after.ward?.members[member.id]?.tagIds).not.toContain(created.tagId);

    const gone = await client.getTagUsage(created.tagId);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.code).toBe('not_found');
  }, 20_000);

  it('setNeedsApproval by an editor is refused forbidden; by an admin it succeeds', async () => {
    const started = await boot(0, ADMIN);
    const admin = connect(started.server);
    const snapped = await openCurrent(admin);
    const member = Object.values(snapped.ward?.members ?? {})[0];
    if (member === undefined) throw new Error('ward has no members');
    const flipped = !member.needsApproval;
    expect(await admin.setNeedsApproval(member.id, flipped)).toEqual({ ok: true });
    await waitFor(admin, (state) => state.ward?.members[member.id]?.needsApproval === flipped);
    expect(await admin.invite(EDITOR.login)).toEqual({ ok: true });
    await waitFor(
      admin,
      (state) => state.access?.invitations.some((invitation) => invitation.login === EDITOR.login) === true,
    );
    admin.stop();
    await started.server.close();

    const asEditor = await boot(0, EDITOR, started.dataDir);
    const editor = connect(asEditor.server);
    await waitFor(editor, (state) => state.status === 'live', 12_000);
    const refused = await editor.setNeedsApproval(member.id, member.needsApproval);
    expect(refused).toEqual({
      ok: false,
      code: 'forbidden',
      message: 'only an admin can set needs approval',
    });
    expect(editor.getState().status).toBe('live');
  }, 25_000);

  it('setProposalStatus accepted then getProposal returns a frozen summary and boards shows acceptedAt; draft clears it', async () => {
    const { server } = await boot(0, ADMIN);
    const client = connect(server);
    const listed = await waitFor(
      client,
      (state) => state.status === 'live' && (state.boards?.proposals.length ?? 0) > 0,
    );
    const summary = listed.boards?.proposals[0];
    if (summary === undefined) throw new Error('missing proposal');
    expect(summary.acceptedAt).toBeNull();

    expect(await client.setProposalStatus(summary.id, 'accepted')).toEqual({ ok: true, status: 'accepted' });
    const accepted = await waitFor(client, (state) =>
      state.boards?.proposals.some((item) => item.id === summary.id && typeof item.acceptedAt === 'string') === true,
    );
    const at = accepted.boards?.proposals.find((item) => item.id === summary.id)?.acceptedAt;

    const detail = await client.getProposal(summary.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) throw new Error(detail.message);
    expect(detail.proposal.status).toBe('accepted');
    expect(detail.proposal.accepted?.at).toBe(at);
    expect(detail.proposal.accepted?.byLogin).toBe(ADMIN.login);
    expect(Array.isArray(detail.proposal.accepted?.summary)).toBe(true);

    const again = await client.setProposalStatus(summary.id, 'accepted');
    expect(again).toMatchObject({ ok: false, code: 'no_change' });

    expect(await client.setProposalStatus(summary.id, 'draft')).toEqual({ ok: true, status: 'draft' });
    await waitFor(client, (state) =>
      state.boards?.proposals.some((item) => item.id === summary.id && item.acceptedAt === null) === true,
    );
    const reopened = await client.getProposal(summary.id);
    expect(reopened).toMatchObject({ ok: true, proposal: { status: 'draft', accepted: null } });
  }, 20_000);
});
