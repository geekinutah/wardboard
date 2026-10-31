import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket, type RawData } from 'ws';
import { sequentialIds } from '@wardboard/core';
import { buildFixtureWard } from '@wardboard/core/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import {
  MAX_BACKUP_BYTES,
  createBackup,
  fixtureIdentityProvider,
  openStore,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';

const CLOCK_ISO = '2026-07-01T15:04:05.000Z';
const BASE_ORIGIN = 'http://wardboard.example';
const ADMIN_LOGIN = 'admin@example.test';
const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Example' };
const ADMIN: Identity = { login: ADMIN_LOGIN, displayName: 'Admin Example' };

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const directories: string[] = [];

function clock(): Date {
  return new Date(CLOCK_ISO);
}

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: Buffer };

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected socket chunk');
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-backup-http-'));
  directories.push(root);
  return root;
}

function userByLogin(access: Access, login: string): User {
  const user = access.listUsers().find((candidate) => candidate.login === login);
  if (user === undefined) throw new Error(`missing user ${login}`);
  return user;
}

async function startWith(
  identity: Identity | null,
  options?: { initialAdminLogin?: string; maxBackupBytes?: number; seed?: (dataDir: string) => Promise<void> },
): Promise<{ server: RunningServer; dataDir: string; access: Access; db: DatabaseSync }> {
  const root = await makeRoot();
  const dataDir = path.join(root, 'data');
  if (options?.seed !== undefined) await options.seed(dataDir);
  const config: Config = {
    dataDir,
    baseUrl: BASE_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    ...(options?.initialAdminLogin !== undefined ? { initialAdminLogin: options.initialAdminLogin } : {}),
  };
  const server = await startServer(config, {
    identityProvider: fixtureIdentityProvider(identity),
    clock,
    ...(options?.maxBackupBytes !== undefined ? { maxBackupBytes: options.maxBackupBytes } : {}),
  });
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  const access = createAccess(db, clock, () => 'backup-access-id');
  return { server, dataDir, access, db };
}

async function startAdmin(): Promise<{ server: RunningServer; dataDir: string; access: Access; db: DatabaseSync }> {
  return startWith(ADMIN, { initialAdminLogin: ADMIN_LOGIN });
}

async function startEditor(): Promise<{ server: RunningServer; dataDir: string; access: Access; db: DatabaseSync }> {
  const started = await startWith(EDITOR, { initialAdminLogin: ADMIN_LOGIN });
  const admin = userByLogin(started.access, ADMIN_LOGIN);
  expect(started.access.invite(admin.id, EDITOR.login).ok).toBe(true);
  return started;
}

function call(
  port: number,
  method: string,
  requestPath: string,
  headers?: Record<string, string>,
  body?: Uint8Array,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: requestPath, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: unknown) => {
          chunks.push(bufferChunk(chunk));
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body === undefined) req.end();
    else req.end(body);
  });
}

function markerCount(db: DatabaseSync): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'marker'`).get();
  const value = row?.['n'];
  if (typeof value !== 'number') throw new Error('marker count is not a number');
  return value;
}

async function archiveWithMarker(): Promise<Buffer> {
  const root = await makeRoot();
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const db = openDatabase(databasePath(dataDir));
  try {
    migrate(db);
    db.prepare(
      `INSERT INTO users (id, login, display_name, role, created_at)
       VALUES ('admin-1', ?, 'Admin Example', 'admin', ?)`,
    ).run(ADMIN_LOGIN, CLOCK_ISO);
    db.prepare(`INSERT INTO settings (key, value) VALUES ('marker', 'true')`).run();
  } finally {
    db.close();
  }
  return createBackup(dataDir, clock);
}

async function dotFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name.startsWith('.')) found.push(path.relative(root, full));
    }
  }
  await walk(root);
  return found;
}

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

class Inbox {
  private readonly queue: unknown[] = [];
  private readonly waiters: ((message: unknown) => void)[] = [];
  private closeCode: number | undefined;
  private readonly closeWaiters: ((code: number) => void)[] = [];

  constructor(ws: WebSocket) {
    ws.on('error', () => undefined);
    ws.on('message', (data) => {
      const message: unknown = JSON.parse(textOf(data)) as unknown;
      const waiter = this.waiters.shift();
      if (waiter !== undefined) waiter(message);
      else this.queue.push(message);
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      const waiting = this.closeWaiters.splice(0);
      for (const waiter of waiting) waiter(code);
    });
  }

  next(): Promise<unknown> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  closed(): Promise<number> {
    if (this.closeCode !== undefined) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => {
      this.closeWaiters.push(resolve);
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected an object message');
  }
  return value as Record<string, unknown>;
}

function openSocket(port: number, origin: string): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/api/ws`, { origin });
  return new Promise((resolve, reject) => {
    ws.once('open', () => {
      ws.on('error', () => undefined);
      resolve({ ws, inbox: new Inbox(ws) });
    });
    ws.once('error', (error: Error) => {
      reject(error);
    });
  });
}

async function seedProposal(dataDir: string, name: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dataDir, { recursive: true });
  const db = openDatabase(databasePath(dataDir));
  try {
    migrate(db);
    db.prepare(
      `INSERT INTO users (id, login, display_name, role, created_at)
       VALUES ('admin-1', ?, 'Admin Example', 'admin', ?)`,
    ).run(ADMIN_LOGIN, CLOCK_ISO);
    const store = openStore(db, clock);
    const { ward, current } = buildFixtureWard();
    const initialized = store.initialize({ ward, current, importVersion: 'fixture' });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const created = store.createProposal({ name, rationale: null, source: { kind: 'current' } }, sequentialIds('plan'));
    if (!created.ok) throw new Error(created.error.message);
  } finally {
    db.close();
  }
}

describe('backup routes', () => {
  it('unauthenticated → 401 and revoked → 403 on backup and restore', async () => {
    const archive = await archiveWithMarker();
    const anonymous = await startWith(null, { initialAdminLogin: ADMIN_LOGIN });
    const paths = [
      ['GET', '/api/admin/backup'],
      ['POST', '/api/admin/restore?mode=dry-run'],
      ['POST', '/api/admin/restore?mode=apply'],
    ] as const;
    for (const [method, requestPath] of paths) {
      const response = await call(
        anonymous.server.port,
        method,
        requestPath,
        { origin: BASE_ORIGIN },
        method === 'POST' ? archive : undefined,
      );
      expect(response.status).toBe(401);
      expect(response.body.toString('utf8')).toBe('{"error":"unauthenticated"}');
      expect(headerValue(response.headers, 'cache-control')).toBe('no-store');
    }
    expect(markerCount(anonymous.db)).toBe(0);

    const revoked = await startEditor();
    const probe = await call(revoked.server.port, 'GET', '/api/nope');
    expect(probe.status).toBe(404);
    const admin = userByLogin(revoked.access, ADMIN_LOGIN);
    const editor = userByLogin(revoked.access, EDITOR.login);
    expect(revoked.access.revokeUser(admin.id, editor.id).ok).toBe(true);
    for (const [method, requestPath] of paths) {
      const response = await call(
        revoked.server.port,
        method,
        requestPath,
        { origin: BASE_ORIGIN },
        method === 'POST' ? archive : undefined,
      );
      expect(response.status).toBe(403);
      expect(response.body.toString('utf8')).toBe('{"error":"forbidden"}');
      expect(headerValue(response.headers, 'cache-control')).toBe('no-store');
    }
    expect(markerCount(revoked.db)).toBe(0);
  });

  it('Editor → 403 on backup and on restore (dry-run and apply)', async () => {
    const archive = await archiveWithMarker();
    const { server, db } = await startEditor();
    const backup = await call(server.port, 'GET', '/api/admin/backup');
    const dry = await call(server.port, 'POST', '/api/admin/restore?mode=dry-run', { origin: BASE_ORIGIN }, archive);
    const apply = await call(server.port, 'POST', '/api/admin/restore?mode=apply', { origin: BASE_ORIGIN }, archive);

    for (const response of [backup, dry, apply]) {
      expect(response.status).toBe(403);
      expect(response.body.toString('utf8')).toBe('{"error":"forbidden"}');
      expect(headerValue(response.headers, 'cache-control')).toBe('no-store');
    }
    expect(markerCount(db)).toBe(0);
  });

  it('Admin download has tar content type, attachment filename from clock, no-store', async () => {
    const { server } = await startAdmin();
    const response = await call(server.port, 'GET', '/api/admin/backup');

    expect(response.status).toBe(200);
    expect(headerValue(response.headers, 'content-type')).toBe('application/x-tar');
    expect(headerValue(response.headers, 'content-disposition')).toBe(
      'attachment; filename="wardboard-backup-20260701-150405.tar"',
    );
    expect(headerValue(response.headers, 'cache-control')).toBe('no-store');
    expect(response.body.subarray(257, 262).toString('ascii')).toBe('ustar');

    const dry = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=dry-run',
      { origin: server.url },
      response.body,
    );
    expect(dry.status).toBe(200);
    const body = asRecord(JSON.parse(dry.body.toString('utf8')) as unknown);
    expect(body.summary).toMatchObject({ schemaVersion: 3, hasCurrent: false, photos: 0 });
  });

  it('restore with foreign or missing Origin → 403 and nothing changes', async () => {
    const archive = await archiveWithMarker();
    const { server, dataDir, db } = await startAdmin();
    const foreign = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=apply',
      { origin: 'http://evil.example' },
      archive,
    );
    const missing = await call(server.port, 'POST', '/api/admin/restore?mode=dry-run', undefined, archive);

    expect(foreign.status).toBe(403);
    expect(foreign.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(missing.status).toBe(403);
    expect(missing.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(markerCount(db)).toBe(0);
    expect(await dotFiles(dataDir)).toEqual([]);
  });

  it('restore over MAX_BACKUP_BYTES → 413 and no staging file left', async () => {
    expect(MAX_BACKUP_BYTES).toBe(1024 * 1024 * 1024);
    const cap = 64;
    const { server, dataDir } = await startWith(ADMIN, { initialAdminLogin: ADMIN_LOGIN, maxBackupBytes: cap });

    const oversized = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=apply',
      { origin: BASE_ORIGIN, 'content-length': String(cap + 1) },
      Buffer.alloc(cap + 1, 7),
    );
    expect(oversized.status).toBe(413);
    expect(oversized.body.toString('utf8')).toBe('{"error":"too_large"}');
    expect(await dotFiles(dataDir)).toEqual([]);

    const chunked = await new Promise<HttpResult>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: server.port,
          path: '/api/admin/restore?mode=apply',
          method: 'POST',
          headers: { origin: BASE_ORIGIN },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: unknown) => {
            chunks.push(bufferChunk(chunk));
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(Buffer.alloc(40, 1));
      req.write(Buffer.alloc(40, 2));
      req.end();
    });
    expect(chunked.status).toBe(413);
    expect(chunked.body.toString('utf8')).toBe('{"error":"too_large"}');
    expect(await dotFiles(dataDir)).toEqual([]);

    const bounded = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=dry-run',
      { origin: BASE_ORIGIN },
      Buffer.alloc(cap, 3),
    );
    expect(bounded.status).toBe(422);
    expect(await dotFiles(dataDir)).toEqual([]);
  });

  it('invalid archive → 422 with code; missing mode → 400; PUT → 405', async () => {
    const { server, dataDir } = await startAdmin();
    const invalid = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=dry-run',
      { origin: BASE_ORIGIN },
      Buffer.from('not-a-tar'),
    );
    const missing = await call(server.port, 'POST', '/api/admin/restore', { origin: BASE_ORIGIN }, Buffer.from('x'));
    const other = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=later',
      { origin: BASE_ORIGIN },
      Buffer.from('x'),
    );
    const put = await call(server.port, 'PUT', '/api/admin/restore?mode=apply', { origin: BASE_ORIGIN }, Buffer.from('x'));
    const postBackup = await call(server.port, 'POST', '/api/admin/backup');

    expect(invalid.status).toBe(422);
    expect(invalid.body.toString('utf8')).toBe('{"error":"invalid_archive"}');
    expect(missing.status).toBe(400);
    expect(missing.body.toString('utf8')).toBe('{"error":"bad_request"}');
    expect(other.status).toBe(400);
    expect(other.body.toString('utf8')).toBe('{"error":"bad_request"}');
    expect(put.status).toBe(405);
    expect(headerValue(put.headers, 'allow')).toBe('POST');
    expect(postBackup.status).toBe(405);
    expect(headerValue(postBackup.headers, 'allow')).toBe('GET');
    expect(await dotFiles(dataDir)).toEqual([]);
  });

  it('apply closes every open WebSocket with code 4000; a new connection afterwards sees restored data', async () => {
    const { server, db } = await startWith(ADMIN, {
      initialAdminLogin: ADMIN_LOGIN,
      seed: (dataDir) => seedProposal(dataDir, 'Live plan'),
    });
    const archiveRoot = await makeRoot();
    const archiveDir = path.join(archiveRoot, 'data');
    await seedProposal(archiveDir, 'Restored plan');
    const archive = await createBackup(archiveDir, clock);

    const first = await openSocket(server.port, BASE_ORIGIN);
    const second = await openSocket(server.port, server.url);
    const firstClosed = first.inbox.closed();
    const secondClosed = second.inbox.closed();

    const response = await call(
      server.port,
      'POST',
      '/api/admin/restore?mode=apply',
      { origin: BASE_ORIGIN },
      archive,
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.toString('utf8'))).toMatchObject({ restored: true, summary: { hasCurrent: true } });
    expect(await firstClosed).toBe(4000);
    expect(await secondClosed).toBe(4000);

    const next = await openSocket(server.port, BASE_ORIGIN);
    const pending = next.inbox.next();
    next.ws.send(JSON.stringify({ type: 'listBoards' }));
    const message = asRecord(await pending);
    expect(message.type).toBe('boards');
    if (!Array.isArray(message.proposals)) throw new Error('proposals missing');
    const names = message.proposals.map((item) => {
      const record = asRecord(item);
      if (typeof record.name !== 'string') throw new Error('proposal name missing');
      return record.name;
    });
    expect(names).toContain('Restored plan');
    expect(names).not.toContain('Live plan');
    const current = db.prepare(`SELECT name FROM boards WHERE proposal_id IS NOT NULL`).all().map((row) => row['name']);
    expect(current).toContain('Restored plan');
    next.ws.close();
  });
});
