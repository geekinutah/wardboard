import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { WebSocket, type RawData } from 'ws';
import { sequentialIds } from '@wardboard/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccess, type Access, type User } from '../../src/access/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import { applyImport, planImport } from '../../src/import/index.ts';
import {
  fixtureIdentityProvider,
  openStore,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
} from '../../src/index.ts';
import { buildCurrent, bundle, importClock, person, row } from './helpers.ts';

const BASE_ORIGIN = 'http://wardboard.example';
const ADMIN_LOGIN = 'admin@example.test';
const EDITOR: Identity = { login: 'editor@example.test', displayName: 'Editor Example' };
const ADMIN: Identity = { login: ADMIN_LOGIN, displayName: 'Admin Example' };
const CANARIES = [
  '555-0100',
  'canary.email@example.invalid',
  'CANARY-MRN-998877665',
  'CANARY-DOB-1974-01-31',
  'CANARY-ADDR-1-SECRET-LANE',
  'CANARY-PHONE-555-0199',
] as const;
const FIXTURE_NAMES = ['Stanley, Zed', 'Wrenford, Una', 'Westdale, Gus', 'Qqqonly'] as const;

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/lcr-reports');
const organizationsPdf = readFileSync(path.join(fixturesDir, 'organizations-and-callings.pdf'));
const withoutPdf = readFileSync(path.join(fixturesDir, 'members-without-callings.pdf'));
const outPdf = readFileSync(path.join(fixturesDir, 'out-of-unit-callings.pdf'));
const memberListPdf = readFileSync(path.join(fixturesDir, 'member-list.pdf'));

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

function bufferChunk(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError('unexpected socket chunk');
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-import-http-'));
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
      members: [person('mem-zz', 'Zzalpha, Qqqonly', { note: 'seed-note' })],
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

async function startWith(
  identity: Identity | null,
  options?: { log?: (line: string) => void; seed?: boolean },
): Promise<{ server: RunningServer; dataDir: string; access: Access; db: DatabaseSync }> {
  const root = await makeRoot();
  const dataDir = path.join(root, 'data');
  if (options?.seed !== false) await seedCurrent(dataDir);
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
    ids: sequentialIds('import'),
    ...(options?.log === undefined ? {} : { log: options.log }),
  });
  servers.push(server);
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  const access = createAccess(db, importClock, () => 'import-access-id');
  return { server, dataDir, access, db };
}

async function startAdmin(log?: (line: string) => void): Promise<{
  server: RunningServer;
  dataDir: string;
  access: Access;
  db: DatabaseSync;
}> {
  return startWith(ADMIN, log === undefined ? undefined : { log });
}

async function startEditor(): Promise<{ server: RunningServer; dataDir: string; access: Access; db: DatabaseSync }> {
  const started = await startWith(EDITOR);
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

function pdfFields(): { organizations: string; withoutCallings: string; outOfUnit: string; memberList: string } {
  return {
    organizations: organizationsPdf.toString('base64'),
    withoutCallings: withoutPdf.toString('base64'),
    outOfUnit: outPdf.toString('base64'),
    memberList: memberListPdf.toString('base64'),
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
      else found.push(path.relative(root, full));
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

function countDecisions(body: unknown): { matched: number; created: number; ambiguous: number } {
  const decisions = asRecord(body).decisions;
  if (!Array.isArray(decisions)) throw new Error('preview decisions are missing');
  let matched = 0;
  let created = 0;
  let ambiguous = 0;
  for (const decision of decisions) {
    const kind = asRecord(decision).kind;
    if (kind === 'matched') matched += 1;
    else if (kind === 'new') created += 1;
    else ambiguous += 1;
  }
  return { matched, created, ambiguous };
}

describe('import routes', () => {
  it('uses the import planners', () => {
    expect(typeof planImport).toBe('function');
    expect(typeof applyImport).toBe('function');
    const planned = planImport({
      bundle: bundle({
        organizations: [row('Bishopric', 'Bishopric', [{ title: 'Bishop', occupant: null }])],
      }),
      ward: buildCurrent({ members: [], groups: [] }).ward,
      current: buildCurrent({ members: [], groups: [] }).current,
    });
    expect(planned.decisions).toEqual([]);
  });

  it('duplicate and disagreeing reports are refused', async () => {
    const lines: string[] = [];
    const started = await startAdmin((line) => {
      lines.push(line);
    });
    const preview = await call(
      started.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(previewBody(), BASE_ORIGIN),
      previewBody(),
    );
    expect(preview.status).toBe(200);
    const resolutions = resolutionsFrom(JSON.parse(preview.body.toString('utf8')) as unknown);
    const firstBody = replaceBody(0, resolutions);
    const first = await call(
      started.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(firstBody, BASE_ORIGIN),
      firstBody,
    );
    expect(first.status).toBe(200);
    const saved = JSON.parse(first.body.toString('utf8')) as unknown;
    const savedRecord = asRecord(saved);
    expect(savedRecord.replaced).toBe(true);
    expect(savedRecord.importVersion).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}\.[0-9a-f]{64}$/);
    const version = openStore(started.db, importClock).loadCurrent()?.board.version;
    const secondBody = replaceBody(typeof version === 'number' ? version : 0, resolutions);
    const second = await call(
      started.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(secondBody, BASE_ORIGIN),
      secondBody,
    );
    expect(second.status).toBe(409);
    expect(second.body.toString('utf8')).toBe('{"error":"duplicate_report"}');
    expect(openStore(started.db, importClock).loadCurrent()?.board.version).toBe(version);
    expect(lines.filter((line) => line.startsWith('import replace'))).toHaveLength(1);

    const current = openStore(started.db, importClock).loadCurrent();
    if (current === null) throw new Error('current board is missing');
    const ward = openStore(started.db, importClock).loadWard();
    const una = Object.values(ward.members).find((item) => item.name === 'Wrenford, Una');
    if (una === undefined) throw new Error('missing Wrenford, Una');
    const mission = Object.values(current.board.assignments).filter((item) => item.title === 'Ward Missionary');
    expect(mission).toHaveLength(1);
    expect(mission[0]?.type).toBe('list');
    const seats = Object.values(current.board.positions).filter((item) => item.assignmentId === mission[0]?.id);
    const occupied = seats.filter((item) => current.board.placements[item.id] === una.id);
    expect(occupied).toHaveLength(1);
    expect(seats.some((item) => current.board.placements[item.id] === undefined)).toBe(true);
    expect(Object.values(ward.members).some((item) => item.name === 'Westdale, Gus')).toBe(true);
  });

  it('an editor and a revoked session are refused', async () => {
    const lines: string[] = [];
    const editor = await startEditor();
    const editorBody = previewBody();
    const editorPreview = await call(
      editor.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(editorBody, BASE_ORIGIN),
      editorBody,
    );
    expect(editorPreview.status).toBe(403);
    expect(editorPreview.body.toString('utf8')).toBe('{"error":"forbidden"}');
    const editorReplace = replaceBody(0, {});
    const editorResult = await call(
      editor.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(editorReplace, BASE_ORIGIN),
      editorReplace,
    );
    expect(editorResult.status).toBe(403);
    expect(editorResult.body.toString('utf8')).toBe('{"error":"forbidden"}');

    const revoked = await startWith(ADMIN, { log: (line) => lines.push(line) });
    const admin = userByLogin(revoked.access, ADMIN_LOGIN);
    revoked.db
      .prepare(
        `INSERT INTO users (id, login, display_name, role, created_at)
         VALUES ('admin-2', 'second-admin@example.test', 'Second Admin', 'admin', ?)`,
      )
      .run('2026-04-01T00:00:00.000Z');
    expect(revoked.access.revokeUser('admin-2', admin.id).ok).toBe(true);
    const revokedBody = previewBody();
    const revokedResult = await call(
      revoked.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(revokedBody, BASE_ORIGIN),
      revokedBody,
    );
    expect(revokedResult.status).toBe(403);
    expect(revokedResult.body.toString('utf8')).toBe('{"error":"forbidden"}');

    const anonymous = await startWith(null);
    const anonymousBody = previewBody();
    const anonymousResult = await call(
      anonymous.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(anonymousBody, BASE_ORIGIN),
      anonymousBody,
    );
    expect(anonymousResult.status).toBe(401);
    expect(anonymousResult.body.toString('utf8')).toBe('{"error":"unauthenticated"}');

    const foreign = await startAdmin();
    const foreignBody = previewBody();
    const foreignResult = await call(
      foreign.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(foreignBody, 'http://evil.example'),
      foreignBody,
    );
    expect(foreignResult.status).toBe(403);
    expect(foreignResult.body.toString('utf8')).toBe('{"error":"forbidden"}');
    const missingOrigin = await call(
      foreign.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(foreignBody),
      foreignBody,
    );
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.body.toString('utf8')).toBe('{"error":"forbidden"}');
    expect(openStore(foreign.db, importClock).loadCurrent()?.importVersion).toBe('fixture');
    expect(lines).toEqual([]);
  });

  it('the preview writes nothing and hides discarded fields', async () => {
    const lines: string[] = [];
    const started = await startAdmin((line) => {
      lines.push(line);
    });
    const store = openStore(started.db, importClock);
    const before = store.loadCurrent();
    const beforeFiles = await filesOf(started.dataDir);
    const body = previewBody();
    const response = await call(
      started.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(body, BASE_ORIGIN),
      body,
    );
    expect(response.status).toBe(200);
    expect(await filesOf(started.dataDir)).toEqual(beforeFiles);
    expect(store.loadCurrent()).toEqual(before);
    const text = `${response.body.toString('utf8')}\n${lines.join('\n')}`;
    for (const canary of CANARIES) {
      expect(text.includes(canary)).toBe(false);
    }
    const parsed = asRecord(JSON.parse(response.body.toString('utf8')) as unknown);
    const decisions = parsed.decisions;
    if (!Array.isArray(decisions)) throw new Error('decisions missing');
    expect(decisions.some((decision) => asRecord(decision).name === 'Stanley, Zed')).toBe(true);
    expect(parsed.keptPositions).toEqual(expect.any(Number));
    expect(parsed.matchedPositions).toEqual(expect.any(Number));
    expect(Array.isArray(parsed.unfamiliar)).toBe(true);
    expect(Array.isArray(parsed.needsCategory)).toBe(true);
    expect(Array.isArray(parsed.returning)).toBe(true);

    // The Member List is required: the old three-report body is refused.
    const { organizations, withoutCallings, outOfUnit } = pdfFields();
    const three = Buffer.from(JSON.stringify({ organizations, withoutCallings, outOfUnit }));
    const refused = await call(started.server.port, 'POST', '/api/import/preview', jsonHeaders(three, BASE_ORIGIN), three);
    expect(refused.status).toBe(400);
    expect(refused.body.toString('utf8')).toBe('{"error":"bad_request"}');
    expect(store.loadCurrent()).toEqual(before);
  });

  it('replace announces the new ward and board', async () => {
    const started = await startAdmin();
    const preview = previewBody();
    const previewResult = await call(
      started.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(preview, BASE_ORIGIN),
      preview,
    );
    expect(previewResult.status).toBe(200);
    const resolutions = resolutionsFrom(JSON.parse(previewResult.body.toString('utf8')) as unknown);
    const { ws, inbox } = await openSocket(started.server.port);
    ws.send(JSON.stringify({ type: 'subscribe', boardId: 'board-current' }));
    const snapshot = asRecord(await inbox.next());
    expect(snapshot.type).toBe('snapshot');

    const body = replaceBody(0, resolutions);
    const pending = Promise.all([inbox.next(), inbox.next(), inbox.next()]);
    const response = await call(
      started.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(body, BASE_ORIGIN),
      body,
    );
    expect(response.status).toBe(200);
    const saved = asRecord(JSON.parse(response.body.toString('utf8')) as unknown);
    const [first, second, third] = await pending;
    expect(asRecord(first).type).toBe('ward');
    expect(asRecord(second).type).toBe('boards');
    const boards = asRecord(asRecord(second).current);
    expect(boards.importVersion).toBe(saved.importVersion);
    expect(asRecord(third).type).toBe('committed');
    expect(asRecord(third).boardId).toBe('board-current');

    const again = inbox.next();
    const refusedBody = replaceBody(1, resolutions);
    const refused = await call(
      started.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(refusedBody, BASE_ORIGIN),
      refusedBody,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.toString('utf8')).toBe('{"error":"duplicate_report"}');
    ws.send(JSON.stringify({ type: 'not-a-type' }));
    expect(await again).toEqual({ type: 'error', code: 'bad_request' });
  });

  it('the log is counts only', async () => {
    const lines: string[] = [];
    const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    try {
      const started = await startAdmin((line) => {
        lines.push(line);
      });
      const preview = previewBody();
      const previewResult = await call(
        started.server.port,
        'POST',
        '/api/import/preview',
        jsonHeaders(preview, BASE_ORIGIN),
        preview,
      );
      expect(previewResult.status).toBe(200);
      const parsed = JSON.parse(previewResult.body.toString('utf8')) as unknown;
      const counts = countDecisions(parsed);
      const absent = asRecord(parsed).absent;
      const duplicates = asRecord(parsed).duplicates;
      expect(lines).toEqual([
        `import preview matched=${String(counts.matched)} new=${String(counts.created)} ambiguous=${String(counts.ambiguous)} absent=${String(Array.isArray(absent) ? absent.length : -1)} duplicates=${String(Array.isArray(duplicates) ? duplicates.length : -1)}`,
      ]);
      const resolutions = resolutionsFrom(parsed);
      const body = replaceBody(0, resolutions);
      const replaced = await call(
        started.server.port,
        'POST',
        '/api/import/replace',
        jsonHeaders(body, BASE_ORIGIN),
        body,
      );
      expect(replaced.status).toBe(200);
      const saved = asRecord(JSON.parse(replaced.body.toString('utf8')) as unknown);
      expect(lines[1]).toBe(
        `import replace matched=${String(saved.matched)} created=${String(saved.created)} removed=${String(saved.removed)}`,
      );
      expect(lines).toHaveLength(2);
      const text = lines.join('\n');
      for (const name of FIXTURE_NAMES) expect(text.includes(name)).toBe(false);
      for (const canary of CANARIES) expect(text.includes(canary)).toBe(false);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('an admin using the wrong method is refused', async () => {
    const started = await startAdmin();
    const preview = await call(started.server.port, 'GET', '/api/import/preview', { origin: BASE_ORIGIN });
    expect(preview.status).toBe(405);
    expect(preview.body.toString('utf8')).toBe('{"error":"method_not_allowed"}');
    expect(preview.headers.allow).toBe('POST');
    const replace = await call(started.server.port, 'PUT', '/api/import/replace', { origin: BASE_ORIGIN });
    expect(replace.status).toBe(405);
    expect(replace.headers.allow).toBe('POST');
  });

  it('an oversized body is refused', async () => {
    const started = await startAdmin();
    const body = Buffer.alloc(2_000_001, 0x61);
    const response = await call(
      started.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(body, BASE_ORIGIN),
      body,
    );
    expect(response.status).toBe(413);
    expect(response.body.toString('utf8')).toBe('{"error":"too_large"}');
  });

  it('a bad pdf or bad json is refused', async () => {
    const started = await startAdmin();
    const badJson = Buffer.from('{');
    const jsonResult = await call(
      started.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(badJson, BASE_ORIGIN),
      badJson,
    );
    expect(jsonResult.status).toBe(400);
    expect(jsonResult.body.toString('utf8')).toBe('{"error":"bad_request"}');

    const badPdf = Buffer.from(
      JSON.stringify({
        organizations: Buffer.from('not a pdf').toString('base64'),
        withoutCallings: Buffer.from('not a pdf').toString('base64'),
        outOfUnit: Buffer.from('not a pdf').toString('base64'),
        memberList: Buffer.from('not a pdf').toString('base64'),
      }),
    );
    const pdfResult = await call(
      started.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(badPdf, BASE_ORIGIN),
      badPdf,
    );
    expect(pdfResult.status).toBe(400);
    expect(pdfResult.body.toString('utf8')).toBe('{"error":"bad_request"}');

    const dataUrl = Buffer.from(
      JSON.stringify({
        organizations: `data:application/pdf;base64,${organizationsPdf.toString('base64')}`,
        withoutCallings: withoutPdf.toString('base64'),
        outOfUnit: outPdf.toString('base64'),
        memberList: memberListPdf.toString('base64'),
      }),
    );
    const urlResult = await call(
      started.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(dataUrl, BASE_ORIGIN),
      dataUrl,
    );
    expect(urlResult.status).toBe(400);
    expect(urlResult.body.toString('utf8')).toBe('{"error":"bad_request"}');
  });
});
