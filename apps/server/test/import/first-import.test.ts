import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { WebSocket, type RawData } from 'ws';
import { boardId, createBoard, createWard, sequentialIds } from '@wardboard/core';
import { extractPdf } from '@wardboard/importer';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import { emptyCurrentBoard } from '../../src/import/index.ts';
import {
  fixtureIdentityProvider,
  openStore,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';
import { buildCurrent, importClock, person } from './helpers.ts';

const BASE_ORIGIN = 'http://wardboard.example';
const ADMIN_LOGIN = 'admin@example.test';
const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Example' };
const ADMIN: Identity = { login: ADMIN_LOGIN, displayName: 'Admin Example' };

// Discarded fields (SPEC §15) that appear in the fictional fixture reports: a phone
// number, an email address and a birth date (see the T-055 extraction tests).
const DISCARDED = ['555-0307', 'sage.fairwell63@example.com', '13 Apr 2012'] as const;

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/lcr-reports');
const organizationsPdf = readFileSync(path.join(fixturesDir, 'organizations-and-callings.pdf'));
const withoutPdf = readFileSync(path.join(fixturesDir, 'members-without-callings.pdf'));
const outPdf = readFileSync(path.join(fixturesDir, 'out-of-unit-callings.pdf'));

const servers: RunningServer[] = [];
const databases: DatabaseSync[] = [];
const directories: string[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const db of databases.splice(0)) db.close();
  for (const server of servers.splice(0)) await server.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type HttpResult = { status: number; headers: IncomingHttpHeaders; body: Buffer };
type Started = { server: RunningServer; dataDir: string; access: Access; db: DatabaseSync };

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected socket chunk');
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-first-import-'));
  directories.push(root);
  return root;
}

function userByLogin(access: Access, login: string): User {
  const user = access.listUsers().find((candidate) => candidate.login === login);
  if (user === undefined) throw new Error(`missing user ${login}`);
  return user;
}

async function seedCurrent(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const db = openDatabase(databasePath(dataDir));
  try {
    migrate(db);
    const store = openStore(db, importClock);
    const built = buildCurrent({
      version: 4,
      members: [person('mem-zz', 'Zzalpha, Qqqonly')],
      groups: [
        {
          id: 'bg-bishopric',
          name: 'Bishopric',
          key: 'bishopric',
          callingGroups: [
            {
              id: 'cg-bishopric',
              name: 'Bishopric',
              assignments: [
                {
                  id: 'as-bishop',
                  title: 'Bishop',
                  positions: [{ id: 'pos-bishop', lineageId: 'lin-bishop' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const initialized = store.initialize({ ward: built.ward, current: built.current, importVersion: 'fixture' });
    if (!initialized.ok) throw new Error(initialized.error.message);
  } finally {
    db.close();
  }
}

/** Starts a real server on an ephemeral port over a migrated data directory with no Current unless `seed` is set. */
async function startWith(
  identity: Identity | null,
  options?: { log?: (line: string) => void; seed?: boolean },
): Promise<Started> {
  const root = await makeRoot();
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  if (options?.seed === true) await seedCurrent(dataDir);
  else {
    const setup = openDatabase(databasePath(dataDir));
    try {
      migrate(setup);
    } finally {
      setup.close();
    }
  }
  const config: Config = {
    dataDir,
    baseUrl: BASE_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    initialAdminLogin: ADMIN_LOGIN,
  };
  const server = await startServer(config, {
    identityProvider: fixtureIdentityProvider(identity),
    clock: importClock,
    ids: sequentialIds('first'),
    ...(options?.log === undefined ? {} : { log: options.log }),
  });
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  const access = createAccess(db, importClock, () => 'first-access-id');
  return { server, dataDir, access, db };
}

function call(
  port: number,
  method: string,
  requestPath: string,
  headers?: Record<string, string>,
  body?: Uint8Array,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: unknown) => {
        chunks.push(bufferChunk(chunk));
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body === undefined) req.end();
    else req.end(body);
  });
}

function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

class Inbox {
  private readonly queue: unknown[] = [];
  private readonly waiters: ((message: unknown) => void)[] = [];

  constructor(ws: WebSocket) {
    ws.on('error', () => undefined);
    ws.on('message', (data) => {
      const message: unknown = JSON.parse(textOf(data)) as unknown;
      const waiter = this.waiters.shift();
      if (waiter !== undefined) waiter(message);
      else this.queue.push(message);
    });
  }

  next(): Promise<unknown> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected an object');
  }
  return value as Record<string, unknown>;
}

function openSocket(port: number): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/api/ws`, { origin: BASE_ORIGIN });
  sockets.push(ws);
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

function pdfFields(): { organizations: string; withoutCallings: string; outOfUnit: string } {
  return {
    organizations: organizationsPdf.toString('base64'),
    withoutCallings: withoutPdf.toString('base64'),
    outOfUnit: outPdf.toString('base64'),
  };
}

function previewBody(): Buffer {
  return Buffer.from(JSON.stringify(pdfFields()));
}

function replaceBody(expectedVersion: number, resolutions: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ ...pdfFields(), expectedVersion, resolutions }));
}

function jsonHeaders(body: Buffer, origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(body.byteLength),
  };
  if (origin !== undefined) headers.origin = origin;
  return headers;
}

async function filesOf(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(full);
    }
  }
  await walk(root);
  return found.sort();
}

function resolutionsFrom(body: unknown): Record<string, { action: 'new'; category: 'adult' }> {
  const decisions = asRecord(body).decisions;
  if (!Array.isArray(decisions)) throw new Error('preview decisions are missing');
  const resolutions: Record<string, { action: 'new'; category: 'adult' }> = {};
  for (const decision of decisions) {
    const item = asRecord(decision);
    if (typeof item.key !== 'string' || typeof item.kind !== 'string') throw new Error('bad decision');
    if (item.kind === 'ambiguous' || (item.kind === 'new' && item.category === null)) {
      resolutions[item.key] = { action: 'new', category: 'adult' };
    }
  }
  return resolutions;
}

async function preview(started: Started): Promise<HttpResult> {
  const body = previewBody();
  return call(started.server.port, 'POST', '/api/import/preview', jsonHeaders(body, BASE_ORIGIN), body);
}

async function replace(started: Started, expectedVersion: number, resolutions: Record<string, unknown>): Promise<HttpResult> {
  const body = replaceBody(expectedVersion, resolutions);
  return call(started.server.port, 'POST', '/api/import/replace', jsonHeaders(body, BASE_ORIGIN), body);
}

async function firstImport(started: Started): Promise<HttpResult> {
  const previewed = await preview(started);
  expect(previewed.status).toBe(200);
  const resolutions = resolutionsFrom(JSON.parse(previewed.body.toString('utf8')) as unknown);
  return replace(started, 0, resolutions);
}

describe('first import', () => {
  it('emptyCurrentBoard is a valid empty Current', () => {
    const empty = createWard({ members: {}, tags: {} });
    if (!empty.ok) throw new Error('empty ward is invalid');
    const board = emptyCurrentBoard(boardId('board-first'));
    const created = createBoard(board, empty.value);
    expect(created.ok).toBe(true);
    expect(board.id).toBe('board-first');
    expect(board.kind).toBe('current');
    expect(board.version).toBe(0);
    expect(board.boardGroups).toEqual({});
    expect(board.callingGroups).toEqual({});
    expect(board.assignments).toEqual({});
    expect(board.positions).toEqual({});
    expect(board.placements).toEqual({});
    expect(board.oversight).toEqual([]);
    expect(board.approvals).toEqual([]);
    expect(board.dugoutInclusions).toEqual([]);
  });

  it('preview without a Current returns a plan', async () => {
    const started = await startWith(ADMIN);
    const store = openStore(started.db, importClock);
    expect(store.loadCurrent()).toBeNull();
    const response = await preview(started);
    expect(response.status).toBe(200);
    const parsed = asRecord(JSON.parse(response.body.toString('utf8')) as unknown);
    const decisions = parsed.decisions;
    if (!Array.isArray(decisions)) throw new Error('decisions missing');
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) expect(asRecord(decision).kind).toBe('new');
    expect(decisions.some((decision) => asRecord(decision).name === 'Stanley, Zed')).toBe(true);
    expect(parsed.keptPositions).toBe(0);
    expect(parsed.matchedPositions).toBe(0);
    expect(parsed.absent).toEqual([]);
    expect(store.loadCurrent()).toBeNull();
    expect(store.loadWard().members).toEqual({});
  });

  it('first replace creates Current and broadcasts it', async () => {
    const started = await startWith(ADMIN);
    const previewed = await preview(started);
    expect(previewed.status).toBe(200);
    const resolutions = resolutionsFrom(JSON.parse(previewed.body.toString('utf8')) as unknown);

    const { inbox } = await openSocket(started.server.port);
    const response = await replace(started, 0, resolutions);
    expect(response.status).toBe(200);
    const saved = asRecord(JSON.parse(response.body.toString('utf8')) as unknown);
    expect(saved.replaced).toBe(true);
    expect(saved.importVersion).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}\.[0-9a-f]{64}$/);
    expect(saved.importedAt).toEqual(expect.any(String));
    expect(saved.created).toEqual(expect.any(Number));
    expect(saved.matched).toBe(0);
    expect(saved.removed).toBe(0);

    const store = openStore(started.db, importClock);
    const current = store.loadCurrent();
    if (current === null) throw new Error('first import did not create Current');
    expect(current.board.kind).toBe('current');
    expect(current.board.version).toBe(1);
    expect(current.importVersion).toBe(saved.importVersion);
    expect(current.importedAt).toBe(saved.importedAt);
    expect(Object.keys(current.board.boardGroups).length).toBeGreaterThan(0);
    expect(Object.keys(current.board.callingGroups).length).toBeGreaterThan(0);
    expect(Object.keys(current.board.assignments).length).toBeGreaterThan(0);
    expect(Object.keys(current.board.placements).length).toBeGreaterThan(0);
    const ward = store.loadWard();
    const members = Object.values(ward.members);
    expect(members).toHaveLength(saved.created as number);
    const una = members.find((member) => member.name === 'Wrenford, Una');
    if (una === undefined) throw new Error('missing Wrenford, Una');
    expect(Object.values(current.board.placements)).toContain(una.id);
    expect(members.some((member) => member.name === 'Westdale, Gus')).toBe(true);

    let boards: Record<string, unknown> | null = null;
    while (boards === null) {
      const message = asRecord(await inbox.next());
      if (message.type === 'boards') boards = message;
    }
    const announced = asRecord(boards.current);
    expect(announced.boardId).toBe(current.board.id);
    expect(announced.version).toBe(1);
    expect(announced.importVersion).toBe(saved.importVersion);
  });

  it('first replace needs expectedVersion 0', async () => {
    const lines: string[] = [];
    const started = await startWith(ADMIN, { log: (line) => lines.push(line) });
    const previewed = await preview(started);
    const resolutions = resolutionsFrom(JSON.parse(previewed.body.toString('utf8')) as unknown);
    const response = await replace(started, 3, resolutions);
    expect(response.status).toBe(409);
    expect(JSON.parse(response.body.toString('utf8'))).toEqual({ error: 'stale', currentVersion: 0 });
    const store = openStore(started.db, importClock);
    expect(store.loadCurrent()).toBeNull();
    expect(store.loadWard().members).toEqual({});
    expect(lines.filter((line) => line.startsWith('import replace'))).toEqual([]);
  });

  it('a second first import is stale', async () => {
    const started = await startWith(ADMIN);
    const first = await firstImport(started);
    expect(first.status).toBe(200);
    const store = openStore(started.db, importClock);
    const before = store.loadCurrent();
    if (before === null) throw new Error('first import did not create Current');
    const beforeWard = store.loadWard();

    const second = await firstImport(started);
    expect(second.status).toBe(409);
    expect(JSON.parse(second.body.toString('utf8'))).toEqual({
      error: 'stale',
      currentVersion: before.board.version,
    });
    expect(store.loadCurrent()).toEqual(before);
    expect(store.loadWard()).toEqual(beforeWard);
  });

  it('first import keeps only allow-listed fields', async () => {
    const reportText = [organizationsPdf, withoutPdf, outPdf]
      .flatMap((pdf) => extractPdf(new Uint8Array(pdf)).pages)
      .flatMap((page) => page.rows)
      .flatMap((row) => row.items.map((item) => item.text))
      .join('\n');
    for (const value of DISCARDED) expect(reportText.includes(value)).toBe(true);

    const lines: string[] = [];
    const started = await startWith(ADMIN, { log: (line) => lines.push(line) });
    const response = await firstImport(started);
    expect(response.status).toBe(200);
    expect(openStore(started.db, importClock).loadCurrent()).not.toBeNull();

    const files = await filesOf(started.dataDir);
    expect(files.some((file) => file.endsWith('.db') || file.endsWith('.sqlite'))).toBe(true);
    const stored = (await Promise.all(files.map((file) => readFile(file)))).map((bytes) => bytes.toString('latin1'));
    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join('\n');
    for (const value of DISCARDED) {
      for (const content of stored) expect(content.includes(value)).toBe(false);
      expect(logged.includes(value)).toBe(false);
    }
    expect(logged.includes('Stanley, Zed')).toBe(false);
  });

  it('Editors are refused without a Current', async () => {
    const started = await startWith(EDITOR);
    const admin = userByLogin(started.access, ADMIN_LOGIN);
    expect(started.access.invite(admin.id, EDITOR.login).ok).toBe(true);
    const previewed = await preview(started);
    expect(previewed.status).toBe(403);
    expect(previewed.body.toString('utf8')).toBe('{"error":"forbidden"}');
    const replaced = await replace(started, 0, {});
    expect(replaced.status).toBe(403);
    expect(replaced.body.toString('utf8')).toBe('{"error":"forbidden"}');
    const store = openStore(started.db, importClock);
    expect(store.loadCurrent()).toBeNull();
    expect(store.loadWard().members).toEqual({});
  });

  it('with a Current, replace behaves as before', async () => {
    const started = await startWith(ADMIN, { seed: true });
    const store = openStore(started.db, importClock);
    const before = store.loadCurrent();
    if (before === null) throw new Error('seed missing');
    expect(before.board.version).toBe(4);
    const response = await firstImport(started);
    expect(response.status).toBe(409);
    expect(JSON.parse(response.body.toString('utf8'))).toEqual({ error: 'stale', currentVersion: 4 });
    expect(store.loadCurrent()).toEqual(before);
  });
});
