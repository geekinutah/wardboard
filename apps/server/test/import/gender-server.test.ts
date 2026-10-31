import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { WebSocket, type RawData } from 'ws';
import {
  assignmentId,
  boardGroupId,
  boardId,
  callingGroupId,
  createBoard,
  createWard,
  lineageId,
  memberId,
  positionId,
  sequentialIds,
  type CallingAssignment,
  type Member,
  type Position,
} from '@wardboard/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccess, type Access } from '../../src/access/index.ts';
import { createBackup, restoreBackup } from '../../src/backup/index.ts';
import { databasePath, migrate, openDatabase } from '../../src/db/index.ts';
import { applyImport, planImport } from '../../src/import/index.ts';
import {
  fixtureIdentityProvider,
  openStore,
  startServer,
  type Config,
  type Identity,
  type RunningServer,
  type Store,
} from '../../src/index.ts';
import { readBoard, readWard } from '../../src/store/persist.ts';
import { bundle } from './helpers.ts';

const BASE_ORIGIN = 'http://wardboard.example';
const ADMIN_LOGIN = 'admin@example.test';
const ADMIN: Identity = { login: ADMIN_LOGIN, displayName: 'Admin Example' };
const FIXED_TIME = '2026-07-01T15:04:05.000Z';

function fixedClock(): Date {
  return new Date(FIXED_TIME);
}

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
  const root = await mkdtemp(path.join(tmpdir(), 'wardboard-gender-server-'));
  directories.push(root);
  return root;
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

type Session = {
  server: RunningServer;
  dataDir: string;
  config: Config;
  db: DatabaseSync;
  store: Store;
  access: Access;
};

async function startServerSession(): Promise<Session> {
  const root = await makeRoot();
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  const db = openDatabase(databasePath(dataDir));
  databases.push(db);
  migrate(db);
  const config: Config = {
    dataDir,
    baseUrl: BASE_ORIGIN,
    port: 0,
    host: '127.0.0.1',
    initialAdminLogin: ADMIN_LOGIN,
  };
  const server = await startServer(config, {
    identityProvider: fixtureIdentityProvider(ADMIN),
    clock: fixedClock,
    ids: sequentialIds('id'),
  });
  servers.push(server);
  const store = openStore(db, fixedClock);
  const access = createAccess(db, fixedClock, sequentialIds('access'));
  return { server, dataDir, config, db, store, access };
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

function openSocket(session: Session): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(session.server.port)}/api/ws`, {
    origin: BASE_ORIGIN,
  });
  sockets.push(ws);
  return new Promise((resolve, reject) => {
    let settled = false;
    ws.once('open', () => {
      settled = true;
      ws.on('error', () => undefined);
      resolve(ws);
    });
    ws.once('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function subscribe(ws: WebSocket, inbox: Inbox, boardId: string): Promise<Record<string, unknown>> {
  const pending = inbox.next();
  ws.send(JSON.stringify({ type: 'subscribe', boardId }));
  const message = (await pending) as Record<string, unknown>;
  expect(message['type']).toBe('snapshot');
  return message;
}

function opMessage(input: {
  requestId: string;
  boardId: string;
  baseVersion: number;
  kind: string;
  request: unknown;
}): string {
  return JSON.stringify({
    type: 'op',
    requestId: input.requestId,
    boardId: input.boardId,
    baseVersion: input.baseVersion,
    op: { kind: input.kind, request: input.request },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected object');
  }
  return value as Record<string, unknown>;
}

describe('gender server persistence, import apply, and operation channel', () => {
  it('persists member gender and assignment genderRule across SQLite round-trips', async () => {
    const session = await startServerSession();

    // Verify SQLite check constraints
    expect(() => {
      session.db
        .prepare(
          `INSERT INTO members (id, name, photo_ref, category, gender, note, needs_approval, removed_date, created_at, updated_at)
           VALUES ('m-bad', 'Bad Gender', NULL, 'adult', 'X', NULL, 0, NULL, '2026-01-01', '2026-01-01')`,
        )
        .run();
    }).toThrow();

    expect(() => {
      session.db
        .prepare(
          `INSERT INTO calling_assignments (id, board_id, calling_group_id, title, type, sort_order, enabled, prominence, origin, leadership_role, gender_rule)
           VALUES ('a-bad', 'current', 'cg-1', 'Bad Rule', 'single', 0, 1, 0, 'standard', NULL, 'invalid')`,
        )
        .run();
    }).toThrow();

    const members: Record<string, Member> = {
      'mem-male': {
        id: memberId('mem-male'),
        name: 'Male Member',
        category: 'adult',
        gender: 'M',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [],
      },
      'mem-female': {
        id: memberId('mem-female'),
        name: 'Female Member',
        category: 'adult',
        gender: 'F',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [],
      },
      'mem-unknown': {
        id: memberId('mem-unknown'),
        name: 'Unknown Member',
        category: 'adult',
        photoRef: null,
        note: null,
        tagIds: [],
        needsApproval: false,
        removedDate: null,
        externalCallings: [],
      },
    };

    const wardResult = createWard({ members, tags: {} });
    expect(wardResult.ok).toBe(true);
    if (!wardResult.ok) return;
    const ward = wardResult.value;

    const bgId = boardGroupId('bg-1');
    const cgId = callingGroupId('cg-1');
    const asM = assignmentId('as-m');
    const asF = assignmentId('as-f');
    const asAny = assignmentId('as-any');
    const asAligned = assignmentId('as-aligned');
    const asOmitted = assignmentId('as-omitted');

    const assignments: Record<string, CallingAssignment> = {
      [asM]: {
        id: asM,
        groupId: cgId,
        title: 'Male Calling',
        type: 'single',
        order: 0,
        enabled: true,
        prominent: false,
        origin: 'standard',
        leadershipRole: null,
        genderRule: 'M',
        callingTagIds: [],
        preferredMemberTagIds: [],
      },
      [asF]: {
        id: asF,
        groupId: cgId,
        title: 'Female Calling',
        type: 'single',
        order: 1,
        enabled: true,
        prominent: false,
        origin: 'standard',
        leadershipRole: null,
        genderRule: 'F',
        callingTagIds: [],
        preferredMemberTagIds: [],
      },
      [asAny]: {
        id: asAny,
        groupId: cgId,
        title: 'Any Calling',
        type: 'single',
        order: 2,
        enabled: true,
        prominent: false,
        origin: 'standard',
        leadershipRole: null,
        genderRule: 'any',
        callingTagIds: [],
        preferredMemberTagIds: [],
      },
      [asAligned]: {
        id: asAligned,
        groupId: cgId,
        title: 'Aligned Calling',
        type: 'single',
        order: 3,
        enabled: true,
        prominent: false,
        origin: 'standard',
        leadershipRole: null,
        genderRule: 'presidency_aligned',
        callingTagIds: [],
        preferredMemberTagIds: [],
      },
      [asOmitted]: {
        id: asOmitted,
        groupId: cgId,
        title: 'Omitted Calling',
        type: 'single',
        order: 4,
        enabled: true,
        prominent: false,
        origin: 'standard',
        leadershipRole: null,
        callingTagIds: [],
        preferredMemberTagIds: [],
      },
    };

    const positions: Record<string, Position> = {
      'pos-1': { id: positionId('pos-1'), assignmentId: asM, lineageId: lineageId('lin-1'), order: 0 },
      'pos-2': { id: positionId('pos-2'), assignmentId: asF, lineageId: lineageId('lin-2'), order: 0 },
      'pos-3': { id: positionId('pos-3'), assignmentId: asAny, lineageId: lineageId('lin-3'), order: 0 },
      'pos-4': { id: positionId('pos-4'), assignmentId: asAligned, lineageId: lineageId('lin-4'), order: 0 },
      'pos-5': { id: positionId('pos-5'), assignmentId: asOmitted, lineageId: lineageId('lin-5'), order: 0 },
    };

    const boardResult = createBoard(
      {
        id: boardId('current'),
        kind: 'current',
        version: 0,
        boardGroups: {
          [bgId]: { id: bgId, name: 'Group 1', order: 0, visible: true, key: null },
        },
        callingGroups: {
          [cgId]: {
            id: cgId,
            name: 'Calling Group 1',
            order: 0,
            parent: { kind: 'boardGroup', id: bgId },
            kind: 'other',
            key: null,
          },
        },
        assignments,
        positions,
        placements: {},
        oversight: [],
        dugoutInclusions: [],
        approvals: [],
      },
      ward,
    );
    expect(boardResult.ok).toBe(true);
    if (!boardResult.ok) return;
    const current = boardResult.value;

    const initialized = session.store.initialize({ ward, current, importVersion: 'v1' });
    expect(initialized.ok).toBe(true);

    // Read back via readWard / readBoard
    const loadedWard = readWard(session.db);
    expect(loadedWard.members[memberId('mem-male')]?.gender).toBe('M');
    expect(loadedWard.members[memberId('mem-female')]?.gender).toBe('F');
    const unknownMember = loadedWard.members[memberId('mem-unknown')];
    expect(unknownMember?.gender).toBeUndefined();
    expect(unknownMember !== undefined && Object.hasOwn(unknownMember, 'gender')).toBe(false);

    const loadedBoard = readBoard(session.db, 'current', loadedWard);
    expect(loadedBoard).not.toBeNull();
    if (loadedBoard === null) return;
    expect(loadedBoard.assignments[asM]?.genderRule).toBe('M');
    expect(loadedBoard.assignments[asF]?.genderRule).toBe('F');
    expect(loadedBoard.assignments[asAny]?.genderRule).toBe('any');
    expect(loadedBoard.assignments[asAligned]?.genderRule).toBe('presidency_aligned');
    const omittedAssignment = loadedBoard.assignments[asOmitted];
    expect(omittedAssignment?.genderRule).toBeUndefined();
    expect(omittedAssignment !== undefined && Object.hasOwn(omittedAssignment, 'genderRule')).toBe(false);

    // Round-trip through backup and restore
    const archive = await createBackup(session.dataDir, fixedClock);
    const freshRoot = await makeRoot();
    const freshDataDir = path.join(freshRoot, 'fresh-data');
    await mkdir(freshDataDir, { recursive: true });
    const freshDb = openDatabase(databasePath(freshDataDir));
    databases.push(freshDb);
    migrate(freshDb);
    const restored = await restoreBackup(freshDb, freshDataDir, archive, { mode: 'apply' });
    expect(restored.ok).toBe(true);

    const freshWard = readWard(freshDb);
    expect(freshWard).toEqual(loadedWard);
    const freshBoard = readBoard(freshDb, 'current', freshWard);
    expect(freshBoard).toEqual(loadedBoard);
  });

  it('first import assigns Handbook gender rules and refuses mismatched placements over WebSocket', async () => {
    const session = await startServerSession();

    // 1. Preview on empty server
    const previewRes = await call(
      session.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(previewBody(), BASE_ORIGIN),
      previewBody(),
    );
    expect(previewRes.status).toBe(200);
    const preview = JSON.parse(previewRes.body.toString('utf8')) as {
      decisions: { key: string; kind: string; name: string; category: string | null }[];
      needsCategory: string[];
      needsGender: string[];
    };

    // Build resolutions
    const resolutions: Record<string, { action: 'new'; category: 'adult'; gender?: 'M' | 'F' }> = {};
    for (const key of preview.needsCategory) {
      resolutions[key] = { action: 'new', category: 'adult' };
    }
    for (const key of preview.needsGender) {
      const existing = resolutions[key] ?? { action: 'new', category: 'adult' };
      resolutions[key] = { ...existing, gender: key.includes('westdale') ? 'M' : 'F' };
    }

    // 2. Replace import
    const replaceReqBody = replaceBody(0, resolutions);
    const replaceRes = await call(
      session.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(replaceReqBody, BASE_ORIGIN),
      replaceReqBody,
    );
    expect(replaceRes.status).toBe(200);

    // 3. Create a draft proposal
    const proposalResult = session.store.createProposal(
      { name: 'Gender Proposal', rationale: '', source: { kind: 'current' } },
      sequentialIds('prop'),
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) return;
    const proposal = proposalResult.value;

    const ward = session.store.loadWard();
    const workingBoard = proposal.board;

    // Find female member (Una Wrenford) and male member (Zed Stanley)
    const femaleMember = Object.values(ward.members).find((m) => m.name.toLowerCase().includes('wrenford, una'));
    const maleMember = Object.values(ward.members).find((m) => m.name.toLowerCase().includes('stanley, zed'));
    expect(femaleMember).toBeDefined();
    expect(maleMember).toBeDefined();
    if (!femaleMember || !maleMember) return;
    expect(femaleMember.gender).toBe('F');
    expect(maleMember.gender).toBe('M');

    // Find vacant calling positions
    const maleOnlyPosition = Object.values(workingBoard.positions).find((p) => {
      const a = workingBoard.assignments[p.assignmentId];
      return (
        workingBoard.placements[p.id] === undefined &&
        a !== undefined &&
        a.genderRule === 'M' &&
        (a.title.includes('Bishopric') || a.title.includes('Elders Quorum'))
      );
    });
    expect(maleOnlyPosition).toBeDefined();

    const femaleOnlyPosition = Object.values(workingBoard.positions).find((p) => {
      const a = workingBoard.assignments[p.assignmentId];
      return (
        workingBoard.placements[p.id] === undefined &&
        a !== undefined &&
        a.genderRule === 'F' &&
        (a.title.includes('Relief Society') || a.title.includes('Primary'))
      );
    });
    expect(femaleOnlyPosition).toBeDefined();

    const primaryTeacherPosition = Object.values(workingBoard.positions).find((p) => {
      const a = workingBoard.assignments[p.assignmentId];
      return workingBoard.placements[p.id] === undefined && a?.title.toLowerCase() === 'primary teacher';
    });
    expect(primaryTeacherPosition).toBeDefined();
    if (!maleOnlyPosition || !femaleOnlyPosition || !primaryTeacherPosition) return;

    // Connect over WebSocket
    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, proposal.board.id);

    // Test 1: Place female member into Bishopric/EQ (genderRule 'M') -> refused with gender_mismatch
    const pendingBishopric = inbox.next();
    ws.send(
      opMessage({
        requestId: 'op-mismatch-1',
        boardId: proposal.board.id,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: femaleMember.id, from: null, to: maleOnlyPosition.id },
      }),
    );
    const resBishopric = asRecord(await pendingBishopric);
    expect(resBishopric['type']).toBe('rejected');
    expect(resBishopric['code']).toBe('gender_mismatch');

    // Test 2: Place male member into Relief Society/Primary Presidency (genderRule 'F') -> refused with gender_mismatch
    const pendingRs = inbox.next();
    ws.send(
      opMessage({
        requestId: 'op-mismatch-2',
        boardId: proposal.board.id,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: maleMember.id, from: null, to: femaleOnlyPosition.id },
      }),
    );
    const resRs = asRecord(await pendingRs);
    expect(resRs['type']).toBe('rejected');
    expect(resRs['code']).toBe('gender_mismatch');

    // Test 3: Place male member into Primary Teacher (genderRule 'any') -> succeeds
    const pendingTeacher = inbox.next();
    ws.send(
      opMessage({
        requestId: 'op-teacher',
        boardId: proposal.board.id,
        baseVersion: 0,
        kind: 'placeInPosition',
        request: { memberId: maleMember.id, from: null, to: primaryTeacherPosition.id },
      }),
    );
    const resTeacher = asRecord(await pendingTeacher);
    expect(resTeacher['type']).toBe('committed');
  });

  it('preview reports needsGender and replace validates resolution gender', async () => {
    const session = await startServerSession();

    // 1. Preview
    const previewRes = await call(
      session.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(previewBody(), BASE_ORIGIN),
      previewBody(),
    );
    expect(previewRes.status).toBe(200);
    const preview = JSON.parse(previewRes.body.toString('utf8')) as {
      needsCategory: string[];
      needsGender: string[];
      decisions: { key: string; kind: string; name: string; category: string | null; gender?: string | null }[];
    };

    expect([...preview.needsGender].sort()).toEqual(['fairwell, sage casey kendall reagan', 'westdale, gus']);
    expect(preview.needsGender).toHaveLength(2);

    // 2. Replace with invalid gender 'X' -> 400 bad_request
    const badGenderResolutions: Record<string, unknown> = {};
    for (const key of preview.needsCategory) badGenderResolutions[key] = { action: 'new', category: 'adult' };
    badGenderResolutions['fairwell, sage casey kendall reagan'] = { action: 'new', category: 'adult', gender: 'X' };

    const badGenderBody = replaceBody(0, badGenderResolutions);
    const badGenderRes = await call(
      session.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(badGenderBody, BASE_ORIGIN),
      badGenderBody,
    );
    expect(badGenderRes.status).toBe(400);
    expect(badGenderRes.body.toString('utf8')).toBe('{"error":"bad_request"}');

    // 3. Replace with contradicting gender on known decision.gender -> 409 unresolved
    // Stanley, Zed is known male
    const zedDecision = preview.decisions.find((d) => d.key.includes('stanley, zed'));
    expect(zedDecision).toBeDefined();
    if (zedDecision === undefined) return;
    const contradictingResolutions: Record<string, unknown> = {};
    for (const key of preview.needsCategory) contradictingResolutions[key] = { action: 'new', category: 'adult' };
    for (const key of preview.needsGender) contradictingResolutions[key] = { action: 'new', category: 'adult', gender: 'M' };
    contradictingResolutions[zedDecision.key] = { action: 'new', category: 'adult', gender: 'F' };

    const contradictBody = replaceBody(0, contradictingResolutions);
    const contradictRes = await call(
      session.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(contradictBody, BASE_ORIGIN),
      contradictBody,
    );
    expect(contradictRes.status).toBe(409);
    expect(contradictRes.body.toString('utf8')).toBe('{"error":"unresolved"}');

    // 4. Valid replace with gender supplied -> 200 and persisted
    const validResolutions: Record<string, unknown> = {};
    for (const key of preview.needsCategory) validResolutions[key] = { action: 'new', category: 'adult' };
    validResolutions['fairwell, sage casey kendall reagan'] = { action: 'new', category: 'adult', gender: 'F' };
    validResolutions['westdale, gus'] = { action: 'new', category: 'adult', gender: 'M' };

    const validBody = replaceBody(0, validResolutions);
    const validRes = await call(
      session.server.port,
      'POST',
      '/api/import/replace',
      jsonHeaders(validBody, BASE_ORIGIN),
      validBody,
    );
    expect(validRes.status).toBe(200);

    const ward = session.store.loadWard();
    const sage = Object.values(ward.members).find((m) => m.name.toLowerCase().includes('fairwell, sage'));
    const gus = Object.values(ward.members).find((m) => m.name.toLowerCase().includes('westdale, gus'));
    expect(sage).toBeDefined();
    expect(gus).toBeDefined();
    expect(sage?.gender).toBe('F');
    expect(gus?.gender).toBe('M');
  });

  it('addAssignment over WebSocket accepts optional genderRule', async () => {
    const session = await startServerSession();

    // Import fixture data to have a valid board
    const previewRes = await call(
      session.server.port,
      'POST',
      '/api/import/preview',
      jsonHeaders(previewBody(), BASE_ORIGIN),
      previewBody(),
    );
    const preview = JSON.parse(previewRes.body.toString('utf8')) as {
      needsCategory: string[];
      needsGender: string[];
    };
    const resolutions: Record<string, unknown> = {};
    for (const key of preview.needsCategory) resolutions[key] = { action: 'new', category: 'adult' };
    for (const key of preview.needsGender) resolutions[key] = { action: 'new', category: 'adult', gender: 'M' };

    const repBody = replaceBody(0, resolutions);
    await call(session.server.port, 'POST', '/api/import/replace', jsonHeaders(repBody, BASE_ORIGIN), repBody);

    const proposalResult = session.store.createProposal(
      { name: 'WS Assignment Proposal', rationale: '', source: { kind: 'current' } },
      sequentialIds('prop2'),
    );
    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) return;
    const proposal = proposalResult.value;

    const ws = await openSocket(session);
    const inbox = new Inbox(ws);
    await subscribe(ws, inbox, proposal.board.id);

    const callingGroupIdVal = Object.keys(proposal.board.callingGroups)[0];
    expect(callingGroupIdVal).toBeDefined();
    if (callingGroupIdVal === undefined) return;

    // 1. Send addAssignment with genderRule: 'F'
    const pendingAdd = inbox.next();
    ws.send(
      opMessage({
        requestId: 'op-add-female',
        boardId: proposal.board.id,
        baseVersion: 0,
        kind: 'addAssignment',
        request: {
          groupId: callingGroupIdVal,
          title: 'Custom Female Calling',
          type: 'single',
          positionCount: 1,
          genderRule: 'F',
        },
      }),
    );
    const addResult = asRecord(await pendingAdd);
    expect(addResult['type']).toBe('committed');
    expect(addResult['version']).toBe(1);

    const updatedBoard = asRecord(addResult['board']);
    const assignmentsObj = asRecord(updatedBoard['assignments']);
    const newAssignment = Object.values(assignmentsObj).find(
      (a) => asRecord(a)['title'] === 'Custom Female Calling',
    );
    expect(newAssignment).toBeDefined();
    expect(asRecord(newAssignment)['genderRule']).toBe('F');

    const positionsObj = asRecord(updatedBoard['positions']);
    const newPosition = Object.values(positionsObj).find(
      (p) => asRecord(p)['assignmentId'] === asRecord(newAssignment)['id'],
    );
    expect(newPosition).toBeDefined();

    const ward = session.store.loadWard();
    const maleMember = Object.values(ward.members).find((m) => m.gender === 'M');
    const femaleMember = Object.values(ward.members).find((m) => m.gender === 'F');
    expect(maleMember).toBeDefined();
    expect(femaleMember).toBeDefined();
    if (!maleMember) return;

    // Placing male into female calling fails
    const pendingMismatch = inbox.next();
    ws.send(
      opMessage({
        requestId: 'op-place-mismatch',
        boardId: proposal.board.id,
        baseVersion: 1,
        kind: 'placeInPosition',
        request: {
          memberId: maleMember.id,
          from: null,
          to: asRecord(newPosition)['id'],
        },
      }),
    );
    const mismatchResult = asRecord(await pendingMismatch);
    expect(mismatchResult['type']).toBe('rejected');
    expect(mismatchResult['code']).toBe('gender_mismatch');

    // 2. Sending invalid genderRule is refused with bad_request and does not mutate board
    const pendingInvalid = inbox.next();
    ws.send(
      opMessage({
        requestId: 'op-add-invalid',
        boardId: proposal.board.id,
        baseVersion: 1,
        kind: 'addAssignment',
        request: {
          groupId: callingGroupIdVal,
          title: 'Invalid Rule Calling',
          type: 'single',
          positionCount: 1,
          genderRule: 'invalid-rule',
        },
      }),
    );
    const invalidResult = asRecord(await pendingInvalid);
    expect(invalidResult['type']).toBe('rejected');
    expect(invalidResult['code']).toBe('bad_request');

    // Confirm board version unchanged
    const currentProposal = session.store.loadProposal(proposal.id);
    expect(currentProposal?.board.version).toBe(1);
  });

  it('re-import preserves an existing matched assignment custom genderRule', () => {
    // Test that when an assignment already exists with a custom genderRule,
    // re-import preserves that custom genderRule.
    const memId = memberId('mem-1');
    const wardResult = createWard({
      members: {
        [memId]: {
          id: memId,
          name: 'Stanley, Zed',
          category: 'adult',
          gender: 'M',
          photoRef: null,
          note: null,
          tagIds: [],
          needsApproval: false,
          removedDate: null,
          externalCallings: [],
        },
      },
      tags: {},
    });
    expect(wardResult.ok).toBe(true);
    if (!wardResult.ok) return;
    const ward = wardResult.value;

    const bgId = boardGroupId('bg-1');
    const cgId = callingGroupId('cg-1');
    const asId = assignmentId('as-1');
    const pId = positionId('pos-1');

    const boardResult = createBoard(
      {
        id: boardId('current'),
        kind: 'current',
        version: 0,
        boardGroups: {
          [bgId]: { id: bgId, name: 'Bishopric', order: 0, visible: true, key: 'bishopric' },
        },
        callingGroups: {
          [cgId]: {
            id: cgId,
            name: 'Bishopric',
            order: 0,
            parent: { kind: 'boardGroup', id: bgId },
            kind: 'bishopric',
            key: null,
          },
        },
        assignments: {
          [asId]: {
            id: asId,
            groupId: cgId,
            title: 'Bishop',
            type: 'single',
            order: 0,
            enabled: true,
            prominent: false,
            origin: 'standard',
            leadershipRole: 'president',
            genderRule: 'any', // Custom rule override on Bishop (default would be 'M')
            callingTagIds: [],
            preferredMemberTagIds: [],
          },
        },
        positions: {
          [pId]: { id: pId, assignmentId: asId, lineageId: lineageId('lin-1'), order: 0 },
        },
        placements: {},
        oversight: [],
        dugoutInclusions: [],
        approvals: [],
      },
      ward,
    );
    expect(boardResult.ok).toBe(true);
    if (!boardResult.ok) return;
    const current = boardResult.value;

    const plan = planImport({
      bundle: bundle({
        organizations: [
          {
            name: 'Bishopric',
            groups: [
              {
                name: 'Bishopric',
                positions: [{ title: 'Bishop', occupant: 'Stanley, Zed' }],
              },
            ],
          },
        ],
      }),
      ward,
      current,
    });

    const applied = applyImport({
      plan,
      resolutions: {},
      expectedVersion: 0,
      ids: sequentialIds('imp'),
      clock: fixedClock,
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    // The existing matched assignment 'as-1' should preserve its custom genderRule: 'any'
    expect(applied.current.assignments[asId]?.genderRule).toBe('any');
  });
});
