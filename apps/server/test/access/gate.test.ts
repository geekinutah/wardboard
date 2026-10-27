import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  fixtureIdentityProvider,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'wardboard-access-gate-'));
  tempDirs.push(dir);
  return dir;
}

async function start(options: {
  dataDir: string;
  identity: Identity | null;
  initialAdminLogin?: string;
  clock?: () => Date;
  ids?: () => string;
}): Promise<RunningServer> {
  const webDir = path.join(options.dataDir, 'web');
  await mkdir(webDir, { recursive: true });
  await writeFile(path.join(webDir, 'index.html'), '<p>WardBoard access</p>');

  const config: Config = {
    dataDir: options.dataDir,
    baseUrl: 'http://wardboard.example',
    port: 0,
    host: '127.0.0.1',
    webDir,
    ...(options.initialAdminLogin !== undefined
      ? { initialAdminLogin: options.initialAdminLogin }
      : {}),
  };
  const server = await startServer(config, {
    identityProvider: fixtureIdentityProvider(options.identity),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.ids !== undefined ? { ids: options.ids } : {}),
  });
  servers.push(server);
  return server;
}

function openService(dataDir: string): { access: Access; close(): void } {
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  return {
    access: createAccess(
      db,
      () => new Date('2026-05-06T07:08:09.000Z'),
      () => 'gate-id',
    ),
    close(): void {
      const index = databases.indexOf(db);
      if (index >= 0) {
        databases.splice(index, 1);
      }
      db.close();
    },
  };
}

function definedUser(users: readonly User[], login: string): User {
  const user = users.find((candidate) => candidate.login === login);
  expect(user, login).toBeDefined();
  if (user === undefined) {
    throw new Error(`missing user ${login}`);
  }
  return user;
}

function sendRaw(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(payload);
    });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    socket.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.on('error', reject);
  });
}

function upgradeRequest(): string {
  return [
    'GET /ws HTTP/1.1',
    'Host: 127.0.0.1',
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n');
}

async function expectForbidden(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('{"error":"forbidden"}');
}

describe('access gate', () => {
  it('identity without access gets 403 on every non-health path', async () => {
    const dataDir = path.join(await makeTempDir(), 'data');
    const login = 'stranger-secret@example.test';
    const server = await start({
      dataDir,
      identity: { login, displayName: 'Stranger Secret' },
    });

    await expectForbidden(await fetch(`${server.url}/`));
    await expectForbidden(await fetch(`${server.url}/api/nope`));
    await expectForbidden(await fetch(`${server.url}/x`, { method: 'POST', body: 'nope' }));

    const raw = await sendRaw(
      server.port,
      'GET /secret HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
    );
    expect(raw).toContain('{"error":"forbidden"}');
    expect(raw).not.toContain(login);
    expect(raw).not.toContain('Stranger Secret');
  });

  it('health needs neither identity nor access', async () => {
    const bare = await start({
      dataDir: path.join(await makeTempDir(), 'data'),
      identity: null,
    });
    const bareHealth = await fetch(`${bare.url}/api/health`);
    expect(bareHealth.status).toBe(200);
    expect(await bareHealth.text()).toBe('{"status":"ok"}');

    const stranger = await start({
      dataDir: path.join(await makeTempDir(), 'data'),
      identity: { login: 'stranger@example.test', displayName: 'Stranger' },
    });
    const strangerHealth = await fetch(`${stranger.url}/api/health`);
    expect(strangerHealth.status).toBe(200);
    expect(await strangerHealth.text()).toBe('{"status":"ok"}');
  });

  it('initial admin gets through', async () => {
    const dataDir = path.join(await makeTempDir(), 'data');
    const login = 'admin@example.test';
    let nextId = 0;
    const server = await start({
      dataDir,
      identity: { login, displayName: 'Initial Admin' },
      initialAdminLogin: login,
      clock: () => new Date('2026-03-04T05:06:07.000Z'),
      ids: () => {
        nextId += 1;
        return `srv-${String(nextId)}`;
      },
    });

    expect(existsSync(databasePath(dataDir))).toBe(true);
    const access = openService(dataDir).access;
    expect(access.listUsers()).toEqual([
      {
        id: 'srv-1',
        login,
        displayName: login,
        role: 'admin',
        createdAt: '2026-03-04T05:06:07.000Z',
        revokedAt: null,
      },
    ]);

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('WardBoard access');
    expect(access.listUsers()[0]).toMatchObject({ displayName: 'Initial Admin', role: 'admin' });
  });

  it('invited login gets through and becomes an editor', async () => {
    const dataDir = path.join(await makeTempDir(), 'data');
    const guest: Identity = { login: 'guest@example.test', displayName: 'Guest Person' };
    const server = await start({
      dataDir,
      identity: guest,
      initialAdminLogin: 'admin@example.test',
    });
    const access = openService(dataDir).access;
    const admin = definedUser(access.listUsers(), 'admin@example.test');
    expect(access.invite(admin.id, guest.login).ok).toBe(true);

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('WardBoard access');

    expect(access.listUsers().find((user) => user.login === guest.login)).toMatchObject({
      login: guest.login,
      displayName: 'Guest Person',
      role: 'editor',
      revokedAt: null,
    });
    expect(access.listInvitations()).toEqual([]);
  });

  it('revoked user is refused on the next request', async () => {
    const dataDir = path.join(await makeTempDir(), 'data');
    const guest: Identity = { login: 'guest@example.test', displayName: 'Guest' };
    const server = await start({
      dataDir,
      identity: guest,
      initialAdminLogin: 'admin@example.test',
    });
    const access = openService(dataDir).access;
    const admin = definedUser(access.listUsers(), 'admin@example.test');
    expect(access.invite(admin.id, guest.login).ok).toBe(true);

    expect((await fetch(`${server.url}/`)).status).toBe(200);
    const editor = definedUser(access.listUsers(), guest.login);
    expect(access.revokeUser(admin.id, editor.id)).toEqual({ ok: true, value: undefined });

    await expectForbidden(await fetch(`${server.url}/`));
  });

  it('upgrade without access gets 403; with access gets 404', async () => {
    const strangerLogin = 'upgrade-stranger@example.test';
    const denied = await start({
      dataDir: path.join(await makeTempDir(), 'data'),
      identity: { login: strangerLogin, displayName: 'Upgrade Stranger' },
    });
    const deniedResponse = await sendRaw(denied.port, upgradeRequest());
    expect(deniedResponse.startsWith('HTTP/1.1 403 Forbidden\r\n')).toBe(true);
    expect(deniedResponse).toContain('{"error":"forbidden"}');
    expect(deniedResponse).not.toContain(strangerLogin);

    const allowedLogin = 'upgrade-admin@example.test';
    const allowed = await start({
      dataDir: path.join(await makeTempDir(), 'data'),
      identity: { login: allowedLogin, displayName: 'Upgrade Admin' },
      initialAdminLogin: allowedLogin,
    });
    const allowedResponse = await sendRaw(allowed.port, upgradeRequest());
    expect(allowedResponse.startsWith('HTTP/1.1 404 ')).toBe(true);
    expect(allowedResponse).toContain('{"error":"not_found"}');
    expect(allowedResponse).not.toContain('{"error":"forbidden"}');
  });

  it('unauthenticated still gets 401, not 403', async () => {
    const server = await start({
      dataDir: path.join(await makeTempDir(), 'data'),
      identity: null,
    });

    const response = await fetch(`${server.url}/`);
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(403);
    expect(await response.text()).toBe('{"error":"unauthenticated"}');

    const upgrade = await sendRaw(server.port, upgradeRequest());
    expect(upgrade.startsWith('HTTP/1.1 401 ')).toBe(true);
    expect(upgrade).toContain('{"error":"unauthenticated"}');
    expect(upgrade).not.toContain('{"error":"forbidden"}');
  });

  it('database persists across restart', async () => {
    const dataDir = path.join(await makeTempDir(), 'data');
    const guest: Identity = { login: 'guest@example.test', displayName: 'Persistent Guest' };
    const first = await start({
      dataDir,
      identity: guest,
      initialAdminLogin: 'admin@example.test',
    });
    const service = openService(dataDir);
    const admin = definedUser(service.access.listUsers(), 'admin@example.test');
    expect(service.access.invite(admin.id, guest.login).ok).toBe(true);
    expect((await fetch(`${first.url}/`)).status).toBe(200);
    service.close();
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    const second = await start({ dataDir, identity: guest });
    expect((await fetch(`${second.url}/`)).status).toBe(200);
    expect(
      openService(dataDir)
        .access.listUsers()
        .find((user) => user.login === guest.login),
    ).toMatchObject({ role: 'editor', displayName: 'Persistent Guest', revokedAt: null });
  });
});
